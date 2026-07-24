import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { mergeConfig, mergeConfigWithMetadata } from "../../../src/config/merge.js";
import { canonicalProfileHash, mergeProfiles } from "../../../src/config/profiles.js";
import { validateConfig, validateWorkflowProfile } from "../../../src/config/schema.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

function expectConfigValidation(action: () => void, field: string): void {
  try {
    action();
    expect.fail("Expected configuration validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(OpenDynamicWorkflowError);
    expect((error as OpenDynamicWorkflowError).code).toBe(ErrorCode.CONFIG_VALIDATION_ERROR);
    expect((error as Error).message).toContain(field);
  }
}

describe("outDir configuration", () => {
  it("uses the literal built-in run root and an empty profile catalog", () => {
    expect(DEFAULT_CONFIG.outDir).toBe(".open-dynamic-workflow/runs");
    expect(DEFAULT_CONFIG.profiles).toEqual({});
  });

  it("allows omitted, relative, and absolute global outDir values", () => {
    const omitted = { ...DEFAULT_CONFIG };
    delete (omitted as { outDir?: string }).outDir;

    expect(() => validateConfig(omitted)).not.toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, outDir: "runs/local" })).not.toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, outDir: "/var/tmp/runs" })).not.toThrow();
  });

  it.each(["", "   ", undefined, 1, {}, []])("rejects invalid global outDir value %#", value => {
    expectConfigValidation(() => validateConfig({ ...DEFAULT_CONFIG, outDir: value } as any), "outDir");
  });

  it("validates profile-level outDir only at the profile top level", () => {
    expect(() => validateWorkflowProfile({ outDir: "relative/runs" }, "profiles.ci")).not.toThrow();
    expect(() => validateWorkflowProfile({ outDir: "/var/tmp/runs" }, "profiles.ci")).not.toThrow();
    expect(() => validateWorkflowProfile({}, "profiles.ci")).not.toThrow();
    expect(() => validateWorkflowProfile({ run: { outDir: "runs" } }, "profiles.ci")).toThrow("not allowed");
  });

  it.each(["", "  ", undefined, 1, {}, []])("rejects invalid profile outDir value %#", value => {
    expectConfigValidation(() => validateWorkflowProfile({ outDir: value } as any, "profiles.ci"), "profiles.ci.outDir");
  });

  it("retains strict profile catalog validation", () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, profiles: [] } as any)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, profiles: { "invalid/name": {} } })).toThrow(OpenDynamicWorkflowError);
    expect(() => validateWorkflowProfile({ unknown: true }, "profiles.ci")).toThrow("not allowed");
  });

  it("merges a file outDir over the default and records raw-file presence", () => {
    expect(mergeConfig(DEFAULT_CONFIG, { outDir: "custom-runs" }, {}).outDir).toBe("custom-runs");
    expect(mergeConfigWithMetadata(DEFAULT_CONFIG, {}, {}).explicit.outDir).toBe(false);
    expect(mergeConfigWithMetadata(DEFAULT_CONFIG, { outDir: DEFAULT_CONFIG.outDir }, {}).explicit.outDir).toBe(true);
  });

  it("merges ordinary profile catalogs by name but replaces matching definitions", () => {
    const defaults = {
      ...DEFAULT_CONFIG,
      profiles: {
        base: { args: { inherited: true } },
        retained: { outDir: "retained" }
      }
    };
    const merged = mergeConfig(defaults, { profiles: { base: { outDir: "replacement" } } }, {});

    expect(merged.profiles).toEqual({
      base: { outDir: "replacement" },
      retained: { outDir: "retained" }
    });
  });

  it("does not sanitize unsafe profile catalogs before validation", () => {
    const customPrototypeCatalog = Object.create({ inherited: {} });
    customPrototypeCatalog.ci = {};
    const arrayCatalog: unknown[] = [];
    let accessorRead = false;
    const accessorCatalog: Record<string, unknown> = {};
    Object.defineProperty(accessorCatalog, "ci", {
      enumerable: true,
      get() {
        accessorRead = true;
        return {};
      }
    });

    for (const profiles of [customPrototypeCatalog, arrayCatalog, accessorCatalog]) {
      const merged = mergeConfig(DEFAULT_CONFIG, { profiles } as any, {});
      expect(() => validateConfig(merged)).toThrow(OpenDynamicWorkflowError);
    }
    expect(accessorRead).toBe(false);
  });

  it("inherits profile outDir, lets a child override it, and includes it in hashes", () => {
    const base = { args: {}, context: {}, run: {}, outDir: "base-runs" };
    const inherited = mergeProfiles(base, { args: {} });
    const overridden = mergeProfiles(base, { outDir: "child-runs" });
    const omitted = mergeProfiles({ args: {}, context: {}, run: {} }, {});

    expect(inherited.outDir).toBe("base-runs");
    expect(overridden.outDir).toBe("child-runs");
    expect("outDir" in omitted).toBe(false);
    expect(canonicalProfileHash(inherited)).not.toBe(canonicalProfileHash(overridden));
    expect(canonicalProfileHash(omitted)).toBe(canonicalProfileHash({ args: {}, context: {}, run: {} }));
  });
});
