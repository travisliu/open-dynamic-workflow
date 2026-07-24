import { describe, expect, it, vi } from "vitest";

import { resolveRunProfile } from "../../../src/cli/profile-resolution.js";
import * as profiles from "../../../src/config/profiles.js";
import type { RecordedRunProfileInput } from "../../../src/types/artifacts.js";

describe("resume profile resolution", () => {
  const recorded: RecordedRunProfileInput = {
    selected: "saved",
    source: "recorded",
    hash: "saved-hash",
    resolved: { args: { fromSnapshot: "must-not-run" }, run: { provider: "mock" } },
  };

  it("does not execute a recorded profile snapshot", async () => {
    const build = vi.spyOn(profiles, "buildProfileCatalog");
    const result = await resolveRunProfile({
      cwd: "/project",
      baseConfig: { profiles: {} },
      rawOptions: { resume: "/runs/old" },
      explicitCliOverrides: {},
      explicitArgs: { current: "value" },
      recordedProfile: recorded,
    });

    expect(build).toHaveBeenCalledOnce();
    expect(result.selection).toBeUndefined();
    expect(result.finalCliArgs).toEqual({ current: "value" });
    expect(result.contextSeed).toBeUndefined();
    build.mockRestore();
  });

  it("resolves an explicitly named current profile through the catalog", async () => {
    const result = await resolveRunProfile({
      cwd: "/project",
      baseConfig: { profiles: { current: { args: { source: "catalog" }, run: { provider: "mock" } } } },
      rawOptions: { resume: "/runs/old", profile: "current" },
      explicitCliOverrides: {},
      explicitArgs: { current: "override" },
      recordedProfile: recorded,
    });

    expect(result.selection?.selected).toBe("current");
    expect(result.selection?.source).toBe("config");
    expect(result.finalCliArgs).toEqual({ source: "catalog", current: "override" });
  });
});
