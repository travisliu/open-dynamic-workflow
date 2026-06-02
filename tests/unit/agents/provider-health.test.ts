import { describe, expect, it } from "vitest";
import { checkProviderHealth } from "../../../src/agents/provider-health.js";
import { ProviderRegistry } from "../../../src/agents/registry.js";
import { MockAdapter } from "../../../src/agents/mock-adapter.js";
import { CodexExecAdapter } from "../../../src/agents/codex-exec.js";
import { GeminiCliAdapter } from "../../../src/agents/gemini-cli.js";

describe("checkProviderHealth", () => {
  it("reports mock available, and missing codex/gemini unavailable", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockAdapter());
    registry.register(new CodexExecAdapter({ command: "non-existent-codex-cmd" }));
    registry.register(new GeminiCliAdapter({ command: "non-existent-gemini-cmd" }));

    const healths = await checkProviderHealth(registry);
    expect(healths).toHaveLength(3);

    const mockHealth = healths.find(h => h.provider === "mock");
    expect(mockHealth?.available).toBe(true);

    const codexHealth = healths.find(h => h.provider === "codex");
    expect(codexHealth?.available).toBe(false);
    expect(codexHealth?.message).toContain("not available");

    const geminiHealth = healths.find(h => h.provider === "gemini");
    expect(geminiHealth?.available).toBe(false);
    expect(geminiHealth?.message).toContain("not available");
  });

  it("does not throw if checkHealth fails internally", async () => {
    const registry = new ProviderRegistry();
    const failingAdapter = {
      name: "broken",
      async buildCommand() {
        return { command: "test", args: [], cwd: "", env: {} };
      },
      async parseResult() {
        return {};
      },
      async checkHealth() {
        throw new Error("Internal crash during check");
      }
    };
    registry.register(failingAdapter);

    const healths = await checkProviderHealth(registry);
    expect(healths).toHaveLength(1);
    expect(healths[0]?.provider).toBe("broken");
    expect(healths[0]?.available).toBe(false);
    expect(healths[0]?.error?.message).toBe("Internal crash during check");
  });
});
