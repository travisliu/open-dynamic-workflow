import { describe, it, expect, vi } from "vitest";
import { DefaultWorkflowInvocationManager } from "../../../src/workflow/invocation-manager.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenFlowError } from "../../../src/errors/types.js";

describe("workflow recursion and depth", () => {
  const createMockRuntime = (maxDepth = 8) => ({
    runId: "test-run",
    config: { 
      workflow: { maxDepth },
      timeoutMs: 30000
    },
    args: {},
    abortController: new AbortController(),
    eventSink: { emit: vi.fn() },
    artifactStore: { 
      writeJson: vi.fn().mockResolvedValue(undefined),
      isRunCreated: () => true,
      getRunArtifacts: () => ({ reportPath: "r.json", eventsPath: "e.jsonl" })
    },
    workflowSummaries: []
  } as any);

  it("rejects direct recursion", async () => {
    const runtime = createMockRuntime();
    const defA = { name: "A", parsedWorkflow: { body: "", meta: { name: "A" } } };
    const registry = { 
      require: vi.fn().mockReturnValue(defA)
    } as any;
    
    const manager = new DefaultWorkflowInvocationManager({ 
      runtime, 
      registry, 
      evaluate: async () => ({}) 
    });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "id-a",
      workflowName: "A",
      depth: 0,
      ancestry: ["A"],
      signal: new AbortController().signal,
      deadlineAt: Infinity,
      effectiveConcurrency: 1
    } as any;

    await expect(manager.invokeChild(parentCtx, { name: "A" }))
      .rejects.toThrow(OpenFlowError);
    
    const err = await manager.invokeChild(parentCtx, { name: "A" }).catch(e => e);
    expect(err.code).toBe(ErrorCode.WORKFLOW_RECURSION_DETECTED);
  });

  it("rejects indirect recursion", async () => {
    const runtime = createMockRuntime();
    const defA = { name: "A", parsedWorkflow: { body: "", meta: { name: "A" } } };
    const registry = { 
      require: vi.fn().mockReturnValue(defA)
    } as any;
    
    const manager = new DefaultWorkflowInvocationManager({ 
      runtime, 
      registry, 
      evaluate: async () => ({}) 
    });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "id-b",
      workflowName: "B",
      depth: 1,
      ancestry: ["A", "B"],
      signal: new AbortController().signal,
      deadlineAt: Infinity,
      effectiveConcurrency: 1
    } as any;

    const err = await manager.invokeChild(parentCtx, { name: "A" }).catch(e => e);
    expect(err.code).toBe(ErrorCode.WORKFLOW_RECURSION_DETECTED);
    expect(err.message).toContain("A -> B -> A");
  });

  it("enforces max depth", async () => {
    const runtime = createMockRuntime(2);
    const defC = { name: "C", parsedWorkflow: { body: "", meta: { name: "C" } } };
    const registry = { 
      require: vi.fn().mockReturnValue(defC)
    } as any;
    
    const manager = new DefaultWorkflowInvocationManager({ 
      runtime, 
      registry, 
      evaluate: async () => ({}) 
    });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "id-b",
      workflowName: "B",
      depth: 2, // Already at max depth
      ancestry: ["A", "B"],
      signal: new AbortController().signal,
      deadlineAt: Infinity,
      effectiveConcurrency: 1
    } as any;

    const err = await manager.invokeChild(parentCtx, { name: "C" }).catch(e => e);
    expect(err.code).toBe(ErrorCode.WORKFLOW_MAX_DEPTH_EXCEEDED);
  });
});
