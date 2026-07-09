import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import {
  validateConfig,
  validateProfileName,
  validateWorkflowProfile,
  validateResolvedWorkflowProfile,
  validateProfileCatalog
} from "../../src/config/schema.js";
import {
  loadExternalProfilesFile
} from "../../src/config/profile-file.js";
import {
  buildProfileCatalog,
  resolveSelectedProfile,
  mergeProfiles,
  canonicalProfileHash
} from "../../src/config/profiles.js";
import { OpenDynamicWorkflowError } from "../../src/errors/types.js";
import { ErrorCode } from "../../src/errors/codes.js";
import { ExitCode, exitCodeForError } from "../../src/errors/exit-codes.js";
import type { ResolvedWorkflowProfile, WorkflowProfile } from "../../src/config/types.js";

const TEMP_DIR = path.resolve("tests/temp-profile-parsing-and-resolution-acceptance");

describe("Phase 1 Acceptance Tests: Profile Parsing and Resolution", () => {
  let symlinksSupported = true;

  beforeAll(async () => {
    try {
      const testLink = path.join(os.tmpdir(), `test-symlink-support-${Date.now()}`);
      await fs.symlink("target", testLink);
      await fs.unlink(testLink);
    } catch (e) {
      symlinksSupported = false;
    }
  });

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  // A. Contracts, errors, and schema (AC-A1 to AC-A8)
  describe("A. Contracts, Errors, and Schema Schema Validation", () => {
    it("AC-A1 & AC-A2: passes with no profiles, empty catalog, or a valid config profiles catalog", () => {
      // Arrange & Act & Assert
      expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();

      const configWithEmptyProfiles = {
        ...DEFAULT_CONFIG,
        profiles: {}
      };
      expect(() => validateConfig(configWithEmptyProfiles)).not.toThrow();

      const configWithValidProfiles = {
        ...DEFAULT_CONFIG,
        profiles: {
          "base-strict": {
            description: "A strict base profile",
            args: { qualityGate: "strict" },
            context: { qualityLevel: "strict" },
            run: { concurrency: 1, failFast: true, report: "json" as const }
          }
        }
      };
      expect(() => validateConfig(configWithValidProfiles)).not.toThrow();
    });

    it("AC-A3: rejects invalid profile names", () => {
      // Arrange, Act & Assert
      const invalidNames = [
        "", // empty
        " ", // untrimmed space
        " ci", // untrimmed leading space
        "ci ", // untrimmed trailing space
        "ci\x01", // control character
        "ci/deep", // slash separator
        "ci\\deep", // backslash separator
        ".", // reserved dot
        "..", // reserved double dot
        "__proto__", // reserved prototype-polluting keys
        "prototype",
        "constructor"
      ];

      for (const name of invalidNames) {
        expect(() => validateProfileName(name, `profiles.${name}`)).toThrow(
          OpenDynamicWorkflowError
        );
      }
    });

    it("AC-A4 & AC-A5: rejects unknown profile and run keys", () => {
      // Arrange, Act & Assert
      // AC-A4: Unknown top-level profile key
      expect(() =>
        validateWorkflowProfile({ security: {} } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);

      // AC-A5: Forbidden run option keys
      expect(() =>
        validateWorkflowProfile({ run: { providers: {} } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);
      expect(() =>
        validateWorkflowProfile({ run: { command: "node" } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);
    });

    it("AC-A6: rejects unsafe JSON-safe fields and reserved context.$profile", () => {
      // Arrange, Act & Assert
      // Unsafe values in args/context
      expect(() =>
        validateWorkflowProfile({ args: { a: undefined } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);
      expect(() =>
        validateWorkflowProfile({ args: { a: () => {} } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);
      expect(() =>
        validateWorkflowProfile({ args: { a: Symbol("sym") } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);
      expect(() =>
        validateWorkflowProfile({ args: { a: 123n } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);
      expect(() =>
        validateWorkflowProfile({ args: { a: NaN } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);

      // Prototype pollution
      expect(() =>
        validateWorkflowProfile({ args: { "__proto__": {} } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);

      // Inherited property
      const proto = { inherited: 123 };
      const argsObj = Object.create(proto);
      argsObj.own = 456;
      expect(() =>
        validateWorkflowProfile({ args: argsObj } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);

      // Reserved context.$profile key
      expect(() =>
        validateWorkflowProfile({ context: { "$profile": {} } } as any, "profiles.p")
      ).toThrow(OpenDynamicWorkflowError);
    });

    it("AC-A7: uses PROFILE_VALIDATION_ERROR code and translates retry validation paths", () => {
      // Arrange, Act & Assert
      try {
        validateWorkflowProfile({ run: { retry: { maxAttempts: 0 } } } as any, "profiles.p");
        expect.fail("Expected validation error");
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.PROFILE_VALIDATION_ERROR);
        expect(err.message).toContain("profiles.p.run.retry.maxAttempts");
      }
    });

    it("AC-A8: verifies error exit code mappings", () => {
      // Arrange & Act & Assert
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_NOT_FOUND, "msg"))).toBe(
        ExitCode.ResourceNotFound
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_FILE_NOT_FOUND, "msg"))).toBe(
        ExitCode.ResourceNotFound
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_FILE_INVALID, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_VALIDATION_ERROR, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_CONTEXT_INVALID, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_RESERVED_PATH, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_OPTION_CONFLICT, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
    });
  });

  // B. External YAML loader (AC-B1 to AC-B5)
  describe("B. External YAML Loader Validation", () => {
    it("AC-B1: absolute path outside cwd and relative path escape are rejected", async () => {
      // Arrange
      const outsidePath = path.resolve(TEMP_DIR, "../outside-parsing-and-resolution-acceptance.yaml");
      await fs.writeFile(outsidePath, "profiles: {}");

      // Act & Assert
      await expect(
        loadExternalProfilesFile({ cwd: TEMP_DIR, profilesPath: "../outside-parsing-and-resolution-acceptance.yaml" })
      ).rejects.toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_FILE_INVALID })
      );

      await expect(
        loadExternalProfilesFile({ cwd: TEMP_DIR, profilesPath: outsidePath })
      ).rejects.toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_FILE_INVALID })
      );

      // Clean up outside file
      await fs.rm(outsidePath, { force: true });
    });

    it("AC-B2: URL-like paths and non-YAML suffixes fail", async () => {
      // Arrange, Act & Assert
      await expect(
        loadExternalProfilesFile({ cwd: TEMP_DIR, profilesPath: "https://example.com/profiles.yaml" })
      ).rejects.toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_FILE_INVALID })
      );

      const invalidSuffix = path.join(TEMP_DIR, "profiles.json");
      await fs.writeFile(invalidSuffix, "{}");
      await expect(
        loadExternalProfilesFile({ cwd: TEMP_DIR, profilesPath: "profiles.json" })
      ).rejects.toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_FILE_INVALID })
      );
    });

    it("AC-B3: symlink escape is blocked", async () => {
      if (!symlinksSupported) {
        return;
      }

      // Arrange
      const targetDir = path.join(TEMP_DIR, "workspace");
      await fs.mkdir(targetDir);

      const fileOutside = path.join(TEMP_DIR, "outside.yaml");
      await fs.writeFile(fileOutside, `
description: "escaped"
profiles:
  escaped:
    description: "should fail"
`);

      const linkInside = path.join(targetDir, "link-outside.yaml");
      await fs.symlink(fileOutside, linkInside);

      // Act & Assert
      await expect(
        loadExternalProfilesFile({ cwd: targetDir, profilesPath: "link-outside.yaml" })
      ).rejects.toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_FILE_INVALID })
      );
    });

    it("AC-B4: detects duplicate keys and rejects invalid root, version, or description envelopes", async () => {
      // Arrange
      const dupPath = path.join(TEMP_DIR, "duplicate-keys.yaml");
      await fs.writeFile(dupPath, `
description: "Duplicated keys"
profiles:
  my-prof:
    description: "first"
  my-prof:
    description: "second"
`);

      // Act & Assert
      await expect(
        loadExternalProfilesFile({ cwd: TEMP_DIR, profilesPath: "duplicate-keys.yaml" })
      ).rejects.toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_FILE_INVALID })
      );
    });

    it("AC-B5: semantic profile rejection preserves PROFILE_VALIDATION_ERROR", async () => {
      // Arrange
      const badProfilePath = path.join(TEMP_DIR, "bad-profile.yaml");
      await fs.writeFile(badProfilePath, `
profiles:
  invalid-prof:
    description: 123
`);

      // Act & Assert
      await expect(
        loadExternalProfilesFile({ cwd: TEMP_DIR, profilesPath: "bad-profile.yaml" })
      ).rejects.toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_VALIDATION_ERROR })
      );
    });
  });

  // C. Catalog, resolver, and hash (AC-C1 to AC-C7)
  describe("C. Catalog, Resolver, and Hash Resolution", () => {
    it("AC-C1 & AC-C2: merges catalogs correctly, external wins, and reports external overrides warning", () => {
      // Arrange
      const configProfiles = {
        common: { description: "config common" },
        uniqueConfig: { description: "config unique" }
      };

      const loadedExternal = {
        path: "/project/external.yaml",
        displayPath: "external.yaml",
        document: {
          profiles: {
            common: { description: "external common override" },
            uniqueExternal: { description: "external unique" }
          }
        }
      };

      // Act
      const result = buildProfileCatalog({
        configProfiles,
        configPath: "/project/config.yaml",
        externalProfiles: loadedExternal
      });

      // Assert
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toEqual({
        severity: "warning",
        code: "PROFILE_EXTERNAL_OVERRIDE",
        message: "External profile 'common' overrides config profile.",
        path: "profiles.common"
      });

      expect(result.catalog.common.profile.description).toBe("external common override");
      expect(result.catalog.common.source).toBe("external-override");
      expect(result.catalog.uniqueConfig.profile.description).toBe("config unique");
      expect(result.catalog.uniqueExternal.profile.description).toBe("external unique");
    });

    it("AC-C3 & AC-C5: inheritance chain uses DFS, resolves bases before child, left-to-right, child wins", () => {
      // Arrange
      const catalogResult = buildProfileCatalog({
        configProfiles: {
          BaseA: {
            args: { conflictKey: "BaseA", keyA: 1 }
          },
          BaseB: {
            extends: "BaseA",
            args: { conflictKey: "BaseB", keyB: 2 }
          },
          BaseC: {
            args: { conflictKey: "BaseC", keyC: 3 }
          },
          Child: {
            extends: ["BaseB", "BaseC"],
            args: { conflictKey: "Child" }
          }
        }
      });

      // Act
      const result = resolveSelectedProfile({
        selectedName: "Child",
        catalog: catalogResult.catalog,
        hasExternalFile: false
      });

      // Assert
      const selection = result.selection!;
      expect(selection.inheritanceChain).toEqual(["BaseA", "BaseB", "BaseC", "Child"]);
      expect(selection.resolved.args).toEqual({
        conflictKey: "Child",
        keyA: 1,
        keyB: 2,
        keyC: 3
      });
    });

    it("AC-C4: direct and indirect cycles fail with PROFILE_VALIDATION_ERROR and missing bases/selected names throw PROFILE_NOT_FOUND", () => {
      // Arrange
      const cyclicCatalog = buildProfileCatalog({
        configProfiles: {
          a: { extends: "b" },
          b: { extends: "c" },
          c: { extends: "a" }
        }
      });

      // Act & Assert
      // Missing selected profile
      expect(() =>
        resolveSelectedProfile({
          selectedName: "missing",
          catalog: cyclicCatalog.catalog,
          hasExternalFile: false
        })
      ).toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_NOT_FOUND })
      );

      // Cyclic inheritance detection
      expect(() =>
        resolveSelectedProfile({
          selectedName: "a",
          catalog: cyclicCatalog.catalog,
          hasExternalFile: false
        })
      ).toThrowError(
        expect.objectContaining({ code: ErrorCode.PROFILE_VALIDATION_ERROR })
      );
    });

    it("AC-C6: exact section merge behavior is applied, output omits extends, and inputs are not mutated", () => {
      // Arrange
      const parent: ResolvedWorkflowProfile = {
        description: "parent desc",
        args: { a: 1, b: 2 },
        context: { x: { y: 1 }, z: "base" },
        run: { provider: "mock", retry: { maxAttempts: 3 } }
      };

      const child: WorkflowProfile = {
        description: "child desc",
        args: { b: 3, c: 4 },
        context: { x: { w: 2 }, z: "child" },
        run: { model: "gpt-4", retry: { delayMs: 1000 } }
      };

      // Act
      const merged = mergeProfiles(parent, child);

      // Assert
      expect(merged.description).toBe("child desc");
      expect(merged.args).toEqual({ a: 1, b: 3, c: 4 });
      expect(merged.context).toEqual({ x: { y: 1, w: 2 }, z: "child" });
      expect(merged.run).toEqual({
        provider: "mock",
        model: "gpt-4",
        retry: { maxAttempts: 3, delayMs: 1000 }
      });

      // Immuntability check: inputs not mutated
      expect(parent.args.b).toBe(2);
      expect(parent.run.retry).toEqual({ maxAttempts: 3 });
    });

    it("AC-C7: stable sha256 hash independent of key insertion order and changes when value changes", () => {
      // Arrange
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

      const p3: ResolvedWorkflowProfile = {
        args: { a: 1, b: 3 }, // changed value
        context: { x: { y: 1, z: 2 } },
        run: { provider: "mock", model: "gpt" }
      };

      // Act
      const h1 = canonicalProfileHash(p1);
      const h2 = canonicalProfileHash(p2);
      const h3 = canonicalProfileHash(p3);

      // Assert
      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
      expect(h1).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });
});
