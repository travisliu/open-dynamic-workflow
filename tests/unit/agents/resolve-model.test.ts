import { describe, expect, it } from "vitest";
import { resolveAgentModel } from "../../../src/agents/resolve-model.js";

describe("resolveAgentModel", () => {
  it("resolves to agent model when provided (highest precedence)", () => {
    const result = resolveAgentModel({
      agentModel: "agent-selected",
      cliModel: "cli-selected",
      providerDefaultModel: "provider-selected",
      globalDefaultModel: "global-selected"
    });
    expect(result.model).toBe("agent-selected");
    expect(result.source).toBe("agent");
  });

  it("resolves to CLI model when no agent model, but CLI model is provided", () => {
    const result = resolveAgentModel({
      cliModel: "cli-selected",
      providerDefaultModel: "provider-selected",
      globalDefaultModel: "global-selected"
    });
    expect(result.model).toBe("cli-selected");
    expect(result.source).toBe("cli");
  });

  it("resolves to provider-config model when no agent/CLI model, but provider default is provided", () => {
    const result = resolveAgentModel({
      providerDefaultModel: "provider-selected",
      globalDefaultModel: "global-selected"
    });
    expect(result.model).toBe("provider-selected");
    expect(result.source).toBe("provider-config");
  });

  it("resolves to global-config model when no agent/CLI/provider model, but global default is provided", () => {
    const result = resolveAgentModel({
      globalDefaultModel: "global-selected"
    });
    expect(result.model).toBe("global-selected");
    expect(result.source).toBe("global-config");
  });

  it("resolves to provider-default (undefined model) when nothing is provided", () => {
    const result = resolveAgentModel({});
    expect(result.model).toBeUndefined();
    expect(result.source).toBe("provider-default");
  });

  it("falls back past empty CLI model strings", () => {
    const result = resolveAgentModel({
      cliModel: "   ",
      providerDefaultModel: "provider-selected"
    });
    expect(result.model).toBe("provider-selected");
    expect(result.source).toBe("provider-config");
  });

  it("falls back past null provider/global configs", () => {
    const result = resolveAgentModel({
      providerDefaultModel: null,
      globalDefaultModel: null
    });
    expect(result.model).toBeUndefined();
    expect(result.source).toBe("provider-default");
  });
});
