import { describe, expect, it } from "vitest";
import { validateConfig } from "../../../src/config/schema.js";
import { ExecflowError } from "../../../src/errors/types.js";
import type { ExecflowConfig } from "../../../src/config/types.js";

const baseConfig: ExecflowConfig = {
  defaultProvider: "mock",
  concurrency: 4,
  timeoutMs: 30000,
  providers: {
    mock: {
      command: "mock",
      args: [],
      defaultModel: null
    }
  },
  security: {
    passEnv: [],
    redactEnv: [],
    allowShell: false,
    allowWorkflowImports: false
  },
  reporting: {
    mode: "pretty",
    verbose: false
  }
};

describe("Model Config Validation", () => {
  it("passes with valid model configuration", () => {
    const config: ExecflowConfig = {
      ...baseConfig,
      defaultModel: "global-model",
      providers: {
        mock: {
          command: "mock",
          args: [],
          defaultModel: "provider-model",
          modelArg: { flag: "--model" }
        },
        gemini: {
          command: "gemini",
          args: [],
          defaultModel: null,
          modelArg: false
        }
      }
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("fails with invalid global defaultModel type", () => {
    const config = {
      ...baseConfig,
      defaultModel: 123 as any
    };
    expect(() => validateConfig(config)).toThrow(ExecflowError);
    try {
      validateConfig(config);
    } catch (err: any) {
      expect(err.code).toBe("MODEL_CONFIG_INVALID");
      expect(err.message).toContain("defaultModel");
    }
  });

  it("fails with invalid provider defaultModel type", () => {
    const config = {
      ...baseConfig,
      providers: {
        mock: {
          command: "mock",
          args: [],
          defaultModel: true as any
        }
      }
    };
    expect(() => validateConfig(config)).toThrow(ExecflowError);
    try {
      validateConfig(config);
    } catch (err: any) {
      expect(err.code).toBe("MODEL_CONFIG_INVALID");
      expect(err.message).toContain("defaultModel");
    }
  });

  it("fails with invalid modelArg type (not false/object)", () => {
    const config = {
      ...baseConfig,
      providers: {
        mock: {
          command: "mock",
          args: [],
          defaultModel: null,
          modelArg: "invalid" as any
        }
      }
    };
    expect(() => validateConfig(config)).toThrow(ExecflowError);
    try {
      validateConfig(config);
    } catch (err: any) {
      expect(err.code).toBe("MODEL_CONFIG_INVALID");
      expect(err.message).toContain("modelArg must be false or an object");
    }
  });

  it("fails with invalid modelArg flag type", () => {
    const config = {
      ...baseConfig,
      providers: {
        mock: {
          command: "mock",
          args: [],
          defaultModel: null,
          modelArg: { flag: 123 } as any
        }
      }
    };
    expect(() => validateConfig(config)).toThrow(ExecflowError);
    try {
      validateConfig(config);
    } catch (err: any) {
      expect(err.code).toBe("MODEL_CONFIG_INVALID");
      expect(err.message).toContain("flag must be a non-empty string");
    }
  });

  it("fails with empty modelArg flag string", () => {
    const config = {
      ...baseConfig,
      providers: {
        mock: {
          command: "mock",
          args: [],
          defaultModel: null,
          modelArg: { flag: "   " }
        }
      }
    };
    expect(() => validateConfig(config)).toThrow(ExecflowError);
    try {
      validateConfig(config);
    } catch (err: any) {
      expect(err.code).toBe("MODEL_CONFIG_INVALID");
      expect(err.message).toContain("flag must be a non-empty string");
    }
  });
});
