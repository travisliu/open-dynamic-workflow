import { describe, expect, it, vi } from "vitest";
import {
  checkArtifactRootHealth,
  type ArtifactRootHealthDependencies,
} from "../../../src/doctors/artifact-root-health.js";

const ROOT = "/tmp/odw-runs";
const PROBE = `${ROOT}/.odw-write-probe-fixed-id`;

function missingError(message = "missing"): Error & { code: string } {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

function createDependencies(overrides: Partial<ArtifactRootHealthDependencies> = {}) {
  const calls: string[] = [];
  const deps: ArtifactRootHealthDependencies = {
    stat: vi.fn(async (path: string) => {
      calls.push(`stat:${path}`);
      return { isDirectory: () => true };
    }),
    mkdir: vi.fn(async (path: string) => { calls.push(`mkdir:${path}`); }),
    access: vi.fn(async (path: string) => { calls.push(`access:${path}`); }),
    open: vi.fn(async (path: string, flags: "wx", mode: number) => {
      calls.push(`open:${path}:${flags}:${mode.toString(8)}`);
      return { close: vi.fn(async () => { calls.push(`close:${path}`); }) };
    }),
    unlink: vi.fn(async (path: string) => { calls.push(`unlink:${path}`); }),
    randomUUID: vi.fn(() => "fixed-id"),
    ...overrides,
  };
  return { deps, calls };
}

describe("checkArtifactRootHealth", () => {
  it("checks an existing writable directory with an exclusive probe and cleanup", async () => {
    const { deps, calls } = createDependencies();

    const result = await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: true }, deps);

    expect(result).toEqual({ ok: true, path: ROOT, created: false, writable: true });
    expect(calls).toEqual([
      `stat:${ROOT}`, `access:${ROOT}`, `open:${PROBE}:wx:600`, `close:${PROBE}`, `unlink:${PROBE}`,
    ]);
  });

  it("creates a missing root only when requested", async () => {
    const { deps, calls } = createDependencies({ stat: vi.fn(async () => { throw missingError(); }) });

    const result = await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: true }, deps);

    expect(result.created).toBe(true);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      `mkdir:${ROOT}`, `access:${ROOT}`, `open:${PROBE}:wx:600`, `close:${PROBE}`, `unlink:${PROBE}`,
    ]);
  });

  it("does not create or probe a missing root when creation is disabled", async () => {
    const { deps } = createDependencies({ stat: vi.fn(async () => { throw missingError(); }) });

    const result = await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: false }, deps);

    expect(result).toMatchObject({ ok: false, writable: false, path: ROOT });
    expect(deps.mkdir).not.toHaveBeenCalled();
    expect(deps.access).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("reports a non-directory root without later filesystem calls", async () => {
    const { deps } = createDependencies({ stat: vi.fn(async () => ({ isDirectory: () => false })) });

    const result = await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: true }, deps);

    expect(result.message).toContain(`${ROOT} exists but a directory is required`);
    expect(deps.mkdir).not.toHaveBeenCalled();
    expect(deps.access).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("surfaces stat, mkdir, access, and open failures rather than treating them as absence", async () => {
    const cases = [
      [createDependencies({ stat: vi.fn(async () => { throw new Error("stat denied"); }) }).deps, "stat denied"],
      [createDependencies({ stat: vi.fn(async () => { throw missingError(); }), mkdir: vi.fn(async () => { throw new Error("mkdir denied"); }) }).deps, "mkdir denied"],
      [createDependencies({ access: vi.fn(async () => { throw new Error("access denied"); }) }).deps, "access denied"],
      [createDependencies({ open: vi.fn(async () => { throw new Error("open denied"); }) }).deps, "open denied"],
    ] as const;

    for (const [deps, reason] of cases) {
      const result = await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: true }, deps);
      expect(result).toMatchObject({ ok: false, writable: false, path: ROOT });
      expect(result.message).toContain(reason);
    }
  });

  it("removes a successfully opened probe even when close fails", async () => {
    const { deps } = createDependencies({
      open: vi.fn(async () => ({ close: vi.fn(async () => { throw new Error("close failed"); }) })),
    });

    const result = await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: true }, deps);

    expect(result.message).toContain("close failed");
    expect(deps.unlink).toHaveBeenCalledWith(PROBE);
  });

  it("preserves both close and cleanup failures", async () => {
    const { deps } = createDependencies({
      open: vi.fn(async () => ({ close: vi.fn(async () => { throw new Error("close failed"); }) })),
      unlink: vi.fn(async () => { throw new Error("cleanup failed"); }),
    });

    const result = await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: true }, deps);

    expect(result.message).toContain("close failed");
    expect(result.message).toContain("cleanup failed");
  });

  it("reports cleanup failure after an otherwise successful probe", async () => {
    const { deps } = createDependencies({ unlink: vi.fn(async () => { throw new Error("cleanup failed"); }) });

    const result = await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: true }, deps);

    expect(result).toMatchObject({ ok: false, writable: false, path: ROOT });
    expect(result.message).toContain("Unable to remove write probe");
    expect(result.message).toContain("cleanup failed");
  });

  it("does not clean up when exclusive open fails", async () => {
    const { deps } = createDependencies({ open: vi.fn(async () => { throw new Error("already exists"); }) });

    await checkArtifactRootHealth({ runsRoot: ROOT, createIfMissing: true }, deps);

    expect(deps.open).toHaveBeenCalledWith(PROBE, "wx", 0o600);
    expect(deps.unlink).not.toHaveBeenCalled();
  });

  it("rejects relative roots before filesystem access", async () => {
    const { deps } = createDependencies();

    await expect(checkArtifactRootHealth({ runsRoot: "relative/runs", createIfMissing: true }, deps)).rejects.toThrow(TypeError);
    expect(deps.stat).not.toHaveBeenCalled();
  });
});
