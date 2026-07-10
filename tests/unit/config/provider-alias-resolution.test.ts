import { describe, expect, it } from "vitest";
import {
  resolveProviderAliases,
  toResolvedProviderAliasArtifactRegistry
} from "../../../src/config/provider-aliases.js";
import { BUILT_IN_PROVIDER_NAMES } from "../../../src/agents/provider-names.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

describe("provider-alias-resolution", () => {
  const dummyProviders = {
    codex: { command: "codex" },
    gemini: { command: "gemini" }
  };
  const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

  it("resolves root aliases and inheritance chains correctly", () => {
    const rawAliases = {
      "codex-base": {
        provider: "codex",
        model: "gpt-4",
        timeoutMs: 1000,
        retry: { maxAttempts: 3 }
      },
      "codex-child": {
        extends: "codex-base",
        model: "gpt-5",
        timeoutMs: 2000
      }
    };

    const result = resolveProviderAliases({
      rawAliases,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    const base = result.aliases["codex-base"];
    const child = result.aliases["codex-child"];

    // inheritanceChain order
    expect(base.inheritanceChain).toEqual(["codex-base"]);
    expect(child.inheritanceChain).toEqual(["codex-base", "codex-child"]);

    // parent-first override
    expect(child.provider).toBe("codex");
    expect(child.model).toBe("gpt-5"); // child override wins
    expect(child.timeoutMs).toBe(2000); // child override wins
    expect(child.retry).toEqual({ maxAttempts: 3 }); // inherits parent retry
  });

  it("handles retry inheritance patterns correctly", () => {
    const rawAliases = {
      // Parent with retry object
      "p-object": {
        provider: "codex",
        retry: { maxAttempts: 3, delayMs: 100 }
      },
      // Child omitted retry inherits parent object
      "c-omitted-retry": {
        extends: "p-object"
      },
      // Child false replaces parent retry
      "c-false-retry": {
        extends: "p-object",
        retry: false
      },
      // Child object merges field-by-field over parent object
      "c-merge-retry": {
        extends: "p-object",
        retry: { delayMs: 200, jitter: true }
      },
      // Child object over false/omitted
      "c-object-over-false": {
        extends: "c-false-retry",
        retry: { maxAttempts: 5 }
      }
    };

    const result = resolveProviderAliases({
      rawAliases,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    expect(result.aliases["c-omitted-retry"].retry).toEqual({ maxAttempts: 3, delayMs: 100 });
    expect(result.aliases["c-false-retry"].retry).toBe(false);
    expect(result.aliases["c-merge-retry"].retry).toEqual({ maxAttempts: 3, delayMs: 200, jitter: true });
    expect(result.aliases["c-object-over-false"].retry).toEqual({ maxAttempts: 5 });
  });

  it("checks missing parent, cycles, depth boundary, same provider repetition, provider replacement, and unknown provider", () => {
    // Missing parent
    expect(() => {
      resolveProviderAliases({
        rawAliases: { child: { extends: "non-existent" } },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);

    // Self cycle
    expect(() => {
      resolveProviderAliases({
        rawAliases: { a: { extends: "a" } },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);

    // Multi-node cycle
    expect(() => {
      resolveProviderAliases({
        rawAliases: {
          a: { extends: "b" },
          b: { extends: "c" },
          c: { extends: "a" }
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);

    // Exact depth boundary and overflow
    const maxDepthAliases = {
      a: { provider: "codex" },
      b: { extends: "a" },
      c: { extends: "b" }
    };
    // Depth 3: a (1), b (2), c (3)
    const successResult = resolveProviderAliases({
      rawAliases: maxDepthAliases,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 3
    });
    expect(successResult.aliases["c"]).toBeDefined();

    expect(() => {
      resolveProviderAliases({
        rawAliases: maxDepthAliases,
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 2
      });
    }).toThrow(OpenDynamicWorkflowError);

    // Root without provider
    expect(() => {
      resolveProviderAliases({
        rawAliases: { a: { model: "gpt" } },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);

    // Unknown provider
    expect(() => {
      resolveProviderAliases({
        rawAliases: { a: { provider: "unknown-provider" } },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);

    // Same provider repetition is allowed
    const sameRepResult = resolveProviderAliases({
      rawAliases: {
        parent: { provider: "codex" },
        child: { extends: "parent", provider: "codex" }
      },
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    expect(sameRepResult.aliases["child"].provider).toBe("codex");

    // Provider replacement is rejected
    expect(() => {
      resolveProviderAliases({
        rawAliases: {
          parent: { provider: "codex" },
          child: { extends: "parent", provider: "gemini" }
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);
  });

  it("verifies origins and retry field-level provenance", () => {
    const rawAliases = {
      "p": {
        provider: "codex",
        model: "gpt-4",
        retry: { maxAttempts: 3, delayMs: 100 }
      },
      "c": {
        extends: "p",
        retry: { delayMs: 200 }
      }
    };

    const result = resolveProviderAliases({
      rawAliases,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    const child = result.aliases["c"];
    expect(child.origins.provider).toBe("p");
    expect(child.origins.model).toBe("p");
    expect(child.origins.retry?.sourceAlias).toBe("c");
    expect(child.origins.retry?.fieldSources.maxAttempts).toBe("p");
    expect(child.origins.retry?.fieldSources.delayMs).toBe("c");
  });

  it("verifies data immutability and freezing", () => {
    const rawAliases = {
      a: {
        provider: "codex",
        retry: { maxAttempts: 3 }
      }
    };
    const result = resolveProviderAliases({
      rawAliases,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    const alias = result.aliases["a"];
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.aliases)).toBe(true);
    expect(Object.isFrozen(alias)).toBe(true);
    expect(Object.isFrozen(alias.inheritanceChain)).toBe(true);
    expect(Object.isFrozen(alias.retry)).toBe(true);
    expect(Object.isFrozen(alias.origins)).toBe(true);
    expect(Object.getPrototypeOf(result.aliases)).toBeNull();

    // Mutating frozen objects throws in strict mode
    expect(() => {
      (result.aliases as any)["b"] = {};
    }).toThrow();
    expect(() => {
      (alias as any).model = "gpt-5";
    }).toThrow();
  });

  it("verifies digests are stable, deterministic, and respond to setting changes", () => {
    const rawAliases1 = {
      b: { provider: "codex", model: "gpt-4" },
      a: { provider: "codex", model: "gpt-4" }
    };
    const rawAliases2 = {
      a: { provider: "codex", model: "gpt-4" },
      b: { provider: "codex", model: "gpt-4" }
    };

    const r1 = resolveProviderAliases({
      rawAliases: rawAliases1,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    const r2 = resolveProviderAliases({
      rawAliases: rawAliases2,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    // Stability across insertion order
    expect(r1.aliases["a"].digest).toBe(r2.aliases["a"].digest);
    expect(r1.aliases["b"].digest).toBe(r2.aliases["b"].digest);

    // Changes on model modification
    const r3 = resolveProviderAliases({
      rawAliases: { a: { provider: "codex", model: "gpt-5" } },
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    expect(r3.aliases["a"].digest).not.toBe(r1.aliases["a"].digest);

    // Changes on model: null
    const rNull = resolveProviderAliases({
      rawAliases: { a: { provider: "codex", model: null } },
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    expect(rNull.aliases["a"].digest).not.toBe(r1.aliases["a"].digest);

    // Changes on retry: false
    const rRetryFalse = resolveProviderAliases({
      rawAliases: { a: { provider: "codex", model: "gpt-4", retry: false } },
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    expect(rRetryFalse.aliases["a"].digest).not.toBe(r1.aliases["a"].digest);

    // Changes on parent chain rename
    const rRenameParent = resolveProviderAliases({
      rawAliases: {
        parentNew: { provider: "codex" },
        child: { extends: "parentNew" }
      },
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    const rOldParent = resolveProviderAliases({
      rawAliases: {
        parentOld: { provider: "codex" },
        child: { extends: "parentOld" }
      },
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    expect(rRenameParent.aliases["child"].digest).not.toBe(rOldParent.aliases["child"].digest);
  });

  it("verifies sorted registry keys and deterministic first-error selection", () => {
    const rawAliases = {
      c: { provider: "codex" },
      a: { provider: "codex" },
      b: { provider: "codex" }
    };
    const result = resolveProviderAliases({
      rawAliases,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    const keys = Object.keys(result.aliases);
    expect(keys).toEqual(["a", "b", "c"]);

    // First error determinism: both 'a' and 'b' are invalid (cycle)
    // a -> b -> a
    // If we sort names, 'a' should be visited first and throw error referencing 'a' first
    expect(() => {
      resolveProviderAliases({
        rawAliases: {
          b: { extends: "a" },
          a: { extends: "b" }
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(OpenDynamicWorkflowError);
  });

  it("verifies the artifact projection helper", () => {
    const rawAliases = {
      parent: { provider: "codex", model: "gpt-4", retry: { maxAttempts: 2 } },
      child: { extends: "parent", model: "gpt-5" }
    };

    const result = resolveProviderAliases({
      rawAliases,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    const artifacts = toResolvedProviderAliasArtifactRegistry(result.aliases);

    // Sorted keys
    expect(Object.keys(artifacts)).toEqual(["child", "parent"]);

    // Excludes origins
    expect((artifacts["child"] as any).origins).toBeUndefined();
    expect((artifacts["parent"] as any).origins).toBeUndefined();

    // Retains other settings
    expect(artifacts["child"].name).toBe("child");
    expect(artifacts["child"].provider).toBe("codex");
    expect(artifacts["child"].model).toBe("gpt-5");
    expect(artifacts["child"].retry).toEqual({ maxAttempts: 2 });
    expect(artifacts["child"].digest).toBeDefined();

    // Does not share mutable references
    expect(artifacts["child"].retry).not.toBe(result.aliases["child"].retry);
    expect(Object.isFrozen(artifacts)).toBe(true);
    expect(Object.isFrozen(artifacts["child"])).toBe(true);
  });

  it("verifies canonical provider-alias retry output keys and JSON determinism", () => {
    const rawAliases1 = {
      a: {
        provider: "codex",
        retry: { maxAttempts: 2, delayMs: 4, backoff: "exponential" as const }
      }
    };
    const rawAliases2 = {
      a: {
        provider: "codex",
        retry: { backoff: "exponential" as const, delayMs: 4, maxAttempts: 2 }
      }
    };

    const r1 = resolveProviderAliases({
      rawAliases: rawAliases1,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    const r2 = resolveProviderAliases({
      rawAliases: rawAliases2,
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });

    // 1. Assert both resolved retry objects have the fixed Object.keys() order, deep equality, and identical digest
    const keys1 = Object.keys(r1.aliases["a"].retry as any);
    const keys2 = Object.keys(r2.aliases["a"].retry as any);
    expect(keys1).toEqual(["maxAttempts", "delayMs", "backoff"]);
    expect(keys2).toEqual(["maxAttempts", "delayMs", "backoff"]);
    expect(r1.aliases["a"].retry).toEqual(r2.aliases["a"].retry);
    expect(r1.aliases["a"].digest).toBe(r2.aliases["a"].digest);

    // 2. Project both registries and assert JSON.stringify() of projected registries is identical
    const artifacts1 = toResolvedProviderAliasArtifactRegistry(r1.aliases);
    const artifacts2 = toResolvedProviderAliasArtifactRegistry(r2.aliases);
    expect(JSON.stringify(artifacts1)).toBe(JSON.stringify(artifacts2));
  });

  it("verifies provider immutability repeated normalization", () => {
    // 1. Resolve parent: { provider: "codex" } and child: { extends: "parent", provider: "codex" }
    const result = resolveProviderAliases({
      rawAliases: {
        parent: { provider: "codex" },
        child: { extends: "parent", provider: "codex" }
      },
      providers: dummyProviders,
      builtInProviderNames: builtInNames,
      maxDepth: 8
    });
    // Assert child.origins.provider === "parent", proving repeated provider normalized away
    expect(result.aliases["child"].origins.provider).toBe("parent");

    // 2. Resolve a child that uses a different provider and assert it still returns PROVIDER_ALIAS_PROVIDER_REPLACEMENT
    expect(() => {
      resolveProviderAliases({
        rawAliases: {
          parent: { provider: "codex" },
          child: { extends: "parent", provider: "gemini" }
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8
      });
    }).toThrow(
      expect.objectContaining({
        code: "PROVIDER_ALIAS_PROVIDER_REPLACEMENT"
      })
    );
  });

  it("verifies depth limit error chain root-to-leaf reporting", () => {
    // 1. Child sorts before root (a extends z) and maxDepth: 1
    let error1: any;
    try {
      resolveProviderAliases({
        rawAliases: {
          z: { provider: "codex" },
          a: { extends: "z" }
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 1
      });
    } catch (err: any) {
      error1 = err;
    }
    expect(error1).toBeDefined();
    expect(error1.code).toBe("PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED");
    expect(error1.cause.limit).toBe(1);
    expect(error1.cause.inheritanceChain).toEqual(["z", "a"]);

    // 2. Three-node reverse-sorted chain test (a extends b, b extends c, c is root) and maxDepth: 2
    let error2: any;
    try {
      resolveProviderAliases({
        rawAliases: {
          c: { provider: "codex" },
          b: { extends: "c" },
          a: { extends: "b" }
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 2
      });
    } catch (err: any) {
      error2 = err;
    }
    expect(error2).toBeDefined();
    expect(error2.code).toBe("PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED");
    expect(error2.cause.limit).toBe(2);
    expect(error2.cause.inheritanceChain).toEqual(["c", "b", "a"]);
  });
});
