import { describe, expect, it } from "vitest";
import { ProviderRegistry, createDefaultProviderRegistry } from "../../../src/agents/registry.js";
import type { AgentAdapter, ResolvedConfig } from "../../../src/agents/types.js";

describe("ProviderRegistry", () => {
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
    expect(registry.list()).toContain(mockAdapter);
  });

  it("rejects duplicate registration", () => {
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
    expect(() => registry.register(mockAdapter)).toThrow("Provider adapter already registered: test-provider");
  });

  it("throws clear error for unknown provider", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get("non-existent")).toThrow("Unknown provider: non-existent");
  });

  it("creates default registry with mock, codex, and gemini", () => {
    const dummyConfig = {
      defaultProvider: "mock",
      concurrency: 1,
      timeoutMs: 1000,
      providers: {
        codex: { command: "codex" },
        gemini: { command: "gemini" }
      },
      security: {
        allowShell: false,
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

    const registry = createDefaultProviderRegistry({ config: dummyConfig });
    expect(registry.get("mock").name).toBe("mock");
    expect(registry.get("codex").name).toBe("codex");
    expect(registry.get("gemini").name).toBe("gemini");
    expect(registry.list().map(a => a.name)).toEqual(["mock", "codex", "gemini"]);
  });
});
