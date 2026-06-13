import { describe, expect, it } from "vitest";
import { ProviderRegistry, createDefaultProviderRegistry } from "../../../src/agents/registry.js";
import type { AgentAdapter, ResolvedConfig } from "../../../src/agents/types.js";

describe("ProviderRegistry", () => {
  it("54. creates default registry with all built-in providers in stable order", () => {
    // Arrange
    const dummyConfig = {
      defaultProvider: "mock",
      concurrency: 1,
      timeoutMs: 1000,
      providers: {
        codex: { command: "codex" },
        gemini: { command: "gemini" },
        opencode: { command: "opencode" },
        antigravity: { command: "agy" },
        pi: { command: "pi" }
      },
      security: {
        allowWorkflowImports: false,
        passEnv: [],
        redactEnv: []
      },
      reporting: {
        mode: "pretty",
        verbose: false
      },
      cwd: "/root",
      outDir: "/root/out",
      cliArgs: {}
    } as unknown as ResolvedConfig;

    // Act
    const registry = createDefaultProviderRegistry({ config: dummyConfig });
    const providers = registry.list().map(a => a.name);

    // Assert
    expect(providers).toEqual(["mock", "codex", "gemini", "opencode", "antigravity", "pi"]);
  });

  it("55. retrieves new provider adapters by name", () => {
    // Arrange
    const dummyConfig = {
      providers: {
        opencode: { command: "opencode" },
        antigravity: { command: "agy" },
        pi: { command: "pi" }
      }
    } as unknown as ResolvedConfig;
    const registry = createDefaultProviderRegistry({ config: dummyConfig });

    // Act
    const opencode = registry.get("opencode");
    const antigravity = registry.get("antigravity");
    const pi = registry.get("pi");

    // Assert
    expect(opencode.name).toBe("opencode");
    expect(antigravity.name).toBe("antigravity");
    expect(pi.name).toBe("pi");
  });

  // Keep existing utility tests
  it("registers and retrieves adapters", () => {
    const registry = new ProviderRegistry();
    const mockAdapter: AgentAdapter = {
      name: "test-provider",
      async buildCommand() {
        return { command: "test", args: [], cwd: "", env: {} };
      },
      async parseResult() {
        return {};
      }
    };

    registry.register(mockAdapter);
    expect(registry.get("test-provider")).toBe(mockAdapter);
  });

  it("rejects duplicate registration", () => {
    const registry = new ProviderRegistry();
    const mockAdapter: AgentAdapter = {
      name: "test-provider",
      async buildCommand() { return { command: "t", args: [], cwd: "", env: {} }; },
      async parseResult() { return {}; }
    };

    registry.register(mockAdapter);
    expect(() => registry.register(mockAdapter)).toThrow("Provider adapter already registered: test-provider");
  });
});
