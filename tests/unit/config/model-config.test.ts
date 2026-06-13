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
    tools: { dir: ".openflow/tools", concurrency: 1, maxDefinitions: 10 },
    sharedAgents: { dir: ".openflow/agents", maxDefinitions: 10, strictPromptTemplateVariables: true, registry: [], allowDynamicIds: false },
    workflow: { maxDepth: 5, discovery: { include: ["**/*.workflow.js"], exclude: [] } }
  };
}

describe("Model Config Validation", () => {
  it("58. accepts valid provider-specific fields", () => {
    // Arrange
    const config = getValidBaseConfig();
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

  it("59. rejects invalid enum-like provider fields", () => {
    // Arrange
    const invalidConfigs = [
      { pi: { command: "pi", executionMode: "invalid" } },
      { pi: { command: "pi", approvalMode: "invalid" } },
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
