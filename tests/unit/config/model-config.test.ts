import { describe, expect, it } from "vitest";
import { validateConfig } from "../../../src/config/schema.js";

function getValidBaseConfig(): any {
  return {
    defaultProvider: "mock",
    concurrency: 1,
    timeoutMs: 1000,
    providers: {
      mock: { command: "mock" }
    },
    reporting: { mode: "pretty", verbose: false },
    security: { passEnv: [], redactEnv: [], allowWorkflowImports: false },
    tools: { dir: ".open-dynamic-workflow/tools", concurrency: 1, maxDefinitions: 10 },
    sharedAgents: { dir: ".open-dynamic-workflow/agents", maxDefinitions: 10, strictPromptTemplateVariables: true, registry: [], allowDynamicIds: false },
    workflow: { maxDepth: 5, maxLoopRounds: 20, discovery: { include: ["**/*.workflow.js"], exclude: [] } }
  };
}

describe("Model Config Validation", () => {
  it("58. accepts valid provider-specific fields", () => {
    // Arrange
    const config = getValidBaseConfig();
    config.providers.copilot = {
      command: "copilot",
      permissionPolicy: "restricted"
    };
    config.providers.opencode = { 
      command: "opencode", 
      permissionPolicy: "read-only",
      dirFlag: false
    };
    config.providers.antigravity = {
      command: "agy",
      useSandboxByDefault: true,
      permissionPolicy: "sandbox"
    };
    config.providers.pi = {
      command: "pi",
      executionMode: "json",
      approvalMode: "no-approve",
      safeTools: ["read", "grep"],
      noSession: true
    };

    // Act & Assert
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("39. accepts disabled Copilot model selection", () => {
    const config = getValidBaseConfig();
    config.providers.copilot = { command: "copilot", modelArg: false };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("40. rejects empty Copilot model flag", () => {
    const config = getValidBaseConfig();
    config.providers.copilot = { command: "copilot", modelArg: { flag: "" } };
    expect(() => validateConfig(config)).toThrow();
  });

  it("43. accepts Copilot prompt mode values and rejects invalid prompt mode", () => {
    const validModes = ["arg", "stdin"];
    for (const mode of validModes) {
      const config = getValidBaseConfig();
      config.providers.copilot = { command: "copilot", promptMode: mode };
      expect(() => validateConfig(config)).not.toThrow();
    }

    const config = getValidBaseConfig();
    config.providers.copilot = { command: "copilot", promptMode: "pipe" };
    expect(() => validateConfig(config)).toThrow();
  });

  it("59. rejects invalid enum-like provider fields", () => {
    // Arrange
    const invalidConfigs = [
      { pi: { command: "pi", executionMode: "invalid" } },
      { pi: { command: "pi", approvalMode: "invalid" } },
      { copilot: { command: "copilot", permissionPolicy: "invalid" } },
      { copilot: { command: "copilot", permissionPolicy: "sandbox" } },
      { opencode: { command: "opencode", permissionPolicy: "invalid" } },
      { opencode: { command: "opencode", permissionPolicy: "sandbox" } }, // invalid for opencode
      { antigravity: { command: "antigravity", permissionPolicy: "read-only" } } // invalid for antigravity
    ];

    for (const partial of invalidConfigs) {
      const config = getValidBaseConfig();
      config.providers = { ...config.providers, ...partial };
      // Act & Assert
      expect(() => validateConfig(config)).toThrow(/must/);
    }
  });

  it("60. rejects invalid provider-specific scalar and array fields", () => {
    // Arrange
    const invalidConfigs = [
      { opencode: { command: "" } }, // empty flag
      { opencode: { command: "opencode", dirFlag: true } }, // dirFlag must be string or false
      { pi: { command: "pi", safeTools: [""] } }, // empty tool name
      { pi: { command: "pi", fullAccessTools: [123] } }, // non-string tool name
      { pi: { command: "pi", noSession: "yes" } } // non-boolean
    ];

    for (const partial of invalidConfigs) {
      const config = getValidBaseConfig();
      config.providers = { ...config.providers, ...partial };
      // Act & Assert
      expect(() => validateConfig(config)).toThrow(/must/);
    }
  });

  it("61. allows unknown provider extension keys for compatibility", () => {
    // Arrange
    const config = getValidBaseConfig();
    config.providers.customProvider = {
      command: "custom",
      args: [],
      defaultModel: null,
      vendorFutureKey: { enabled: true }
    };

    // Act & Assert
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("accepts all six valid defaultThinkingEffort values across Codex, Pi, OpenCode, and custom provider entries", () => {
    const validValues = ["off", "minimal", "low", "medium", "high", "xhigh"];
    const providersToTest = ["codex", "pi", "opencode", "customProvider"];
    
    for (const providerName of providersToTest) {
      for (const val of validValues) {
        const config = getValidBaseConfig();
        config.providers[providerName] = {
          command: "dummy-command",
          defaultThinkingEffort: val
        };
        expect(() => validateConfig(config)).not.toThrow();
      }
    }
  });

  it("rejects invalid defaultThinkingEffort values and asserts error code, provider name, and allowed values list", () => {
    const invalidValues = [
      "  ",                  // whitespace-only
      ["low"],                // array
      { effort: "low" },      // object
      null,                   // null
      "",                     // empty string
      "LOW",                  // wrong case
      "unknown-value",        // unknown string
      123,                    // number
      true,                   // boolean true
      false                   // boolean false
    ] as any[];

    const providerNames = ["codex", "pi", "opencode", "mock", "customProvider"];
    const allSixValues = ["off", "minimal", "low", "medium", "high", "xhigh"];

    for (const providerName of providerNames) {
      for (const val of invalidValues) {
        const config = getValidBaseConfig();
        config.providers[providerName] = {
          command: "dummy-command",
          defaultThinkingEffort: val
        };

        let thrownError: any = null;
        try {
          validateConfig(config);
        } catch (err: any) {
          thrownError = err;
        }

        expect(thrownError).not.toBeNull();
        expect(thrownError.code).toBe("CONFIG_VALIDATION_ERROR");
        expect(thrownError.message).toContain(`Provider '${providerName}'`);
        for (const allowedVal of allSixValues) {
          expect(thrownError.message).toContain(allowedVal);
        }
      }
    }
  });

  // Keep existing generic tests
  it("accepts valid minimal config", () => {
    const config = getValidBaseConfig();
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("rejects invalid defaultProvider", () => {
    const config = getValidBaseConfig();
    config.defaultProvider = 123;
    expect(() => validateConfig(config)).toThrow();
  });
});
