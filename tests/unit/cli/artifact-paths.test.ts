import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  classifyRunTarget,
  legacyRunsRoot,
  resolveArtifactRunsRoot,
  resolvePreviousRun,
  selectRunProfile
} from "../../../src/cli/artifact-paths.js";
import { ErrorCode } from "../../../src/errors/codes.js";

const CWD = path.resolve("/workspace/project");

type FakeResult = "directory" | "file" | Error;

function enoent(): Error & { code: string } {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function fakeStat(entries: Record<string, FakeResult>) {
  const calls: string[] = [];
  return {
    calls,
    fs: {
      stat: async (candidate: string) => {
        calls.push(candidate);
        const result = entries[candidate] ?? enoent();
        if (result instanceof Error) {
          throw result;
        }
        return { isDirectory: () => result === "directory" } as Awaited<ReturnType<typeof import("node:fs/promises").stat>>;
      }
    }
  };
}

function expectErrorCode(action: () => unknown, code: string): void {
  try {
    action();
    expect.fail("Expected an error");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("artifact paths", () => {
  describe("resolveArtifactRunsRoot", () => {
    it.each([
      ["cli", { cliOutDir: "cli/../runs", selectedProfileName: "ci", selectedProfile: { outDir: "profile" }, fileOutDir: "file", builtInOutDir: "default" }, "cli/../runs", path.resolve(CWD, "runs")],
      ["profile", { selectedProfileName: "ci", selectedProfile: { outDir: "profile/../runs" }, fileOutDir: "file", builtInOutDir: "default" }, "profile/../runs", path.resolve(CWD, "runs")],
      ["config", { fileOutDir: "file/../runs", builtInOutDir: "default" }, "file/../runs", path.resolve(CWD, "runs")],
      ["built-in-default", { builtInOutDir: "default/../runs" }, "default/../runs", path.resolve(CWD, "runs")]
    ] as const)("uses %s precedence with literal raw value", (source, layers, rawValue, expectedPath) => {
      // Arrange / Act
      const result = resolveArtifactRunsRoot({ cwd: CWD, ...layers });

      // Assert
      expect(result).toEqual({
        source,
        rawValue,
        path: expectedPath,
        ...("selectedProfileName" in layers ? { selectedProfile: "ci" } : {})
      });
    });

    it("keeps profile metadata when its outDir falls through", () => {
      // Arrange / Act
      const fromFile = resolveArtifactRunsRoot({
        cwd: CWD, selectedProfileName: "ci", selectedProfile: {}, fileOutDir: "file", builtInOutDir: "default"
      });
      const fromDefault = resolveArtifactRunsRoot({
        cwd: CWD, selectedProfileName: "ci", selectedProfile: {}, builtInOutDir: "default"
      });

      // Assert
      expect(fromFile).toMatchObject({ source: "config", selectedProfile: "ci" });
      expect(fromDefault).toMatchObject({ source: "built-in-default", selectedProfile: "ci" });
    });

    it("normalizes native absolute values and preserves unexpanded literal segments", () => {
      // Arrange / Act
      const absolute = resolveArtifactRunsRoot({ cwd: CWD, cliOutDir: "/outside/../runs", builtInOutDir: "default" });
      const literals = ["~/runs", "$RUNS/runs", "%RUNS%/runs"].map(cliOutDir =>
        resolveArtifactRunsRoot({ cwd: CWD, cliOutDir, builtInOutDir: "default" })
      );

      // Assert
      expect(absolute.path).toBe(path.resolve("/outside/../runs"));
      expect(literals.map(result => result.path)).toEqual([
        path.resolve(CWD, "~/runs"), path.resolve(CWD, "$RUNS/runs"), path.resolve(CWD, "%RUNS%/runs")
      ]);
    });

    it.each([
      [{ cliOutDir: "", builtInOutDir: "default" }, ErrorCode.CLI_USAGE_ERROR],
      [{ cliOutDir: "   ", builtInOutDir: "default" }, ErrorCode.CLI_USAGE_ERROR],
      [{ selectedProfileName: "ci", selectedProfile: { outDir: "" }, builtInOutDir: "default" }, ErrorCode.CONFIG_VALIDATION_ERROR],
      [{ fileOutDir: "", builtInOutDir: "default" }, ErrorCode.CONFIG_VALIDATION_ERROR],
      [{ builtInOutDir: "" }, ErrorCode.CONFIG_VALIDATION_ERROR],
      [{ selectedProfileName: "ci", builtInOutDir: "default" }, ErrorCode.CLI_USAGE_ERROR],
      [{ selectedProfile: {}, builtInOutDir: "default" }, ErrorCode.CLI_USAGE_ERROR],
      [{ selectedProfileName: " ", selectedProfile: {}, builtInOutDir: "default" }, ErrorCode.CLI_USAGE_ERROR]
    ])("rejects malformed input %#", (layers, code) => {
      expectErrorCode(() => resolveArtifactRunsRoot({ cwd: CWD, ...layers } as any), code);
    });
  });

  describe("selectRunProfile", () => {
    it("selects explicit over recorded and only reuses recorded profiles when enabled", () => {
      // Arrange
      const profiles = { explicit: { outDir: "explicit" }, recorded: { outDir: "recorded" } };

      // Act / Assert
      expect(selectRunProfile({ profiles, explicitProfile: "explicit", recordedProfile: "recorded", reuseRecordedProfile: true }))
        .toMatchObject({ name: "explicit", config: profiles.explicit, source: "explicit" });
      expect(selectRunProfile({ profiles, recordedProfile: "recorded", reuseRecordedProfile: true }))
        .toMatchObject({ name: "recorded", config: profiles.recorded, source: "recorded" });
      expect(selectRunProfile({ profiles, recordedProfile: "missing", reuseRecordedProfile: false })).toEqual({ source: "none" });
      expect(selectRunProfile({ profiles, reuseRecordedProfile: false })).toEqual({ source: "none" });
    });

    it("rejects missing or malformed eligible profiles before lookup", async () => {
      // Arrange
      const lookup = fakeStat({});

      // Act / Assert
      expectErrorCode(() => selectRunProfile({ profiles: {}, explicitProfile: "missing", reuseRecordedProfile: false }), ErrorCode.CLI_USAGE_ERROR);
      expectErrorCode(() => selectRunProfile({ profiles: {}, recordedProfile: " ", reuseRecordedProfile: true }), ErrorCode.CLI_USAGE_ERROR);
      expect(lookup.calls).toHaveLength(0);
    });

    it("uses own keys rather than Object.prototype entries", () => {
      expectErrorCode(
        () => selectRunProfile({ profiles: {}, explicitProfile: "toString", reuseRecordedProfile: false }),
        ErrorCode.CLI_USAGE_ERROR
      );
    });
  });

  describe("target classification", () => {
    it.each([
      ["run-123", "bare-run-id"], ["/runs/run-123", "explicit-run-path"], ["C:\\runs\\run-123", "explicit-run-path"],
      ["\\\\server\\share\\run-123", "explicit-run-path"], ["nested/run", "explicit-run-path"], ["nested\\run", "explicit-run-path"],
      ["./run", "explicit-run-path"], ["../run", "explicit-run-path"], [".\\run", "explicit-run-path"], ["..\\run", "explicit-run-path"]
    ] as const)(("classifies %s"), (target, kind) => {
      expect(classifyRunTarget(target)).toBe(kind);
    });

    it("rejects malformed targets and lexically resolves the legacy root", () => {
      expectErrorCode(() => classifyRunTarget(""), ErrorCode.CLI_USAGE_ERROR);
      expectErrorCode(() => classifyRunTarget("  "), ErrorCode.CLI_USAGE_ERROR);
      expectErrorCode(() => classifyRunTarget(null as any), ErrorCode.CLI_USAGE_ERROR);
      expect(legacyRunsRoot(CWD)).toBe(path.resolve(CWD, ".open-dynamic-workflow/runs"));
    });
  });

  describe("resolvePreviousRun", () => {
    function input(target: string, fs: ReturnType<typeof fakeStat>["fs"], effectiveRunsRoot = "runs", fallback = "legacy") {
      return { target, cwd: CWD, effectiveRunsRoot, legacyRunsRoot: fallback, fs };
    }

    it("checks one explicit candidate and normalizes relative and absolute paths", async () => {
      // Arrange
      const relative = path.resolve(CWD, "runs/../specific-run");
      const absolute = path.resolve("/outside/../specific-run");
      const fake = fakeStat({ [relative]: "directory", [absolute]: "directory" });

      // Act
      const relativeResult = await resolvePreviousRun(input("./runs/../specific-run", fake.fs));
      const absoluteResult = await resolvePreviousRun(input("/outside/../specific-run", fake.fs));

      // Assert
      expect(relativeResult).toMatchObject({ runDir: relative, source: "explicit-path", attemptedPaths: [relative] });
      expect(absoluteResult).toMatchObject({ runDir: absolute, source: "explicit-path", attemptedPaths: [absolute] });
      expect(fake.calls).toEqual([relative, absolute]);
    });

    it("uses effective root first, falls back to legacy, and skips duplicate equal roots", async () => {
      // Arrange
      const primary = path.resolve(CWD, "runs/id");
      const fallback = path.resolve(CWD, "legacy/id");
      const primaryHit = fakeStat({ [primary]: "directory", [fallback]: "directory" });
      const fallbackHit = fakeStat({ [fallback]: "directory" });
      const equalMiss = fakeStat({});

      // Act / Assert
      expect((await resolvePreviousRun(input("id", primaryHit.fs))).source).toBe("effective-root");
      expect(primaryHit.calls).toEqual([primary]);
      expect((await resolvePreviousRun(input("id", fallbackHit.fs))).source).toBe("legacy-fallback");
      expect(fallbackHit.calls).toEqual([primary, fallback]);
      await expect(resolvePreviousRun(input("id", equalMiss.fs, "same/../runs", "runs"))).rejects.toMatchObject({ code: ErrorCode.CLI_USAGE_ERROR });
      expect(equalMiss.calls).toEqual([primary]);
    });

    it("reports attempted missing candidates in order", async () => {
      const primary = path.resolve(CWD, "runs/id");
      const fallback = path.resolve(CWD, "legacy/id");
      const fake = fakeStat({});

      await expect(resolvePreviousRun(input("id", fake.fs))).rejects.toThrow(`${primary}, ${fallback}`);
      expect(fake.calls).toEqual([primary, fallback]);
    });

    it("stops on non-directories and identifies the conflicting candidate", async () => {
      const primary = path.resolve(CWD, "runs/id");
      const fallback = path.resolve(CWD, "legacy/id");
      const explicit = path.resolve(CWD, "specific");
      const primaryFile = fakeStat({ [primary]: "file" });
      const fallbackFile = fakeStat({ [fallback]: "file" });
      const explicitFile = fakeStat({ [explicit]: "file" });

      await expect(resolvePreviousRun(input("id", primaryFile.fs))).rejects.toThrow(primary);
      expect(primaryFile.calls).toEqual([primary]);
      await expect(resolvePreviousRun(input("id", fallbackFile.fs))).rejects.toThrow(fallback);
      expect(fallbackFile.calls).toEqual([primary, fallback]);
      await expect(resolvePreviousRun(input("./specific", explicitFile.fs))).rejects.toThrow(explicit);
      expect(explicitFile.calls).toEqual([explicit]);
    });

    it.each([Object.assign(new Error("denied"), { code: "EACCES" }), Object.assign(new Error("blocked"), { code: "EPERM" }), new Error("unexpected")])(
      "rethrows non-ENOENT stat errors unchanged",
      async error => {
      const candidate = path.resolve(CWD, "runs/id");
      const fake = fakeStat({ [candidate]: error });
      await expect(resolvePreviousRun(input("id", fake.fs))).rejects.toBe(error);
      expect(fake.calls).toEqual([candidate]);
      }
    );
  });
});
