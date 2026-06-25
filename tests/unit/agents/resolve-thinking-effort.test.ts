import { describe, expect, it } from "vitest";
import { resolveThinkingEffort } from "../../../src/agents/resolve-thinking-effort.js";

describe("resolveThinkingEffort", () => {
  it("per-agent value wins over CLI and provider config", () => {
    const result = resolveThinkingEffort({
      agentThinkingEffort: "high",
      cliThinkingEffort: "low",
      providerDefaultThinkingEffort: "medium"
    });
    expect(result).toEqual({
      thinkingEffort: "high",
      source: "agent"
    });
  });

  it("CLI wins over provider config", () => {
    const result = resolveThinkingEffort({
      agentThinkingEffort: undefined,
      cliThinkingEffort: "low",
      providerDefaultThinkingEffort: "medium"
    });
    expect(result).toEqual({
      thinkingEffort: "low",
      source: "cli"
    });
  });

  it("provider config is used when higher levels are absent", () => {
    const result = resolveThinkingEffort({
      agentThinkingEffort: undefined,
      cliThinkingEffort: undefined,
      providerDefaultThinkingEffort: "medium"
    });
    expect(result).toEqual({
      thinkingEffort: "medium",
      source: "provider-default"
    });
  });

  it("no value returns provider-cli-default with no effort", () => {
    const result = resolveThinkingEffort({
      agentThinkingEffort: undefined,
      cliThinkingEffort: undefined,
      providerDefaultThinkingEffort: undefined
    });
    expect(result).toEqual({
      thinkingEffort: undefined,
      source: "provider-cli-default"
    });
  });

  it("off is preserved as a real value", () => {
    const result = resolveThinkingEffort({
      agentThinkingEffort: "off",
      cliThinkingEffort: "high",
      providerDefaultThinkingEffort: "medium"
    });
    expect(result).toEqual({
      thinkingEffort: "off",
      source: "agent"
    });
  });
});
