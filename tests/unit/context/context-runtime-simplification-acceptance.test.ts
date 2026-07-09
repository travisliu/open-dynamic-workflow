import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorkflowContextRuntime } from "../../../src/context/runtime.js";
import { writeContextArtifacts } from "../../../src/context/artifacts.js";
import { JsonReporter } from "../../../src/output/json-reporter.js";
import { PrettyReporter } from "../../../src/output/pretty-reporter.js";

function createMockStreams() {
  let stdoutData = "";
  let stderrData = "";

  return {
    streams: {
      stdout: {
        write(chunk: any) {
          stdoutData += chunk.toString();
          return true;
        },
      } as any,
      stderr: {
        write(chunk: any) {
          stderrData += chunk.toString();
          return true;
        },
      } as any,
    },
    getStdout: () => stdoutData,
    getStderr: () => stderrData,
  };
}

describe("Context runtime simplification acceptance", () => {
  it("keeps the workflow context root-only while preserving scoped facade operations", async () => {
    // Arrange
    const runId = "context-runtime-acceptance";
    const runtime = createWorkflowContextRuntime({ runId });
    const ctx = runtime.createFacade();

    expect(typeof runtime.runWithRootScope).toBe("function");
    expect(typeof runtime.getActiveScopeId).toBe("function");
    expect(typeof runtime.getSummary).toBe("function");
    expect(typeof runtime.createFacade).toBe("function");
    expect(typeof runtime.getRootSnapshotData).toBe("function");
    expect((runtime as any).runWithOverlay).toBeUndefined();
    expect((runtime as any).mergeOverlayResults).toBeUndefined();
    expect((runtime as any).getCompletedPatches).toBeUndefined();
    expect(runtime.getActiveScopeId()).toBe(runId);

    // Act
    await runtime.runWithRootScope(async () => {
      ctx.set("profile", { name: "Ada", tags: ["core"] });
      ctx.merge("profile", { active: true });
      ctx.append("profile.tags", "owner");
      expect(ctx.has("profile.active")).toBe(true);
      expect(ctx.get("profile.name")).toBe("Ada");

      const profile = ctx.get<any>("profile");
      profile.tags.push("mutated");
      expect(ctx.get("profile.tags")).toEqual(["core", "owner"]);

      await ctx.scope("nested", async () => {
        ctx.set("value", 42);
        expect(ctx.get("value")).toBe(42);
        expect(ctx.get("nested.value")).toBe(42);
      });

      try {
        await ctx.scope("sync-error", () => {
          ctx.set("marker", "sync");
          throw new Error("sync failure");
        });
      } catch {
        // Intentional failure to verify scope cleanup.
      }

      try {
        await ctx.scope("async-error", async () => {
          ctx.set("marker", "async");
          throw new Error("async failure");
        });
      } catch {
        // Intentional failure to verify scope cleanup.
      }

      ctx.delete("profile.active");
      ctx.set("after", "ok");
    });

    // Assert
    expect(ctx.get("profile")).toEqual({ name: "Ada", tags: ["core", "owner"] });
    expect(ctx.get("profile.active")).toBeUndefined();
    expect(ctx.get("nested.value")).toBe(42);
    expect(ctx.get("after")).toBe("ok");
    expect(ctx.get("sync-error.marker")).toBe("sync");
    expect(ctx.get("async-error.marker")).toBe("async");
    expect(ctx.get("marker")).toBeUndefined();

    const snapshot = ctx.snapshot({ metadata: true }) as any;
    expect(snapshot.metadata.scopeId).toBe(runId);
    expect(snapshot.metadata.visibleScopes).toEqual([runId]);
    expect(snapshot.metadata.sourcePaths.profile).toBe(runId);
    expect(snapshot.metadata.sourcePaths["profile.name"]).toBe(runId);
    expect(snapshot.metadata.sourcePaths["nested.value"]).toBe(runId);
    expect(snapshot.metadata.deletedPaths).toContain("profile.active");

    snapshot.values.profile.name = "Changed";
    expect(ctx.get("profile.name")).toBe("Ada");

    const summary = runtime.getSummary() as any;
    expect(summary.scopeId).toBe(runId);
    expect(summary.totalOverlays).toBeUndefined();
    expect(summary.mergedOverlays).toBeUndefined();
    expect(summary.conflictCount).toBeUndefined();
    expect(summary.rejectionCount).toBeUndefined();
  });

  it("writes root-only artifacts and renders root-only report summaries", async () => {
    // Arrange
    const runId = "context-artifact-acceptance";
    const runtime = createWorkflowContextRuntime({ runId });
    const ctx = runtime.createFacade();

    await runtime.runWithRootScope(() => {
      ctx.set("project", {
        name: "odw",
        description: "workflow context",
        secret: "super_secret_value",
      });
      ctx.merge("project", { enabled: true });
    });

    const writtenFiles: Record<string, any> = {};
    const artifactStore = {
      writeJson: vi.fn(async (relativePath: string, value: unknown) => {
        writtenFiles[relativePath] = value;
        return `/mock/${relativePath}`;
      }),
    };

    const emittedEvents: Array<{ type: string; payload: any }> = [];
    const emitEvent = (type: string, payload: any) => {
      emittedEvents.push({ type, payload });
    };

    // Act
    const finalSummary = await writeContextArtifacts({
      runId,
      artifactStore: artifactStore as any,
      contextRuntime: runtime,
      emitEvent,
      secretValues: ["super_secret_value"],
    });

    const reportContext = {
      rootFinalArtifact: finalSummary.rootFinalArtifactPath ?? (finalSummary as any).rootFinalArtifact,
      summaryArtifact: finalSummary.summaryArtifactPath ?? (finalSummary as any).summaryArtifact,
    };

    const result = {
      schemaVersion: "open-dynamic-workflow.report.v1",
      runId,
      status: "succeeded",
      meta: { name: "context-runtime-simplification", description: "acceptance report" },
      agents: [],
      startedAt: "2026-07-09T00:00:00.000Z",
      finishedAt: "2026-07-09T00:00:01.000Z",
      durationMs: 1000,
      artifactsDir: "/tmp/run",
      reportPath: "/tmp/run/report.json",
      eventsPath: "/tmp/run/events.jsonl",
      context: reportContext,
    } as any;

    const jsonStreams = createMockStreams();
    const prettyStreams = createMockStreams();
    const jsonReporter = new JsonReporter(jsonStreams.streams);
    const prettyReporter = new PrettyReporter(prettyStreams.streams);

    jsonReporter.finish(result);
    prettyReporter.finish(result);

    // Assert
    expect(Object.keys(writtenFiles).sort()).toEqual(["context/root-final.json", "context/summary.json"]);

    const rootFinal = writtenFiles["context/root-final.json"];
    expect(rootFinal.runId).toBe(runId);
    expect(rootFinal.scopeId).toBe(runId);
    expect(rootFinal.values.project.name).toBe("odw");
    expect(rootFinal.values.project.description).toBe("workflow context");
    expect(rootFinal.values.project.secret).toBe("[REDACTED]");
    expect(rootFinal.values.project.enabled).toBe(true);
    expect(rootFinal.truncated).toBeUndefined();

    const contextSummary = writtenFiles["context/summary.json"];
    expect(contextSummary.rootFinalArtifactPath ?? contextSummary.rootFinalArtifact).toBe("context/root-final.json");
    expect(contextSummary.summaryArtifactPath ?? contextSummary.summaryArtifact).toBe("context/summary.json");
    expect(contextSummary.overlayPatchArtifactPaths).toBeUndefined();
    expect(contextSummary.totalOverlays).toBeUndefined();
    expect(contextSummary.mergedOverlays).toBeUndefined();
    expect(contextSummary.failedOverlays).toBeUndefined();
    expect(contextSummary.conflictCount).toBeUndefined();
    expect(contextSummary.rejectionCount).toBeUndefined();

    expect(
      emittedEvents.filter(
        (event) => event.type === "context.artifact.written" && event.payload.artifactKind === "overlay-patch"
      )
    ).toHaveLength(0);
    expect(emittedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "context.artifact.written",
          payload: expect.objectContaining({
            artifactKind: "root-final",
            artifactPath: "context/root-final.json",
          }),
        }),
        expect.objectContaining({
          type: "context.artifact.written",
          payload: expect.objectContaining({
            artifactKind: "summary",
            artifactPath: "context/summary.json",
          }),
        }),
      ])
    );

    const parsedJson = JSON.parse(jsonStreams.getStdout().trim());
    expect(parsedJson.context).toEqual(reportContext);
    expect(parsedJson.context.rootFinalArtifact).toBe("context/root-final.json");
    expect(parsedJson.context.summaryArtifact).toBe("context/summary.json");
    expect(parsedJson.context.overlayCount).toBeUndefined();
    expect(parsedJson.context.conflictCount).toBeUndefined();
    expect(parsedJson.context.rejectedWriteCount).toBeUndefined();
    expect(parsedJson.context.truncatedPreviewCount).toBeUndefined();

    const prettyOutput = prettyStreams.getStdout();
    expect(prettyOutput).toContain("context/root-final.json");
    expect(prettyOutput).toContain("context/summary.json");
    expect(prettyOutput).not.toContain("overlays");
    expect(prettyOutput).not.toContain("conflicts");
    expect(prettyOutput).not.toContain("rejected");
  });

  it("keeps the overlay-specific test files absent from the suite", () => {
    // Arrange
    const removedPaths = [
      "tests/unit/context/overlay.test.ts",
      "tests/unit/context/inheritance.test.ts",
      "tests/unit/context/merge.test.ts",
      "tests/integration/workflow-context-overlays.test.ts",
    ];

    // Act / Assert
    for (const filePath of removedPaths) {
      expect(existsSync(join(process.cwd(), filePath))).toBe(false);
    }
  });
});
