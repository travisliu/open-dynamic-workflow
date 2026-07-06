import { describe, expect, it } from "vitest";
import { validateConfig } from "../../../src/config/schema.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

describe("Config Schema Validation", () => {
  it("passes default config", () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it("fails if workflow.maxLoopRounds is not an integer", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        maxLoopRounds: 1.5 as any
      }
    };
    expect(() => validateConfig(config)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig(config)).toThrow("Config value 'workflow.maxLoopRounds' must be a positive integer.");
  });

  it("fails if workflow.maxLoopRounds is less than 1", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        maxLoopRounds: 0
      }
    };
    expect(() => validateConfig(config)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig(config)).toThrow("Config value 'workflow.maxLoopRounds' must be a positive integer.");
  });

  it("passes if workflow.maxLoopRounds is a positive integer", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        maxLoopRounds: 10
      }
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("fails if maxAgentCalls is not a positive integer", () => {
    const config = {
      ...DEFAULT_CONFIG,
      maxAgentCalls: 0
    };

    expect(() => validateConfig(config)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig(config)).toThrow("Config value 'maxAgentCalls' must be a positive integer.");
  });

  it("passes if maxAgentCalls is a positive integer", () => {
    const config = {
      ...DEFAULT_CONFIG,
      maxAgentCalls: 5
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it("passes valid flat includes", () => {
    const config = {
      ...DEFAULT_CONFIG,
      sharedAgents: {
        ...DEFAULT_CONFIG.sharedAgents,
        include: ["agents/*.js"]
      },
      tools: {
        ...DEFAULT_CONFIG.tools,
        include: ["tools/*.js"]
      },
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["workflows/*.js"]
      }
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("does not throw for malformed path shapes during basic schema validation", () => {
    const config1 = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: "workflows/**/*.workflow.js" as any
      }
    };
    const config2 = {
      ...DEFAULT_CONFIG,
      tools: {
        ...DEFAULT_CONFIG.tools,
        dir: [] as any
      }
    };
    const config3 = {
      ...DEFAULT_CONFIG,
      sharedAgents: {
        ...DEFAULT_CONFIG.sharedAgents,
        include: 123 as any
      }
    };
    const config4 = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        discovery: "bad" as any
      }
    };
    const config5 = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        discovery: {
          include: 123 as any
        }
      }
    };

    expect(() => validateConfig(config1)).not.toThrow();
    expect(() => validateConfig(config2)).not.toThrow();
    expect(() => validateConfig(config3)).not.toThrow();
    expect(() => validateConfig(config4)).not.toThrow();
    expect(() => validateConfig(config5)).not.toThrow();
  });

  it("does not throw for directory-only path values in validateConfig", () => {
    const config = {
      ...DEFAULT_CONFIG,
      tools: {
        ...DEFAULT_CONFIG.tools,
        include: [".open-dynamic-workflow/tools"]
      }
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("fails if sharedAgents contains unsupported keys", () => {
    const config = {
      ...DEFAULT_CONFIG,
      sharedAgents: {
        ...DEFAULT_CONFIG.sharedAgents,
        bogus: "value"
      } as any
    };
    expect(() => validateConfig(config)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig(config)).toThrow("Config value 'sharedAgents.bogus' is not a supported key.");
  });

  it("fails if workflow contains unsupported keys", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        bogus: "value"
      } as any
    };
    expect(() => validateConfig(config)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig(config)).toThrow("Config value 'workflow.bogus' is not a supported key.");
  });

  it("allows malformed path values under sharedAgents and workflow in validateConfig", () => {
    const config = {
      ...DEFAULT_CONFIG,
      sharedAgents: {
        ...DEFAULT_CONFIG.sharedAgents,
        dir: 123 as any,
        include: "not-an-array" as any,
        exclude: { bad: true } as any
      },
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: 456 as any,
        exclude: "string" as any,
        discovery: "malformed" as any
      }
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("passes when retry is omitted entirely", () => {
    // Arrange
    const config = { ...DEFAULT_CONFIG };
    delete (config as any).retry;

    // Act
    const validate = () => validateConfig(config);

    // Assert
    expect(validate).not.toThrow();
  });

  it("passes when retry is explicitly disabled", () => {
    // Arrange
    const config = {
      ...DEFAULT_CONFIG,
      retry: false
    };

    // Act
    const validate = () => validateConfig(config);

    // Assert
    expect(validate).not.toThrow();
  });

  it("passes when retry is a valid config object", () => {
    // Arrange
    const config = {
      ...DEFAULT_CONFIG,
      retry: {
        maxAttempts: 3,
        delayMs: 1000,
        maxDelayMs: 5000,
        backoff: "exponential",
        jitter: true,
        disableDelay: false
      }
    };

    // Act
    const validate = () => validateConfig(config);

    // Assert
    expect(validate).not.toThrow();
  });

  it("fails if retry is not an object", () => {
    // Arrange
    const nonObjectValues = ["yes", 123, true, [], null];

    // Act & Assert
    for (const val of nonObjectValues) {
      const config = {
        ...DEFAULT_CONFIG,
        retry: val as any
      };
      const validate = () => validateConfig(config);
      expect(validate).toThrow(OpenDynamicWorkflowError);
      expect(validate).toThrow("Config value 'retry' must be an object.");
    }
  });

  it("fails if retry has invalid numeric values", () => {
    // Arrange
    const invalidAttempts = [0, -1, 1.5, NaN, "3"];

    // Act & Assert
    for (const val of invalidAttempts) {
      const config = {
        ...DEFAULT_CONFIG,
        retry: { maxAttempts: val as any }
      };
      const validate = () => validateConfig(config);
      expect(validate).toThrow(OpenDynamicWorkflowError);
      expect(validate).toThrow("Config value 'retry.maxAttempts' must be a positive integer.");
    }

    const invalidDelays = [-1, 1.5, NaN, "1000"];
    for (const val of invalidDelays) {
      const delayConfig = {
        ...DEFAULT_CONFIG,
        retry: { delayMs: val as any }
      };
      const validateDelay = () => validateConfig(delayConfig);
      expect(validateDelay).toThrow(OpenDynamicWorkflowError);
      expect(validateDelay).toThrow("Config value 'retry.delayMs' must be a non-negative integer.");

      const maxDelayConfig = {
        ...DEFAULT_CONFIG,
        retry: { maxDelayMs: val as any }
      };
      const validateMaxDelay = () => validateConfig(maxDelayConfig);
      expect(validateMaxDelay).toThrow(OpenDynamicWorkflowError);
      expect(validateMaxDelay).toThrow("Config value 'retry.maxDelayMs' must be a non-negative integer.");
    }
  });

  it("fails if retry.backoff is invalid", () => {
    // Arrange
    const config = {
      ...DEFAULT_CONFIG,
      retry: { backoff: "invalid" as any }
    };

    // Act
    const validate = () => validateConfig(config);

    // Assert
    expect(validate).toThrow(OpenDynamicWorkflowError);
    expect(validate).toThrow("Config value 'retry.backoff' must be 'fixed' or 'exponential'.");
  });

  it("fails if retry.jitter or retry.disableDelay is not a boolean", () => {
    // Arrange
    const configJitter = {
      ...DEFAULT_CONFIG,
      retry: { jitter: "true" as any }
    };
    const configDisable = {
      ...DEFAULT_CONFIG,
      retry: { disableDelay: "false" as any }
    };

    // Act
    const validateJitter = () => validateConfig(configJitter);
    const validateDisable = () => validateConfig(configDisable);

    // Assert
    expect(validateJitter).toThrow(OpenDynamicWorkflowError);
    expect(validateJitter).toThrow("Config value 'retry.jitter' must be a boolean.");
    expect(validateDisable).toThrow(OpenDynamicWorkflowError);
    expect(validateDisable).toThrow("Config value 'retry.disableDelay' must be a boolean.");
  });

  it("fails and explicitly rejects banned public error-selection fields", () => {
    // Arrange
    const bannedFields = ["retryOn", "retryReasons", "retryOnErrors", "errorCategories"];

    // Act & Assert
    for (const field of bannedFields) {
      const config = {
        ...DEFAULT_CONFIG,
        retry: {
          maxAttempts: 3,
          [field]: ["provider_error"]
        }
      };
      const validate = () => validateConfig(config);
      expect(validate).toThrow(OpenDynamicWorkflowError);
      expect(validate).toThrow(
        `${field} is not supported in experimental retry v1. Retry eligibility is runtime-defined; configure maxAttempts and delay behavior only.`
      );
    }
  });
});
