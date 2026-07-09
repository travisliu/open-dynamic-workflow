import { describe, expect, it, vi } from "vitest";
import { createWorkflowContextRuntime } from "../../../src/context/runtime.js";
import { writeContextArtifacts } from "../../../src/context/artifacts.js";
import { CONTEXT_LIMITS } from "../../../src/context/limits.js";

describe("Context Artifact Finalization", () => {
  it("persists root snapshot, summary, and completed overlay patches with redaction and event emission", async () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "run-123" });
    const ctx = runtime.createFacade();

    // Write some root and overlay values
    ctx.set("greeting", "hello world");
    ctx.set("secret_key", "super_secret_value");

    await runtime.runWithOverlay(
      {
        scopeId: "workflow:nested-scope",
        scopeType: "workflow",
        mergeRules: { nestedVal: "replace" },
      },
      async () => {
        const subCtx = runtime.createFacade();
        subCtx.set("nestedVal", "nested-data");
      }
    );

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
    expect(summary.totalOverlays).toBe(1);
    expect(summary.mergedOverlays).toBe(1);
    expect(summary.failedOverlays).toBe(0);

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
    expect(contextSummary.rootFinalArtifactPath).toBe("context/root-final.json");
    expect(contextSummary.summaryArtifactPath).toBe("context/summary.json");
    expect(contextSummary.overlayPatchArtifactPaths["workflow:nested-scope"]).toBe(
      "context/overlays/workflow_nested-scope.patch.json"
    );

    // Check overlay patch contents and hidden rawValue omission
    const patch = writtenFiles["context/overlays/workflow_nested-scope.patch.json"];
    expect(patch).toBeDefined();
    expect(patch.scopeId).toBe("workflow:nested-scope");
    expect(patch.patchOperations[0].path).toBe("nestedVal");
    expect(patch.patchOperations[0].valuePreview).toBe("nested-data");
    expect(patch.patchOperations[0].rawValue).toBeUndefined(); // Verify hidden rawValue was omitted/not serialized

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
    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: "context.artifact.written",
        payload: expect.objectContaining({
          artifactKind: "overlay-patch",
          artifactPath: "context/overlays/workflow_nested-scope.patch.json",
        }),
      })
    );
  });

  it("handles final root snapshot truncation gracefully when size limit is exceeded", async () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "run-large" });
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
