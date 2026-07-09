import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveResumeProfileBehavior, resolveRunProfile } from "../../../src/cli/profile-resolution.js";
import { recordedProfileToRunProfile } from "../../../src/cli/run-input-profile.js";
import * as profileFile from "../../../src/config/profile-file.js";
import * as profiles from "../../../src/config/profiles.js";
import type { RecordedRunProfileInput } from "../../../src/types/artifacts.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

vi.mock("../../../src/config/profile-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/profile-file.js")>();
  return {
    ...actual,
    loadExternalProfilesFile: vi.fn(),
  };
});

vi.mock("../../../src/config/profiles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/profiles.js")>();
  return {
    ...actual,
    buildProfileCatalog: vi.fn().mockImplementation(actual.buildProfileCatalog),
    resolveSelectedProfile: vi.fn().mockImplementation(actual.resolveSelectedProfile),
  };
});

describe("resolveResumeProfileBehavior decision helper", () => {
  const dummyProfile: RecordedRunProfileInput = {
    selected: "test-profile",
    source: "external-override",
    resolved: {
      description: "Test description",
      args: { arg1: "val1" },
      context: { ctx1: "val1" },
      run: { provider: "mock" }
    },
    hash: "test-hash",
  };

  it("resume without recorded profile returns none", () => {
    expect(resolveResumeProfileBehavior("resume", false, undefined)).toBe("none");
  });

  it("resume with recorded profile returns reuse", () => {
    expect(resolveResumeProfileBehavior("resume", false, dummyProfile)).toBe("reuse");
  });

  it("run --resume without recorded profile and no flags returns none", () => {
    expect(resolveResumeProfileBehavior("run-resume", false, undefined)).toBe("none");
  });

  it("run --resume with recorded profile and no flags returns reuse", () => {
    expect(resolveResumeProfileBehavior("run-resume", false, dummyProfile)).toBe("reuse");
  });

  it("run --resume with flags (profile/profiles) returns fresh", () => {
    expect(resolveResumeProfileBehavior("run-resume", true, dummyProfile)).toBe("fresh");
    expect(resolveResumeProfileBehavior("run-resume", true, undefined)).toBe("fresh");
  });
});

describe("resolveRunProfile with recorded profile", () => {
  const dummyProfile: RecordedRunProfileInput = {
    selected: "test-profile",
    source: "external-override",
    profilesPath: "custom-profiles.yaml",
    resolved: {
      description: "Test description",
      args: { arg1: "val1", arg2: "val2" },
      context: { ctx1: "val1" },
      run: { provider: "mock" }
    },
    hash: "test-hash",
    inheritanceChain: ["parent-profile", "test-profile"],
  };

  const baseConfig = {
    cwd: "/mock-cwd",
    profiles: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the recorded snapshot, bypassing external loader and catalog building", async () => {
    const loadSpy = vi.spyOn(profileFile, "loadExternalProfilesFile");
    const buildSpy = vi.spyOn(profiles, "buildProfileCatalog");
    const resolveSpy = vi.spyOn(profiles, "resolveSelectedProfile");

    const result = await resolveRunProfile({
      cwd: "/mock-cwd",
      baseConfig,
      rawOptions: { resume: "/mock-run-root", recordedProfile: dummyProfile },
      explicitCliOverrides: {},
      explicitArgs: { arg2: "override-val", arg3: "new-val" },
      recordedProfile: dummyProfile,
    });

    expect(loadSpy).not.toHaveBeenCalled();
    expect(buildSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();

    expect(result.resumedFromRecordedProfile).toBe(true);
    expect(result.selection).toBeDefined();
    expect(result.selection?.selected).toBe("test-profile");
    expect(result.selection?.source).toBe("recorded");
    expect(result.selection?.hash).toBe("test-hash");
    expect(result.selection?.profilesPath).toBe("custom-profiles.yaml");
    expect(result.selection?.hasExternalFile).toBe(true);

    // Assert final cli args merged correctly
    expect(result.finalCliArgs).toEqual({
      arg1: "val1",
      arg2: "override-val",
      arg3: "new-val",
    });

    // Assert reportProfile and contextSeed fields
    expect(result.reportProfile?.selected).toBe("test-profile");
    expect(result.reportProfile?.source).toBe("recorded");
    expect(result.reportProfile?.hash).toBe("test-hash");
    expect(result.reportProfile?.profilesPath).toBe("custom-profiles.yaml");

    expect(result.contextSeed?.metadata.source).toBe("recorded");
    expect(result.contextSeed?.metadata.hash).toBe("test-hash");
    expect(result.contextSeed?.metadata.hasExternalFile).toBe(true);
  });

  it("forces fresh resolution when explicit flags are present", async () => {
    const buildSpy = vi.spyOn(profiles, "buildProfileCatalog").mockReturnValue({
      catalog: new Map(),
      diagnostics: [],
    });
    const resolveSpy = vi.spyOn(profiles, "resolveSelectedProfile").mockReturnValue({
      selection: undefined,
      diagnostics: [],
    });

    await resolveRunProfile({
      cwd: "/mock-cwd",
      baseConfig,
      rawOptions: { resume: "/mock-run-root", profile: "new-profile" },
      explicitCliOverrides: {},
      explicitArgs: {},
      recordedProfile: dummyProfile,
    });

    expect(buildSpy).toHaveBeenCalled();
    expect(resolveSpy).toHaveBeenCalled();
  });
});
