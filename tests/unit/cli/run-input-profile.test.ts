import { describe, expect, it } from "vitest";
import { buildProfileCatalog, resolveSelectedProfile } from "../../../src/config/profiles.js";
import {
  createRecordedRunProfile,
  parseRecordedRunProfile,
  recordedProfileToRunProfile,
} from "../../../src/cli/run-input-profile.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("run-input-profile module", () => {
  // Helper to create a valid selection fixture using the resolver
  function getFixtureSelection() {
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
      },
      configPath: "/project/config.yaml",
      externalProfiles: {
        path: "/project/external.yaml",
        displayPath: "external.yaml",
        document: {
          profiles: {
            Child: {
              extends: ["BaseB", "BaseC"],
              args: { level: "Child" },
              context: { a: { b: 9 } }
            }
          }
        }
      }
    });

    const result = resolveSelectedProfile({
      selectedName: "Child",
      catalog: catalogResult.catalog,
      hasExternalFile: true
    });

    return result.selection!;
  }

  describe("createRecordedRunProfile", () => {
    it("serializes a selection snapshot, carries path/hash/lineage, omits extends, and does not mutate fixture", () => {
      const selection = getFixtureSelection();
      const selectionClone = JSON.parse(JSON.stringify(selection));

      const recorded = createRecordedRunProfile(selection);

      // Assert it carries all required fields
      expect(recorded.selected).toBe("Child");
      expect(recorded.source).toBe("external-override"); // because Child overrides in the fixture catalog
      expect(recorded.profilesPath).toBe("/project/external.yaml");
      expect(recorded.hash).toBe(selection.hash);
      expect(recorded.inheritanceChain).toEqual(["BaseA", "BaseB", "BaseC", "Child"]);
      expect(recorded.resumedFromRecordedProfile).toBeUndefined();

      // Assert resolved contains no extends
      expect(recorded.resolved).toEqual({
        args: { level: "Child", keyA: 1, keyB: 2, keyC: 3 },
        context: { a: { b: 9, c: 2 }, d: 4 },
        run: { concurrency: 2, failFast: true }
      });
      expect((recorded.resolved as any).extends).toBeUndefined();

      // Assert it does not mutate selection
      expect(selection).toEqual(selectionClone);

      // Verify resumedFromRecordedProfile marker when explicitly passed
      const recordedWithMarker = createRecordedRunProfile(selection, { resumedFromRecordedProfile: true });
      expect(recordedWithMarker.resumedFromRecordedProfile).toBe(true);
    });

    it("retains the same already-computed hash", () => {
      const selection = getFixtureSelection();
      const recorded = createRecordedRunProfile(selection);
      expect(recorded.hash).toBe(selection.hash);
    });
  });

  describe("parseRecordedRunProfile", () => {
    it("returns undefined for undefined (legacy/no-profile compat)", () => {
      expect(parseRecordedRunProfile(undefined)).toBeUndefined();
    });

    it("successfully parses and deep-clones a valid recorded profile", () => {
      const selection = getFixtureSelection();
      const recorded = createRecordedRunProfile(selection, { resumedFromRecordedProfile: true });

      const parsed = parseRecordedRunProfile(recorded);
      expect(parsed).toEqual(recorded);
      expect(parsed).not.toBe(recorded); // deep clone
      expect(parsed?.resolved).not.toBe(recorded.resolved); // deep clone
    });

    // Table tests for invalid artifacts
    const invalidCases: Array<{ name: string; value: any }> = [
      {
        name: "non-object value",
        value: "not-an-object",
      },
      {
        name: "null value",
        value: null,
      },
      {
        name: "array value",
        value: [],
      },
      {
        name: "missing selected",
        value: {
          source: "config",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
        },
      },
      {
        name: "empty/whitespace-only selected",
        value: {
          selected: "   ",
          source: "config",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
        },
      },
      {
        name: "invalid selected name characters",
        value: {
          selected: "a/b",
          source: "config",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
        },
      },
      {
        name: "missing source",
        value: {
          selected: "dev",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
        },
      },
      {
        name: "invalid source value",
        value: {
          selected: "dev",
          source: "invalid-source",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
        },
      },
      {
        name: "empty profilesPath when present",
        value: {
          selected: "dev",
          source: "config",
          profilesPath: "",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
        },
      },
      {
        name: "missing hash",
        value: {
          selected: "dev",
          source: "config",
          resolved: { args: {}, context: {}, run: {} },
        },
      },
      {
        name: "empty hash",
        value: {
          selected: "dev",
          source: "config",
          resolved: { args: {}, context: {}, run: {} },
          hash: "",
        },
      },
      {
        name: "inheritanceChain not an array",
        value: {
          selected: "dev",
          source: "config",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
          inheritanceChain: "not-an-array",
        },
      },
      {
        name: "inheritanceChain containing non-string",
        value: {
          selected: "dev",
          source: "config",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
          inheritanceChain: ["base", 123],
        },
      },
      {
        name: "resumedFromRecordedProfile not true",
        value: {
          selected: "dev",
          source: "config",
          resolved: { args: {}, context: {}, run: {} },
          hash: "sha256:abc",
          resumedFromRecordedProfile: "yes",
        },
      },
      {
        name: "missing resolved",
        value: {
          selected: "dev",
          source: "config",
          hash: "sha256:abc",
        },
      },
      {
        name: "resolved contains extends",
        value: {
          selected: "dev",
          source: "config",
          resolved: { extends: "base", args: {}, context: {}, run: {} },
          hash: "sha256:abc",
        },
      },
      {
        name: "resolved contains extra fields",
        value: {
          selected: "dev",
          source: "config",
          resolved: { extraField: 1, args: {}, context: {}, run: {} },
          hash: "sha256:abc",
        },
      },
      {
        name: "resolved args is not JSON safe (contains cyclic reference)",
        value: (() => {
          const cyclicArgs: any = {};
          cyclicArgs.self = cyclicArgs;
          return {
            selected: "dev",
            source: "config",
            resolved: { args: cyclicArgs, context: {}, run: {} },
            hash: "sha256:abc",
          };
        })(),
      },
      {
        name: "resolved run contains disallowed key",
        value: {
          selected: "dev",
          source: "config",
          resolved: { args: {}, context: {}, run: { concurrency: 2, invalidKey: true } },
          hash: "sha256:abc",
        },
      },
      {
        name: "resolved run concurrency invalid value",
        value: {
          selected: "dev",
          source: "config",
          resolved: { args: {}, context: {}, run: { concurrency: -1 } },
          hash: "sha256:abc",
        },
      },
      {
        name: "prototype pollution key in parent",
        value: (() => {
          const badObj = Object.create(null);
          Object.defineProperty(badObj, "__proto__", { value: { polluted: true }, enumerable: true });
          badObj.selected = "dev";
          badObj.source = "config";
          badObj.resolved = { args: {}, context: {}, run: {} };
          badObj.hash = "sha256:abc";
          return badObj;
        })(),
      },
      {
        name: "inherited property in parent",
        value: (() => {
          const baseProto = { inheritedProp: "oops" };
          const badObj = Object.create(baseProto);
          badObj.selected = "dev";
          badObj.source = "config";
          badObj.resolved = { args: {}, context: {}, run: {} };
          badObj.hash = "sha256:abc";
          return badObj;
        })(),
      },
    ];

    invalidCases.forEach(({ name, value }) => {
      it(`rejects: ${name}`, () => {
        let threw = false;
        try {
          parseRecordedRunProfile(value);
        } catch (err: any) {
          threw = true;
          expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
          expect(err.code).toBe(ErrorCode.PROFILE_VALIDATION_ERROR);
          expect(err.message).toMatch(/Recorded profile is malformed/i);
        }
        expect(threw).toBe(true);
      });
    });
  });

  describe("recordedProfileToRunProfile", () => {
    it("converts recorded profile correctly with explicit args, returns independent clones, and correct properties", () => {
      const selection = getFixtureSelection();
      const recorded = createRecordedRunProfile(selection, { resumedFromRecordedProfile: true });

      const explicitArgs = { overrideArg: "sentinel", level: "Explicit" };
      const converted = recordedProfileToRunProfile(recorded, explicitArgs);

      // Verify profileRunAsCli
      expect(converted.profileRunAsCli.config).toEqual({
        concurrency: 2,
        failFast: true
      });

      // Verify finalCliArgs (args merged)
      expect(converted.finalCliArgs).toEqual({
        level: "Explicit", // overridden from Child's "Child"
        keyA: 1,
        keyB: 2,
        keyC: 3,
        overrideArg: "sentinel"
      });

      // Verify contextSeed
      expect(converted.contextSeed).toEqual({
        context: { a: { b: 9, c: 2 }, d: 4 },
        metadata: {
          name: "Child",
          source: "recorded",
          hasExternalFile: true,
          hash: recorded.hash,
          profilesPath: "/project/external.yaml"
        },
        reservedPath: "$profile"
      });

      // Verify reportProfile
      expect(converted.reportProfile).toEqual({
        selected: "Child",
        source: "recorded",
        profilesPath: "/project/external.yaml",
        hash: recorded.hash,
        resumedFromRecordedProfile: true
      });

      // Never contain "resolved" in report metadata
      expect((converted.reportProfile as any).resolved).toBeUndefined();

      // Independent clones: changing converted values does not affect recorded profile
      converted.finalCliArgs.newArg = "added";
      expect(recorded.resolved.args.newArg).toBeUndefined();

      converted.contextSeed.context.a = "mutated";
      expect((recorded.resolved.context as any).a).toEqual({ b: 9, c: 2 });
    });
  });
});
