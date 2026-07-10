import { describe, expect, it } from "vitest";
import { resolveProviderAliases } from "../../../src/config/provider-aliases.js";
import { BUILT_IN_PROVIDER_NAMES } from "../../../src/agents/provider-names.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

describe("provider-alias-schema", () => {
  const dummyProviders = {
    codex: { command: "codex" },
    gemini: { command: "gemini" }
  };
  const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

  it("succeeds with omitted aliases", () => {
    const result = resolveProviderAliases({
      rawAliases: undefined,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    expect(result.aliases).toEqual({});
  });

  it("rejects non-object maps", () => {
    expect(() => {
      resolveProviderAliases({
        rawAliases: "not-an-object",
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);
  });

  it("rejects accessors/getters that must not execute", () => {
    let getterCalled = false;
    const rawAliases = {};
    Object.defineProperty(rawAliases, "alias-1", {
      get() {
        getterCalled = true;
        return { provider: "codex" };
      },
      enumerable: true
    });

    expect(() => {
      resolveProviderAliases({
        rawAliases,
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);
    expect(getterCalled).toBe(false);
  });

  it("rejects unsafe keys/prototypes/symbols", () => {
    // Unsafe prototype
    const customProto = Object.create({ inherited: "value" });
    customProto.alias1 = { provider: "codex" };

    expect(() => {
      resolveProviderAliases({
        rawAliases: customProto,
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow();

    // Dangerous keys: __proto__
    const protoKey = {
      "__proto__": { provider: "codex" }
    };
    expect(() => {
      resolveProviderAliases({
        rawAliases: protoKey,
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow();

    // Symbols
    const sym = Symbol("test");
    const symbolKey = {
      [sym]: { provider: "codex" }
    };
    expect(() => {
      resolveProviderAliases({
        rawAliases: symbolKey,
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow();
  });

  it("rejects invalid names", () => {
    const invalidNames = ["", "  ", "a b", "a/b", ".a", "-a", "_a", "a".repeat(129)];
    for (const name of invalidNames) {
      expect(() => {
        resolveProviderAliases({
          rawAliases: { [name]: { provider: "codex" } },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8
        });
      }).toThrow();
    }
  });

  it("rejects invalid max depth", () => {
    const invalidDepths = [0, -1, 3.5, "8" as any];
    for (const depth of invalidDepths) {
      expect(() => {
        resolveProviderAliases({
          rawAliases: { alias1: { provider: "codex" } },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: depth
        });
      }).toThrow();
    }
  });

  it("rejects forbidden/non-allowlisted fields", () => {
    const forbiddenConfigs = [
      { provider: "codex", permissions: [] },
      { provider: "codex", command: "run" },
      { provider: "codex", args: [] },
      { provider: "codex", env: {} }
    ];
    for (const conf of forbiddenConfigs) {
      expect(() => {
        resolveProviderAliases({
          rawAliases: { alias1: conf },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8
        });
      }).toThrow();
    }
  });

  it("validates type/value rules for provider, extends, model, thinkingEffort, timeoutMs, and retry", () => {
    const badCases = [
      { provider: 123 },
      { provider: "" },
      { extends: 123 },
      { extends: "" },
      { provider: "codex", model: 123 },
      { provider: "codex", thinkingEffort: "invalid" },
      { provider: "codex", timeoutMs: -1 },
      { provider: "codex", timeoutMs: 0 },
      { provider: "codex", timeoutMs: "100" },
      { provider: "codex", retry: "yes" },
      { provider: "codex", retry: { maxAttempts: 0 } },
      { provider: "codex", retry: { delayMs: -1 } },
      { provider: "codex", retry: { backoff: "invalid" } },
      { provider: "codex", retry: { jitter: "yes" } },
      { provider: "codex", retry: { disableDelay: "no" } },
      { provider: "codex", retry: { retryOn: [] } }
    ];
    for (const conf of badCases) {
      expect(() => {
        resolveProviderAliases({
          rawAliases: { alias1: conf },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8
        });
      }).toThrow();
    }
  });

  it("accepts model: null", () => {
    const result = resolveProviderAliases({
      rawAliases: { alias1: { provider: "codex", model: null } },
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    expect(result.aliases["alias1"].model).toBeNull();
  });

  it("rejects collisions with built-in names and configured providers", () => {
    // Built-in collision
    expect(() => {
      resolveProviderAliases({
        rawAliases: { codex: { provider: "codex" } },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow();

    // Configured collision
    // dummyProviders has 'gemini'
    expect(() => {
      resolveProviderAliases({
        rawAliases: { gemini: { provider: "codex" } },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow();
  });
});
