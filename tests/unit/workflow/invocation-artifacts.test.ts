import { describe, it, expect, vi } from "vitest";
import { createWorkflowInvocationArtifactWriter } from "../../../src/workflow/invocation-artifacts.js";
import type { ArtifactStore } from "../../../src/types/artifacts.js";

describe("WorkflowInvocationArtifactWriter", () => {
  const mockStore = {
    getRunArtifacts: vi.fn().mockReturnValue({
      workflowInvocationDir: (id: string) => `/tmp/run/workflows/${id}`
    }),
    writeJson: vi.fn().mockResolvedValue("/tmp/run/workflows/wf-1/file.json")
  } as unknown as ArtifactStore;

  it("writes input and initial summary on begin", async () => {
    const writer = createWorkflowInvocationArtifactWriter(mockStore);
    const { artifactPath } = await writer.begin({
      workflowInvocationId: "wf-1",
      workflowName: "test-wf",
      depth: 1,
      args: { foo: "bar" },
      startedAt: "2026-06-11T12:00:00Z"
    });

    expect(artifactPath).toBe("workflows/wf-1");
    expect(mockStore.writeJson).toHaveBeenCalledWith("workflows/wf-1/input.json", expect.objectContaining({
      workflowName: "test-wf",
      args: { foo: "bar" }
    }));
    expect(mockStore.writeJson).toHaveBeenCalledWith("workflows/wf-1/summary.json", expect.objectContaining({
      status: "running"
    }));
  });

  it("writes result and final summary on success", async () => {
    const writer = createWorkflowInvocationArtifactWriter(mockStore);
    await writer.writeSuccess({
      workflowInvocationId: "wf-1",
      workflowName: "test-wf",
      depth: 1,
      startedAt: "2026-06-11T12:00:00Z",
      finishedAt: "2026-06-11T12:00:01Z",
      durationMs: 1000,
      result: { ok: true },
      artifactPath: "workflows/wf-1"
    });

    expect(mockStore.writeJson).toHaveBeenCalledWith("workflows/wf-1/result.json", expect.objectContaining({
      status: "succeeded",
      result: { ok: true }
    }));
    expect(mockStore.writeJson).toHaveBeenCalledWith("workflows/wf-1/summary.json", expect.objectContaining({
      status: "succeeded",
      durationMs: 1000
    }));
  });

  it("writes error and final summary on failure", async () => {
    const writer = createWorkflowInvocationArtifactWriter(mockStore);
    const error = { name: "Error", message: "boom", code: "FAIL" };
    await writer.writeFailure({
      workflowInvocationId: "wf-1",
      workflowName: "test-wf",
      depth: 1,
      startedAt: "2026-06-11T12:00:00Z",
      finishedAt: "2026-06-11T12:00:01Z",
      durationMs: 1000,
      status: "failed",
      error,
      artifactPath: "workflows/wf-1"
    });

    expect(mockStore.writeJson).toHaveBeenCalledWith("workflows/wf-1/error.json", error);
    expect(mockStore.writeJson).toHaveBeenCalledWith("workflows/wf-1/summary.json", expect.objectContaining({
      status: "failed",
      error
    }));
  });

  it("no-ops if no artifact store is provided", async () => {
    const writer = createWorkflowInvocationArtifactWriter(undefined);
    const result = await writer.begin({
      workflowInvocationId: "wf-1",
      workflowName: "test-wf",
      depth: 1,
      args: {},
      startedAt: ""
    });
    expect(result.artifactPath).toBeUndefined();
    await writer.writeSuccess({} as any);
    await writer.writeFailure({} as any);
  });
});
