import { describe, expect, it } from "vitest";
import {
  buildProfileCatalog,
  resolveSelectedProfile,
  mergeProfiles,
  canonicalProfileHash
} from "../../../src/config/profiles.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import type { ResolvedWorkflowProfile, WorkflowProfile } from "../../../src/config/types.js";

describe("Profile Catalog and Resolution Module", () => {
  describe("buildProfileCatalog", () => {
    it("handles config-only and external-only catalog entries and source metadata", () => {
      const result = buildProfileCatalog({
        configProfiles: {
          prof1: { description: "config prof1" }
        },
        configPath: "/project/config.yaml",
        externalProfiles: {
          path: "/project/external.yaml",
          displayPath: "external.yaml",
          document: {
            profiles: {
              prof2: { description: "external prof2" }
            }
          }
        }
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.catalog).toEqual({
        prof1: {
          name: "prof1",
          profile: { description: "config prof1" },
          source: "config",
          sourcePath: "/project/config.yaml",
          overridesConfigProfile: false
        },
        prof2: {
          name: "prof2",
          profile: { description: "external prof2" },
          source: "external",
          sourcePath: "/project/external.yaml",
          overridesConfigProfile: false
        }
      });
    });

    it("handles external overrides, warning diagnostics, and external child extending config base", () => {
      const result = buildProfileCatalog({
        configProfiles: {
          base: { description: "config base" },
          overrideMe: { description: "original description" }
        },
        configPath: "/project/config.yaml",
        externalProfiles: {
          path: "/project/external.yaml",
          displayPath: "external.yaml",
          document: {
            profiles: {
              overrideMe: { description: "overridden description" },
              child: { extends: "base", description: "child description" }
            }
          }
        }
      });

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toEqual({
        severity: "warning",
        code: "PROFILE_EXTERNAL_OVERRIDE",
        message: "External profile 'overrideMe' overrides config profile.",
        path: "profiles.overrideMe"
      });

      expect(result.catalog).toEqual({
        base: {
          name: "base",
          profile: { description: "config base" },
          source: "config",
          sourcePath: "/project/config.yaml",
          overridesConfigProfile: false
        },
        overrideMe: {
          name: "overrideMe",
          profile: { description: "overridden description" },
          source: "external-override",
          sourcePath: "/project/external.yaml",
          overridesConfigProfile: true
        },
        child: {
          name: "child",
          profile: { extends: "base", description: "child description" },
          source: "external",
          sourcePath: "/project/external.yaml",
          overridesConfigProfile: false
        }
      });
    });
  });

  describe("resolveSelectedProfile", () => {
    it("returns selection undefined when no profile is selected", () => {
      const catalogResult = buildProfileCatalog({
        configProfiles: {
          prof1: { description: "prof1" }
        }
      });
      const result = resolveSelectedProfile({
        selectedName: undefined,
        catalog: catalogResult.catalog,
        hasExternalFile: false
      });
      expect(result.selection).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    });

    it("throws PROFILE_VALIDATION_ERROR for empty/invalid selectedName", () => {
      const catalogResult = buildProfileCatalog({
        configProfiles: { prof1: { description: "prof1" } }
      });

      try {
        resolveSelectedProfile({
          selectedName: "",
          catalog: catalogResult.catalog,
          hasExternalFile: false
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.PROFILE_VALIDATION_ERROR);
      }
    });

    it("throws PROFILE_NOT_FOUND when profile is missing, with alphabetically sorted available-name list", () => {
      const catalogResult = buildProfileCatalog({
        configProfiles: {
          b: { description: "b" },
          a: { description: "a" }
        }
      });

      try {
        resolveSelectedProfile({
          selectedName: "missing",
          catalog: catalogResult.catalog,
          hasExternalFile: false
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.PROFILE_NOT_FOUND);
        expect(err.message).toContain("Available profiles: a, b");
      }
    });

    it("throws PROFILE_NOT_FOUND with explicit none available message when catalog is empty", () => {
      try {
        resolveSelectedProfile({
          selectedName: "missing",
          catalog: {},
          hasExternalFile: false
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.PROFILE_NOT_FOUND);
        expect(err.message).toContain("Available profiles: none available");
      }
    });

    it("throws PROFILE_NOT_FOUND when a base profile is missing", () => {
      const catalogResult = buildProfileCatalog({
        configProfiles: {
          child: { extends: "missing-base", description: "child" }
        }
      });

      try {
        resolveSelectedProfile({
          selectedName: "child",
          catalog: catalogResult.catalog,
          hasExternalFile: false
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.PROFILE_NOT_FOUND);
        expect(err.message).toContain("Profile base 'missing-base' not found");
      }
    });

    it("throws PROFILE_VALIDATION_ERROR on direct cyclic inheritance", () => {
      const catalogResult = buildProfileCatalog({
        configProfiles: {
          a: { extends: "a", description: "a" }
        }
      });

      try {
        resolveSelectedProfile({
          selectedName: "a",
          catalog: catalogResult.catalog,
          hasExternalFile: false
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.PROFILE_VALIDATION_ERROR);
        expect(err.message).toContain("Cyclic inheritance detected: a -> a");
      }
    });

    it("throws PROFILE_VALIDATION_ERROR on indirect cyclic inheritance, formatting cycle slice precisely", () => {
      const catalogResult = buildProfileCatalog({
        configProfiles: {
          a: { extends: "b" },
          b: { extends: "c" },
          c: { extends: "a" }
        }
      });

      try {
        resolveSelectedProfile({
          selectedName: "a",
          catalog: catalogResult.catalog,
          hasExternalFile: false
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.PROFILE_VALIDATION_ERROR);
        expect(err.message).toContain("Cyclic inheritance detected: a -> b -> c -> a");
      }
    });

    describe("own-key safety", () => {
      it("resolves selected 'toString' from an empty catalog and receives PROFILE_NOT_FOUND", () => {
        expect(() => {
          resolveSelectedProfile({
            selectedName: "toString",
            catalog: {},
            hasExternalFile: false
          });
        }).toThrowError(/Profile 'toString' not found/);
      });

      it("resolves a child extending missing 'toString' and receives PROFILE_NOT_FOUND", () => {
        const catalogResult = buildProfileCatalog({
          configProfiles: {
            child: { extends: "toString", description: "child" }
          }
        });
        expect(() => {
          resolveSelectedProfile({
            selectedName: "child",
            catalog: catalogResult.catalog,
            hasExternalFile: false
          });
        }).toThrowError(/Profile base 'toString' not found/);
      });

      it("successfully builds and resolves an explicitly configured profile named 'toString'", () => {
        const catalogResult = buildProfileCatalog({
          configProfiles: {
            toString: { description: "explicit toString profile", args: { val: 42 } }
          }
        });
        const result = resolveSelectedProfile({
          selectedName: "toString",
          catalog: catalogResult.catalog,
          hasExternalFile: false
        });
        expect(result.selection).toBeDefined();
        expect(result.selection?.resolved.description).toBe("explicit toString profile");
        expect(result.selection?.resolved.args).toEqual({ val: 42 });
      });

      it("preserves normal external override diagnostics and deep multi-base resolution with own-key safety", () => {
        const result = buildProfileCatalog({
          configProfiles: {
            toString: { description: "config toString" },
            base: { description: "base description" }
          },
          externalProfiles: {
            path: "external.yaml",
            displayPath: "external.yaml",
            document: {
              profiles: {
                toString: { description: "external override toString" }
              }
            }
          }
        });
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].code).toBe("PROFILE_EXTERNAL_OVERRIDE");
        expect(result.catalog.toString.source).toBe("external-override");
      });
    });
  });

  describe("mergeProfiles and resolution semantics", () => {
    it("correctly merges description, args, context, run, and nested retry options", () => {
      const base: ResolvedWorkflowProfile = {
        description: "base desc",
        args: {
          x: 1,
          y: 2
        },
        context: {
          nested: {
            a: "original",
            b: [1, 2],
            c: { d: "nested-d" }
          },
          scalar: "base-scalar"
        },
        run: {
          provider: "mock",
          concurrency: 2,
          retry: {
            maxAttempts: 3,
            delayMs: 1000
          }
        }
      };

      const child: WorkflowProfile = {
        description: "child desc",
        args: {
          y: 3,
          z: 4
        },
        context: {
          nested: {
            a: "updated",
            b: [3, 4],
            c: "scalar-replacement"
          },
          scalar: "child-scalar"
        },
        run: {
          model: "gemini",
          retry: {
            delayMs: 2000
          }
        }
      };

      const merged = mergeProfiles(base, child);

      expect(merged.description).toBe("child desc");
      expect(merged.args).toEqual({ x: 1, y: 3, z: 4 });
      expect(merged.context).toEqual({
        nested: {
          a: "updated",
          b: [3, 4],
          c: "scalar-replacement"
        },
        scalar: "child-scalar"
      });
      expect(merged.run).toEqual({
        provider: "mock",
        model: "gemini",
        concurrency: 2,
        retry: {
          maxAttempts: 3,
          delayMs: 2000
        }
      });

      // Assert immutability: base and child are not modified
      expect(base.args.y).toBe(2);
      expect(base.run.retry).toEqual({ maxAttempts: 3, delayMs: 1000 });
    });

    it("replaces parent retry with child retry if child or parent retry is not a plain object", () => {
      const baseObj: ResolvedWorkflowProfile = {
        args: {},
        context: {},
        run: {
          retry: { maxAttempts: 3 }
        }
      };
      const childFalse: WorkflowProfile = {
        run: { retry: false }
      };
      const merged1 = mergeProfiles(baseObj, childFalse);
      expect(merged1.run.retry).toBe(false);

      const baseFalse: ResolvedWorkflowProfile = {
        args: {},
        context: {},
        run: { retry: false }
      };
      const childObj: WorkflowProfile = {
        run: { retry: { delayMs: 1000 } }
      };
      const merged2 = mergeProfiles(baseFalse, childObj);
      expect(merged2.run.retry).toEqual({ delayMs: 1000 });
    });

    it("omits extends and always creates concrete empty section objects for missing args, context, and run", () => {
      const catalogResult = buildProfileCatalog({
        configProfiles: {
          parent: { description: "parent description" },
          child: { extends: "parent", description: "child description" }
        }
      });

      const result = resolveSelectedProfile({
        selectedName: "child",
        catalog: catalogResult.catalog,
        hasExternalFile: false
      });

      const selection = result.selection!;
      expect(selection.resolved).toEqual({
        description: "child description",
        args: {},
        context: {},
        run: {}
      });
      expect((selection.resolved as any).extends).toBeUndefined();
    });
  });

  describe("exit criteria and hash determinism", () => {
    it("correctly resolves a deep multi-base profile without cyclic errors, producing correct chain and stable hash", () => {
      const catalogResult = buildProfileCatalog({
        configProfiles: {
          BaseA: {
            args: { level: "A", keyA: 1 },
            context: { a: { b: 1 } },
            run: { concurrency: 2 }
          },
          BaseB: {
            extends: "BaseA",
            args: { level: "B", keyB: 2 },
            context: { a: { c: 2 } },
            run: { failFast: true }
          },
          BaseC: {
            args: { keyC: 3 },
            context: { d: 4 }
          },
          Child: {
            extends: ["BaseB", "BaseC"],
            args: { level: "Child" },
            context: { a: { b: 9 } }
          }
        }
      });

      const result = resolveSelectedProfile({
        selectedName: "Child",
        catalog: catalogResult.catalog,
        hasExternalFile: false
      });

      expect(result.selection).toBeDefined();
      const selection = result.selection!;

      expect(selection.resolved.args).toEqual({
        level: "Child",
        keyA: 1,
        keyB: 2,
        keyC: 3
      });

      expect(selection.resolved.context).toEqual({
        a: {
          b: 9,
          c: 2
        },
        d: 4
      });

      expect(selection.resolved.run).toEqual({
        concurrency: 2,
        failFast: true
      });

      expect(selection.inheritanceChain).toEqual(["BaseA", "BaseB", "BaseC", "Child"]);
      expect(selection.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("produces equal hashes for semantically identical objects with different key insertion orders", () => {
      const p1: ResolvedWorkflowProfile = {
        args: { a: 1, b: 2 },
        context: { x: { y: 1, z: 2 } },
        run: { provider: "mock", model: "gpt" }
      };

      const p2: ResolvedWorkflowProfile = {
        context: { x: { z: 2, y: 1 } },
        run: { model: "gpt", provider: "mock" },
        args: { b: 2, a: 1 }
      };

      const h1 = canonicalProfileHash(p1);
      const h2 = canonicalProfileHash(p2);
      expect(h1).toBe(h2);
    });

    it("produces different hashes when any nested resolved value changes", () => {
      const p1: ResolvedWorkflowProfile = {
        args: { a: 1, b: 2 },
        context: { x: { y: 1 } },
        run: {}
      };

      const p2: ResolvedWorkflowProfile = {
        args: { a: 1, b: 2 },
        context: { x: { y: 2 } },
        run: {}
      };

      const h1 = canonicalProfileHash(p1);
      const h2 = canonicalProfileHash(p2);
      expect(h1).not.toBe(h2);
    });
  });
});
