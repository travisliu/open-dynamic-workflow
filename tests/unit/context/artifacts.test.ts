import { describe, expect, it, vi } from "vitest";
import { createWorkflowContextRuntime } from "../../../src/context/runtime.js";
import { writeContextArtifacts } from "../../../src/context/artifacts.js";
import { CONTEXT_LIMITS } from "../../../src/context/limits.js";

describe("Context Artifact Finalization", () => {
  it("persists root snapshot and summary with redaction and event emission", async () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "run-123" });
    expect((runtime as any).getCompletedPatches).toBeUndefined();
    expect((runtime as any).getRootFrame).toBeUndefined();
    const ctx = runtime.createFacade();

    // Write some root values only
    ctx.set("greeting", "hello world");
    ctx.set("secret_key", "super_secret_value");

    const writtenFiles: Record<string, any> = {};
    const mockArtifactStore: any = {
      writeJson: vi.fn(async (relativePath: string, value: unknown) => {
        writtenFiles[relativePath] = value;
        return `/mock-dir/${relativePath}`;
      }),
    };

    const emittedEvents: any[] = [];
    const emitEvent = (type: string, payload: any) => {
      emittedEvents.push({ type, payload });
    };

    const secretValues = ["super_secret_value"];

    // Act
    const summary = await writeContextArtifacts({
      runId: "run-123",
      artifactStore: mockArtifactStore,
      contextRuntime: runtime,
      emitEvent,
      secretValues,
    });

    // Assert
    expect(mockArtifactStore.writeJson).toHaveBeenCalled();

    // Check root-final.json contents and secret redaction
    const rootFinal = writtenFiles["context/root-final.json"];
    expect(rootFinal).toBeDefined();
    expect(rootFinal.runId).toBe("run-123");
    expect(rootFinal.values.greeting).toBe("hello world");
    expect(rootFinal.values.secret_key).toBe("[REDACTED]");
    expect(rootFinal.truncated).toBeUndefined();

    // Check summary.json contents
    const contextSummary = writtenFiles["context/summary.json"];
    expect(contextSummary).toBeDefined();
    // Supporting either shape (with or without Path suffix, matching either developer A/B output)
    const rootPath = contextSummary.rootFinalArtifactPath ?? contextSummary.rootFinalArtifact;
    const summaryPath = contextSummary.summaryArtifactPath ?? contextSummary.summaryArtifact;
    expect(rootPath).toBe("context/root-final.json");
    expect(summaryPath).toBe("context/summary.json");
    expect(contextSummary.overlayPatchArtifactPaths).toBeUndefined();
    expect(contextSummary.totalOverlays).toBeUndefined();
    expect(contextSummary.mergedOverlays).toBeUndefined();
    expect(contextSummary.failedOverlays).toBeUndefined();
    expect(contextSummary.conflictCount).toBeUndefined();
    expect(contextSummary.rejectionCount).toBeUndefined();

    // Ensure no overlay patch files are written
    const writtenPaths = Object.keys(writtenFiles);
    const patchFiles = writtenPaths.filter(p => p.startsWith("context/overlays/"));
    expect(patchFiles).toHaveLength(0);

    // Check event emissions
    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "context.artifact.written",
        payload: expect.objectContaining({
          artifactKind: "root-final",
          artifactPath: "context/root-final.json",
        }),
      })
    );
    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "context.artifact.written",
        payload: expect.objectContaining({
          artifactKind: "summary",
          artifactPath: "context/summary.json",
        }),
      })
    );

    // Assert no event with artifactKind: "overlay-patch" is emitted
    const patchEvents = emittedEvents.filter(
      (e) => e.type === "context.artifact.written" && e.payload.artifactKind === "overlay-patch"
    );
    expect(patchEvents).toHaveLength(0);
  });

  it("handles final root snapshot truncation gracefully when size limit is exceeded", async () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "run-large" });
    expect((runtime as any).getCompletedPatches).toBeUndefined();
    expect((runtime as any).getRootFrame).toBeUndefined();
    const ctx = runtime.createFacade();

    // Write values that sum up to larger than snapshot size limit
    const chunk = "x".repeat(220 * 1024);
    ctx.set("chunk1", chunk);
    ctx.set("chunk2", chunk);
    ctx.set("chunk3", chunk);
    ctx.set("chunk4", chunk);
    ctx.set("chunk5", chunk);

    const writtenFiles: Record<string, any> = {};
    const mockArtifactStore: any = {
      writeJson: vi.fn(async (relativePath: string, value: unknown) => {
        writtenFiles[relativePath] = value;
        return `/mock-dir/${relativePath}`;
      }),
    };

    // Act & Assert
    // Check that writeContextArtifacts does not throw
    const summary = await writeContextArtifacts({
      runId: "run-large",
      artifactStore: mockArtifactStore,
      contextRuntime: runtime,
    });

    expect(summary).toBeDefined();

    // Check root-final.json has truncated metadata and no values field
    const rootFinal = writtenFiles["context/root-final.json"];
    expect(rootFinal).toBeDefined();
    expect(rootFinal.truncated).toBe(true);
    expect(rootFinal.values).toBeUndefined();
    expect(rootFinal.size.serializedBytes).toBeGreaterThan(CONTEXT_LIMITS.maxSnapshotBytes);
  });
});
