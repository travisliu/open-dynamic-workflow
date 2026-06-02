import { describe, expect, it } from "vitest";
import { createInitialManifest, updateManifestStatus } from "../../../src/artifacts/manifest.js";

describe("manifest helpers", () => {
  const defaultInput = {
    runId: "run-123",
    workflowPath: "workflows/my-workflow.js",
    workflowHash: "hash-123",
    execflowVersion: "1.0.0",
    cwd: "/workspace",
    configPath: "config.yaml"
  };

  it('createInitialManifest returns status: "running"', () => {
    const manifest = createInitialManifest(defaultInput);
    expect(manifest.status).toBe("running");
  });

  it("schemaVersion is exactly execflow.manifest.v1", () => {
    const manifest = createInitialManifest(defaultInput);
    expect(manifest.schemaVersion).toBe("execflow.manifest.v1");
  });

  it("createdAt and updatedAt are ISO strings", () => {
    const manifest = createInitialManifest(defaultInput);
    expect(() => new Date(manifest.createdAt)).not.toThrow();
    expect(() => new Date(manifest.updatedAt)).not.toThrow();
    expect(manifest.createdAt).toBe(manifest.updatedAt);
  });

  it("updateManifestStatus preserves createdAt", () => {
    const manifest = createInitialManifest(defaultInput);
    const updated = updateManifestStatus(manifest, "succeeded");
    expect(updated.createdAt).toBe(manifest.createdAt);
  });

  it("updateManifestStatus changes updatedAt", () => {
    const mockNow = new Date("2026-06-02T12:00:00.000Z");
    const manifest = createInitialManifest({ ...defaultInput, now: new Date("2026-06-02T10:00:00.000Z") });
    const updated = updateManifestStatus(manifest, "succeeded", mockNow);
    expect(updated.updatedAt).toBe("2026-06-02T12:00:00.000Z");
    expect(updated.updatedAt).not.toBe(manifest.updatedAt);
  });

  it("updateManifestStatus sets the requested final status", () => {
    const manifest = createInitialManifest(defaultInput);
    const updated = updateManifestStatus(manifest, "failed");
    expect(updated.status).toBe("failed");
  });
});
