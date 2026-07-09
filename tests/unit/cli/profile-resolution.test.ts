import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { validateProfileOptions, resolveRunProfile } from "../../../src/cli/profile-resolution.js";
import { profileRunOptionsToCliOverrides, mergeProfileArgs } from "../../../src/config/profiles.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import type { ResolvedConfig } from "../../../src/types/config.js";

const TEMP_DIR = path.resolve("tests/temp-profile-resolution-unit");

describe("Unit Tests: CLI Profile Resolution Layer", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("resolves inline config profiles", async () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      cwd: TEMP_DIR,
      outDir: TEMP_DIR,
      cliArgs: {},
      profiles: {
        fast: {
          description: "fast profile",
          args: { mode: "fast" },
          context: { speed: "high" },
          run: { concurrency: 10 }
        }
      }
    };

    const result = await validateProfileOptions({
      cwd: TEMP_DIR,
      rawOptions: { profile: "fast" },
      config
    });

    expect(result.selection).toBeDefined();
    expect(result.selection?.selected).toBe("fast");
    expect(result.selection?.source).toBe("config");
    expect(result.selection?.resolved.args.mode).toBe("fast");
    expect(result.selection?.resolved.context.speed).toBe("high");
    expect(result.selection?.resolved.run.concurrency).toBe(10);
  });

  it("resolves external profiles and overrides config profiles", async () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      cwd: TEMP_DIR,
      outDir: TEMP_DIR,
      cliArgs: {},
      profiles: {
        fast: {
          run: { concurrency: 2 }
        }
      }
    };

    const externalYml = `
profiles:
  fast:
    run:
      concurrency: 8
`;
    const profilesPath = path.join(TEMP_DIR, "profiles.yml");
    await fs.writeFile(profilesPath, externalYml, "utf8");

    const result = await validateProfileOptions({
      cwd: TEMP_DIR,
      rawOptions: { profile: "fast", profiles: "profiles.yml" },
      config
    });

    expect(result.selection).toBeDefined();
    expect(result.selection?.selected).toBe("fast");
    expect(result.selection?.source).toBe("external-override");
    expect(result.selection?.resolved.run.concurrency).toBe(8);
    expect(result.diagnostics.some(d => d.code === "PROFILE_EXTERNAL_OVERRIDE")).toBe(true);
  });

  it("returns no selection and unchanged args/seed when no profile flag is passed", async () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      cwd: TEMP_DIR,
      outDir: TEMP_DIR,
      cliArgs: {},
    };

    const result = await resolveRunProfile({
      cwd: TEMP_DIR,
      baseConfig: config,
      rawOptions: {},
      explicitCliOverrides: {},
      explicitArgs: { test: "val" }
    });

    expect(result.selection).toBeUndefined();
    expect(result.contextSeed).toBeUndefined();
    expect(result.reportProfile).toBeUndefined();
    expect(result.finalCliArgs).toEqual({ test: "val" });
  });

  it("returns warning diagnostic when profiles-only flag is passed without profile flag", async () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      cwd: TEMP_DIR,
      outDir: TEMP_DIR,
      cliArgs: {},
    };

    const externalYml = `
profiles:
  fast:
    run:
      concurrency: 8
`;
    const profilesPath = path.join(TEMP_DIR, "profiles.yml");
    await fs.writeFile(profilesPath, externalYml, "utf8");

    const result = await resolveRunProfile({
      cwd: TEMP_DIR,
      baseConfig: config,
      rawOptions: { profiles: "profiles.yml" },
      explicitCliOverrides: {},
      explicitArgs: { test: "val" }
    });

    expect(result.selection).toBeUndefined();
    expect(result.contextSeed).toBeUndefined();
    expect(result.reportProfile).toBeUndefined();
    expect(result.diagnostics.some(d => d.code === "PROFILE_UNUSED_FILE")).toBe(true);
  });

  it("preserves typed Phase 1 errors for missing/invalid profiles or cycles", async () => {
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      cwd: TEMP_DIR,
      outDir: TEMP_DIR,
      cliArgs: {},
      profiles: {
        cyclicA: {
          extends: "cyclicB"
        },
        cyclicB: {
          extends: "cyclicA"
        }
      }
    };

    // Missing profile name
    try {
      await validateProfileOptions({
        cwd: TEMP_DIR,
        rawOptions: { profile: "nonexistent" },
        config
      });
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
      expect(err.code).toBe(ErrorCode.PROFILE_NOT_FOUND);
    }

    // Cyclic inheritance
    try {
      await validateProfileOptions({
        cwd: TEMP_DIR,
        rawOptions: { profile: "cyclicA" },
        config
      });
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
      expect(err.code).toBe(ErrorCode.PROFILE_VALIDATION_ERROR);
    }
  });

  it("converts permitted run keys and retains false/0-like values", () => {
    const run = {
      provider: "gemini",
      model: "gemini-3.5-flash",
      concurrency: 0,
      timeoutMs: 5000,
      maxAgentCalls: 2,
      failFast: false,
      report: "json" as const,
      thinkingEffort: "high" as const,
      retry: false as const
    };

    const overrides = profileRunOptionsToCliOverrides(run);

    expect(overrides.config.provider).toBe("gemini");
    expect(overrides.config.model).toBe("gemini-3.5-flash");
    expect(overrides.config.concurrency).toBe(0);
    expect(overrides.config.timeoutMs).toBe(5000);
    expect(overrides.config.maxAgentCalls).toBe(2);
    expect(overrides.config.failFast).toBe(false);
    expect(overrides.config.report).toBe("json");
    expect(overrides.thinkingEffort).toBe("high");
    expect(overrides.config.noRetry).toBe(true);
  });

  it("shallowly merges args, cloning values so they are not shared references", () => {
    const profileArgs = {
      nested: { a: 1 },
      onlyInProfile: "profile-val",
      colliding: "profile-win"
    };

    const explicitArgs = {
      nested2: { b: 2 },
      onlyInCli: "cli-val",
      colliding: "cli-win"
    };

    const merged = mergeProfileArgs(profileArgs, explicitArgs);

    expect(merged.onlyInProfile).toBe("profile-val");
    expect(merged.onlyInCli).toBe("cli-val");
    expect(merged.colliding).toBe("cli-win");
    expect(merged.nested).toEqual({ a: 1 });

    // Verify deep cloning: mutating the merged result doesn't affect the input
    (merged.nested as any).a = 99;
    expect(profileArgs.nested.a).toBe(1);
  });
});
