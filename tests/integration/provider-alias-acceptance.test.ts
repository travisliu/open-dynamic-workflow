import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { loadConfig } from "../../src/config/load.js";
import { resolveProviderAliases } from "../../src/config/provider-aliases.js";
import { toResolvedConfigArtifact } from "../../src/config/resolved-artifact.js";
import { FileSystemArtifactStore } from "../../src/artifacts/run-store.js";
import { ErrorCode } from "../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../src/errors/types.js";
import { exitCodeForError, ExitCode } from "../../src/errors/exit-codes.js";
import { BUILT_IN_PROVIDER_NAMES } from "../../src/agents/provider-names.js";

const TEMP_DIR = path.resolve("tests/temp-provider-alias-acceptance");

describe("Provider Alias Configuration Foundation Acceptance Tests", () => {
  const dummyProviders = {
    codex: { command: "codex" },
    gemini: { command: "gemini" },
    customProvider: { command: "custom-bin" },
  };

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  describe("AC-1: Contracts, defaults, and immutable registry", () => {
    it("AC-1.1 & 1.2: loadConfig with no aliases returns depth 8 and empty registry", async () => {
      // Arrange
      const configPath = path.join(TEMP_DIR, "config.yaml");
      await fs.writeFile(configPath, `
providers:
  codex:
    command: codex
`);

      // Act
      const config = await loadConfig({
        cwd: TEMP_DIR,
        configPath,
        cli: {},
      });

      // Assert
      expect(config.providerAliasMaxDepth).toBe(8);
      expect(config.providerAliases).toEqual({});
      expect(Object.getPrototypeOf(config.providerAliases)).toBeNull();
    });

    it("AC-1.3: resolved registry is deeply frozen and does not share mutable references", () => {
      // Arrange
      const rawAliases = {
        "gemini-alias": {
          provider: "gemini",
          model: "gemini-1.5-pro",
          timeoutMs: 5000,
          retry: {
            maxAttempts: 3,
            delayMs: 100,
          },
        },
      };

      // Act
      const result = resolveProviderAliases({
        rawAliases,
        providers: dummyProviders,
        builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
        maxDepth: 8,
      });

      // Assert
      const resolved = result.aliases["gemini-alias"];
      expect(Object.isFrozen(result.aliases)).toBe(true);
      expect(Object.isFrozen(resolved)).toBe(true);
      expect(Object.isFrozen(resolved.inheritanceChain)).toBe(true);
      expect(Object.isFrozen(resolved.retry)).toBe(true);
      expect(Object.isFrozen(resolved.origins)).toBe(true);
      expect(Object.isFrozen(resolved.origins.retry)).toBe(true);

      // Verify no shared references
      expect(resolved.retry).not.toBe(rawAliases["gemini-alias"].retry);
      // Try to mutate to see if frozen throws in strict mode
      expect(() => {
        (resolved as any).model = "mutated";
      }).toThrow();
    });
  });

  describe("AC-2: Strict raw alias validation", () => {
    it("AC-2.1: rejects non-object maps, arrays, Map/Set, symbol keys, and getters (without invoking)", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      // Arrange & Act & Assert: Array rejection
      expect(() => {
        resolveProviderAliases({
          rawAliases: [{ provider: "codex" }],
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);

      // Arrange & Act & Assert: Map rejection
      expect(() => {
        resolveProviderAliases({
          rawAliases: new Map([["my-alias", { provider: "codex" }]]),
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);

      // Arrange & Act & Assert: Symbol key rejection
      const symbolKey = Symbol("invalid");
      expect(() => {
        resolveProviderAliases({
          rawAliases: { [symbolKey]: { provider: "codex" } },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);

      // Arrange & Act & Assert: Getter rejection without calling
      let getterCalled = false;
      const rawWithGetter = {};
      Object.defineProperty(rawWithGetter, "my-alias", {
        get() {
          getterCalled = true;
          return { provider: "codex" };
        },
        enumerable: true,
      });

      expect(() => {
        resolveProviderAliases({
          rawAliases: rawWithGetter,
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);
      expect(getterCalled).toBe(false);
    });

    it("AC-2.2: rejects proto, prototype, constructor boundaries", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      // Arrange
      const rawWithProto = Object.create(null);
      rawWithProto["__proto__"] = { provider: "codex" };

      const rawWithPrototype = Object.create(null);
      rawWithPrototype["prototype"] = { provider: "codex" };

      const rawWithConstructor = Object.create(null);
      rawWithConstructor["constructor"] = { provider: "codex" };

      // Act & Assert
      expect(() => {
        resolveProviderAliases({
          rawAliases: rawWithProto,
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);

      expect(() => {
        resolveProviderAliases({
          rawAliases: rawWithPrototype,
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);

      expect(() => {
        resolveProviderAliases({
          rawAliases: rawWithConstructor,
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);
    });

    it("AC-2.3: checks name boundaries (length and regex)", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      const validNames = ["a", "alias-1", "alias.name", "alias_name", "A1"];
      const invalidNames = [
        "",
        " ",
        "alias name",
        "alias/name",
        ".alias",
        "-alias",
        "_alias",
        "a".repeat(129),
      ];

      for (const name of validNames) {
        expect(() => {
          resolveProviderAliases({
            rawAliases: { [name]: { provider: "codex" } },
            providers: dummyProviders,
            builtInProviderNames: builtInNames,
            maxDepth: 8,
          });
        }).not.toThrow();
      }

      for (const name of invalidNames) {
        expect(() => {
          resolveProviderAliases({
            rawAliases: { [name]: { provider: "codex" } },
            providers: dummyProviders,
            builtInProviderNames: builtInNames,
            maxDepth: 8,
          });
        }).toThrow(OpenDynamicWorkflowError);
      }
    });

    it("AC-2.4 & 2.5: rejects invalid keys (security blocks) and validates value types", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      // Blocklist test: permissions, command, args, env
      const blocklistFields = ["permissions", "command", "args", "env"];
      for (const field of blocklistFields) {
        expect(() => {
          resolveProviderAliases({
            rawAliases: {
              "my-alias": {
                provider: "codex",
                [field]: "some-value",
              },
            },
            providers: dummyProviders,
            builtInProviderNames: builtInNames,
            maxDepth: 8,
          });
        }).toThrow(OpenDynamicWorkflowError);
      }

      // Valid timeoutMs (positive integer) vs invalid
      expect(() => {
        resolveProviderAliases({
          rawAliases: {
            "my-alias": { provider: "codex", timeoutMs: -10 },
          },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);

      expect(() => {
        resolveProviderAliases({
          rawAliases: {
            "my-alias": { provider: "codex", timeoutMs: 1.5 },
          },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(OpenDynamicWorkflowError);

      // Valid model: null is accepted
      expect(() => {
        resolveProviderAliases({
          rawAliases: {
            "my-alias": { provider: "codex", model: null },
          },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).not.toThrow();
    });

    it("AC-2.6: validates providerAliasMaxDepth is a positive integer", async () => {
      const configPath = path.join(TEMP_DIR, "config.yaml");

      // Arrange: depth is negative
      await fs.writeFile(configPath, `
providerAliasMaxDepth: -2
providers:
  codex:
    command: codex
`);

      // Act & Assert
      await expect(
        loadConfig({
          cwd: TEMP_DIR,
          configPath,
          cli: {},
        })
      ).rejects.toThrow(OpenDynamicWorkflowError);
    });
  });

  describe("AC-3: Dedicated error and exit surface", () => {
    it("AC-3.2: exitCodeForError maps all nine provider alias codes to exit code 3 (WorkflowInvalid)", () => {
      const codes = [
        ErrorCode.PROVIDER_ALIAS_INVALID_DEFINITION,
        ErrorCode.PROVIDER_ALIAS_DUPLICATE_DEFINITION,
        ErrorCode.PROVIDER_ALIAS_NAMESPACE_CONFLICT,
        ErrorCode.PROVIDER_ALIAS_PARENT_NOT_FOUND,
        ErrorCode.PROVIDER_ALIAS_CYCLE_DETECTED,
        ErrorCode.PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED,
        ErrorCode.PROVIDER_ALIAS_PROVIDER_REQUIRED,
        ErrorCode.PROVIDER_ALIAS_PROVIDER_REPLACEMENT,
        ErrorCode.PROVIDER_ALIAS_PROVIDER_NOT_FOUND,
      ];

      for (const code of codes) {
        const err = new OpenDynamicWorkflowError(code, "test error message");
        expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
      }
    });
  });

  describe("AC-4: Reserved provider namespace", () => {
    it("AC-4.1 & 4.2: rejects naming aliases after built-in providers or custom configured providers", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      // Collision with built-in
      for (const name of BUILT_IN_PROVIDER_NAMES) {
        expect(() => {
          resolveProviderAliases({
            rawAliases: { [name]: { provider: "codex" } },
            providers: dummyProviders,
            builtInProviderNames: builtInNames,
            maxDepth: 8,
          });
        }).toThrow(
          expect.objectContaining({
            code: ErrorCode.PROVIDER_ALIAS_NAMESPACE_CONFLICT,
          })
        );
      }

      // Collision with custom configured provider key
      expect(() => {
        resolveProviderAliases({
          rawAliases: { customProvider: { provider: "codex" } },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      }).toThrow(
        expect.objectContaining({
          code: ErrorCode.PROVIDER_ALIAS_NAMESPACE_CONFLICT,
        })
      );
    });

    it("AC-4.3: selects the first sorted conflict name regardless of input order", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      const rawOrder1 = {
        gemini: { provider: "codex" }, // built-in
        copilot: { provider: "codex" }, // built-in
      };

      const rawOrder2 = {
        copilot: { provider: "codex" },
        gemini: { provider: "codex" },
      };

      let error1: any;
      let error2: any;

      try {
        resolveProviderAliases({
          rawAliases: rawOrder1,
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      } catch (err) {
        error1 = err;
      }

      try {
        resolveProviderAliases({
          rawAliases: rawOrder2,
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      } catch (err) {
        error2 = err;
      }

      expect(error1.code).toBe(ErrorCode.PROVIDER_ALIAS_NAMESPACE_CONFLICT);
      expect(error2.code).toBe(ErrorCode.PROVIDER_ALIAS_NAMESPACE_CONFLICT);
      // 'copilot' sorts before 'gemini' alphabetically
      expect(error1.cause?.alias).toBe("copilot");
      expect(error2.cause?.alias).toBe("copilot");
    });
  });

  describe("AC-5: Deterministic DFS, parents, cycles, and depth", () => {
    it("AC-5.2: reports missing parent with safe alias and parent details", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      let error: any;
      try {
        resolveProviderAliases({
          rawAliases: {
            child: { extends: "non-existent" },
          },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(OpenDynamicWorkflowError);
      expect(error.code).toBe(ErrorCode.PROVIDER_ALIAS_PARENT_NOT_FOUND);
      expect(error.cause?.alias).toBe("child");
      expect(error.cause?.parent).toBe("non-existent");
    });

    it("AC-5.3: detects self-cycles and multi-node cycles and returns the exact cycle stack in inheritanceChain", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      // Self-cycle
      try {
        resolveProviderAliases({
          rawAliases: {
            loop: { extends: "loop" },
          },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.PROVIDER_ALIAS_CYCLE_DETECTED);
        expect(err.cause?.inheritanceChain).toEqual(["loop", "loop"]);
      }

      // Multi-node cycle
      try {
        resolveProviderAliases({
          rawAliases: {
            a: { extends: "b" },
            b: { extends: "c" },
            c: { extends: "a" },
          },
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 8,
        });
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.PROVIDER_ALIAS_CYCLE_DETECTED);
        // The chain contains the path ending in a closed cycle
        expect(err.cause?.inheritanceChain).toContain("a");
        expect(err.cause?.inheritanceChain).toContain("b");
        expect(err.cause?.inheritanceChain).toContain("c");
      }
    });

    it("AC-5.4: depth boundary rules", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      // Chain of length 3 (root -> child -> grandchild) with maxDepth: 3
      const chain3 = {
        root: { provider: "codex" },
        child: { extends: "root" },
        grandchild: { extends: "child" },
      };

      // Succeeds at maxDepth 3
      expect(() => {
        resolveProviderAliases({
          rawAliases: chain3,
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 3,
        });
      }).not.toThrow();

      // Fails at maxDepth 2
      expect(() => {
        resolveProviderAliases({
          rawAliases: chain3,
          providers: dummyProviders,
          builtInProviderNames: builtInNames,
          maxDepth: 2,
        });
      }).toThrow(
        expect.objectContaining({
          code: ErrorCode.PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED,
        })
      );
    });
  });

  describe("AC-6: Inheritance and alias-local retry merging", () => {
    it("AC-6.1: inherits fields and handles overrides", () => {
      const result = resolveProviderAliases({
        rawAliases: {
          parent: {
            provider: "codex",
            model: "gpt-4",
            timeoutMs: 1000,
          },
          child: {
            extends: "parent",
            model: null, // explicit override
            timeoutMs: 2000,
          },
        },
        providers: dummyProviders,
        builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
        maxDepth: 8,
      });

      expect(result.aliases["child"].provider).toBe("codex");
      expect(result.aliases["child"].model).toBeNull();
      expect(result.aliases["child"].timeoutMs).toBe(2000);
    });

    it("AC-6.2: root without provider throws PROVIDER_ALIAS_PROVIDER_REQUIRED", () => {
      expect(() => {
        resolveProviderAliases({
          rawAliases: {
            root: { model: "gpt-4" },
          },
          providers: dummyProviders,
          builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
          maxDepth: 8,
        });
      }).toThrow(
        expect.objectContaining({
          code: ErrorCode.PROVIDER_ALIAS_PROVIDER_REQUIRED,
        })
      );
    });

    it("AC-6.3: different provider in child throws PROVIDER_ALIAS_PROVIDER_REPLACEMENT", () => {
      expect(() => {
        resolveProviderAliases({
          rawAliases: {
            parent: { provider: "codex" },
            child: { extends: "parent", provider: "gemini" },
          },
          providers: dummyProviders,
          builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
          maxDepth: 8,
        });
      }).toThrow(
        expect.objectContaining({
          code: ErrorCode.PROVIDER_ALIAS_PROVIDER_REPLACEMENT,
        })
      );
    });

    it("AC-6.4: unknown final provider key throws PROVIDER_ALIAS_PROVIDER_NOT_FOUND", () => {
      expect(() => {
        resolveProviderAliases({
          rawAliases: {
            root: { provider: "unknownProvider" },
          },
          providers: dummyProviders,
          builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
          maxDepth: 8,
        });
      }).toThrow(
        expect.objectContaining({
          code: ErrorCode.PROVIDER_ALIAS_PROVIDER_NOT_FOUND,
        })
      );
    });

    it("AC-6.5: retry inheritance patterns", () => {
      const result = resolveProviderAliases({
        rawAliases: {
          parent: {
            provider: "codex",
            retry: { maxAttempts: 5, delayMs: 100 },
          },
          childOmitted: {
            extends: "parent",
          },
          childFalse: {
            extends: "parent",
            retry: false,
          },
          childMerge: {
            extends: "parent",
            retry: { delayMs: 200, jitter: true },
          },
        },
        providers: dummyProviders,
        builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
        maxDepth: 8,
      });

      expect(result.aliases["childOmitted"].retry).toEqual({ maxAttempts: 5, delayMs: 100 });
      expect(result.aliases["childFalse"].retry).toBe(false);
      expect(result.aliases["childMerge"].retry).toEqual({
        maxAttempts: 5,
        delayMs: 200,
        jitter: true,
      });
    });
  });

  describe("AC-7: Provenance, digest, and deterministic projection", () => {
    it("AC-7.1 & 7.2: verifies settings origins", () => {
      const result = resolveProviderAliases({
        rawAliases: {
          parent: {
            provider: "codex",
            model: "gpt-4",
            retry: { maxAttempts: 3 },
          },
          child: {
            extends: "parent",
            timeoutMs: 1500,
            retry: { delayMs: 100 },
          },
        },
        providers: dummyProviders,
        builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
        maxDepth: 8,
      });

      const child = result.aliases["child"];
      expect(child.origins.provider).toBe("parent");
      expect(child.origins.model).toBe("parent");
      expect(child.origins.timeoutMs).toBe("child");
      expect(child.origins.retry?.sourceAlias).toBe("child");
      expect(child.origins.retry?.fieldSources).toEqual({
        maxAttempts: "parent",
        delayMs: "child",
      });
    });

    it("AC-7.3 & 7.4: verifies stable/deterministic digest", () => {
      const builtInNames = new Set(BUILT_IN_PROVIDER_NAMES);

      // Order of fields in raw config does not change the digest
      const res1 = resolveProviderAliases({
        rawAliases: {
          a: {
            provider: "codex",
            timeoutMs: 1000,
            model: "gpt-4",
          },
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8,
      });

      const res2 = resolveProviderAliases({
        rawAliases: {
          a: {
            model: "gpt-4",
            timeoutMs: 1000,
            provider: "codex",
          },
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8,
      });

      expect(res1.aliases["a"].digest).toBe(res2.aliases["a"].digest);
      expect(res1.aliases["a"].digest.startsWith("sha256:")).toBe(true);

      // Value change changes digest
      const res3 = resolveProviderAliases({
        rawAliases: {
          a: {
            provider: "codex",
            timeoutMs: 2000,
            model: "gpt-4",
          },
        },
        providers: dummyProviders,
        builtInProviderNames: builtInNames,
        maxDepth: 8,
      });
      expect(res1.aliases["a"].digest).not.toBe(res3.aliases["a"].digest);
    });

    it("AC-7.5: verifies projection utility excludes origins and helper fields", () => {
      const result = resolveProviderAliases({
        rawAliases: {
          aliasA: {
            provider: "codex",
            model: "gpt-4",
          },
        },
        providers: dummyProviders,
        builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
        maxDepth: 8,
      });

      const resolvedConfig = {
        providerAliases: result.aliases,
      };
      const projectedConfig = toResolvedConfigArtifact(resolvedConfig) as any;
      const projected = projectedConfig.providerAliases;
      expect(projected.aliasA).toBeDefined();
      expect(projected.aliasA.name).toBe("aliasA");
      expect(projected.aliasA.provider).toBe("codex");
      expect(projected.aliasA.model).toBe("gpt-4");
      expect(projected.aliasA.digest).toBeDefined();

      // Exclusions
      expect(projected.aliasA.origins).toBeUndefined();
    });
  });

  describe("AC-8: Duplicate-aware YAML document parsing", () => {
    it("AC-8.2: detects duplicate alias under providerAliases and fails with line/col details", async () => {
      const configPath = path.join(TEMP_DIR, "config.yaml");
      await fs.writeFile(
        configPath,
        `
providers:
  codex:
    command: codex
providerAliases:
  aliasA:
    provider: codex
  aliasA:
    provider: gemini
`
      );

      try {
        await loadConfig({
          cwd: TEMP_DIR,
          configPath,
          cli: {},
        });
        expect.unreachable("Should have failed due to duplicate keys");
      } catch (err: any) {
        expect(err.code).toBe("PROVIDER_ALIAS_DUPLICATE_DEFINITION");
        expect(err.message).toContain("Duplicate provider alias definition 'aliasA'");
        expect(err.line).toBe(8); // duplicate aliasA is on line 8
      }
    });

    it("AC-8.3: duplicate fields inside one alias throws CONFIG_VALIDATION_ERROR", async () => {
      const configPath = path.join(TEMP_DIR, "config.yaml");
      await fs.writeFile(
        configPath,
        `
providers:
  codex:
    command: codex
providerAliases:
  aliasA:
    provider: codex
    provider: gemini
`
      );

      await expect(
        loadConfig({
          cwd: TEMP_DIR,
          configPath,
          cli: {},
        })
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.CONFIG_VALIDATION_ERROR,
        })
      );
    });
  });

  describe("AC-9: Loader integration and phase sequencing", () => {
    it("AC-9.2: loadConfig ignores missing config.yaml (ENOENT) and falls back to defaults", async () => {
      // Act
      const config = await loadConfig({
        cwd: TEMP_DIR,
        cli: {},
      });

      // Assert
      expect(config.providerAliases).toEqual({});
      expect(config.providerAliasMaxDepth).toBe(8);
    });

    it("AC-9.3: defaultProvider remains concrete-provider-only and cannot be an alias", async () => {
      const configPath = path.join(TEMP_DIR, "config.yaml");
      await fs.writeFile(
        configPath,
        `
defaultProvider: my-alias
providers:
  codex:
    command: codex
providerAliases:
  my-alias:
    provider: codex
`
      );

      // Act & Assert
      await expect(
        loadConfig({
          cwd: TEMP_DIR,
          configPath,
          cli: {},
        })
      ).rejects.toThrow(
        expect.objectContaining({
          code: ErrorCode.CONFIG_VALIDATION_ERROR,
        })
      );
    });
  });

  describe("AC-10: Resolved-config artifact", () => {
    it("AC-10.1 & 10.2 & 10.3: FileSystemArtifactStore serializes config.resolved.json omitting origins", async () => {
      // Arrange
      const resolvedConfig = {
        defaultProvider: "codex",
        providers: {
          codex: { command: "codex" },
        },
        providerAliasMaxDepth: 8,
        providerAliases: {
          aliasA: {
            name: "aliasA",
            inheritanceChain: ["aliasA"],
            provider: "codex",
            model: "gpt-4",
            origins: { provider: "aliasA", model: "aliasA" },
            digest: "sha256:123456",
          },
        },
      };

      const store = new FileSystemArtifactStore({ rootDir: TEMP_DIR });

      // Act
      await store.createRun({
        runId: "test-run",
        outDir: TEMP_DIR,
        workflowPath: "workflows/test.js",
        workflowSource: "// test",
        workflowHash: "abc",
        resolvedConfig: resolvedConfig as any,
        openDynamicWorkflowVersion: "1.0.0",
        cwd: TEMP_DIR,
      });

      // Assert
      const resolvedJsonPath = path.join(TEMP_DIR, "test-run", "config.resolved.json");
      const content = await fs.readFile(resolvedJsonPath, "utf8");
      const parsed = JSON.parse(content);

      // Verify basic formatting and fields exist
      expect(parsed.defaultProvider).toBe("codex");
      expect(parsed.providers.codex).toEqual({ command: "codex" });

      // Verify origins is omitted
      const alias = parsed.providerAliases.aliasA;
      expect(alias).toBeDefined();
      expect(alias.name).toBe("aliasA");
      expect(alias.provider).toBe("codex");
      expect(alias.model).toBe("gpt-4");
      expect(alias.digest).toBe("sha256:123456");
      expect(alias.origins).toBeUndefined();
    });
  });

  describe("Canonical Output and Provenance / Depth Diagnostics Fixes Verification", () => {
    it("verifies byte-identical config.resolved.json output for equivalent retry configurations", async () => {
      // Create resolvedConfig 1
      const result1 = resolveProviderAliases({
        rawAliases: {
          aliasA: {
            provider: "codex",
            retry: { maxAttempts: 3, delayMs: 200, jitter: true }
          }
        },
        providers: dummyProviders,
        builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
        maxDepth: 8,
      });

      // Create resolvedConfig 2
      const result2 = resolveProviderAliases({
        rawAliases: {
          aliasA: {
            provider: "codex",
            retry: { jitter: true, maxAttempts: 3, delayMs: 200 }
          }
        },
        providers: dummyProviders,
        builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
        maxDepth: 8,
      });

      const config1 = {
        defaultProvider: "codex",
        providers: dummyProviders,
        providerAliasMaxDepth: 8,
        providerAliases: result1.aliases,
      };

      const config2 = {
        defaultProvider: "codex",
        providers: dummyProviders,
        providerAliasMaxDepth: 8,
        providerAliases: result2.aliases,
      };

      const store1 = new FileSystemArtifactStore({ rootDir: path.join(TEMP_DIR, "run1") });
      const store2 = new FileSystemArtifactStore({ rootDir: path.join(TEMP_DIR, "run2") });

      await store1.createRun({
        runId: "run-1",
        outDir: path.join(TEMP_DIR, "run1"),
        workflowPath: "workflows/test.js",
        workflowSource: "// test",
        workflowHash: "abc",
        resolvedConfig: config1 as any,
        openDynamicWorkflowVersion: "1.0.0",
        cwd: TEMP_DIR,
      });

      await store2.createRun({
        runId: "run-2",
        outDir: path.join(TEMP_DIR, "run2"),
        workflowPath: "workflows/test.js",
        workflowSource: "// test",
        workflowHash: "abc",
        resolvedConfig: config2 as any,
        openDynamicWorkflowVersion: "1.0.0",
        cwd: TEMP_DIR,
      });

      const json1Path = path.join(TEMP_DIR, "run1", "run-1", "config.resolved.json");
      const json2Path = path.join(TEMP_DIR, "run2", "run-2", "config.resolved.json");

      const bytes1 = await fs.readFile(json1Path);
      const bytes2 = await fs.readFile(json2Path);

      expect(Buffer.compare(bytes1, bytes2)).toBe(0);
    });

    it("verifies normalization and root-to-leaf depth error inheritance via loadConfig", async () => {
      // 1. Same provider repetition normalized away
      const configPathRep = path.join(TEMP_DIR, "config-rep.yaml");
      await fs.writeFile(
        configPathRep,
        `
providers:
  codex:
    command: codex
providerAliases:
  parent:
    provider: codex
  child:
    extends: parent
    provider: codex
`
      );

      const configRep = await loadConfig({
        cwd: TEMP_DIR,
        configPath: configPathRep,
        cli: {},
      });
      expect(configRep.providerAliases.child.origins.provider).toBe("parent");

      // 2. Depth boundary violation reports root-to-leaf chain
      const configPathDepth = path.join(TEMP_DIR, "config-depth.yaml");
      await fs.writeFile(
        configPathDepth,
        `
providerAliasMaxDepth: 2
providers:
  codex:
    command: codex
providerAliases:
  c:
    provider: codex
  b:
    extends: c
  a:
    extends: b
`
      );

      try {
        await loadConfig({
          cwd: TEMP_DIR,
          configPath: configPathDepth,
          cli: {},
        });
        expect.unreachable("Should have failed due to depth boundary");
      } catch (err: any) {
        expect(err.code).toBe("PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED");
        expect(err.cause.limit).toBe(2);
        expect(err.cause.inheritanceChain).toEqual(["c", "b", "a"]);
      }
    });
  });
});
