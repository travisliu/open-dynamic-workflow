import { describe, it, expect, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { withActiveWorkflowInvocation } from "../../../src/workflow/invocation-types.js";

describe("agent() origin metadata", () => {
  const createMockRuntime = () => ({
    runId: "test-run",
    cwd: "/cwd",
    artifactsDir: "/artifacts",
    config: { defaultProvider: "mock", timeoutMs: 30000, providers: {} },
    agentResults: [],
    agentCounter: 0,
    scheduler: {
      schedule: vi.fn().mockResolvedValue({ ok: true, status: "succeeded" })
    },
    agentExecutor: { execute: vi.fn() },
    eventSink: { emit: vi.fn() },
    abortController: new AbortController()
  } as any);

  it("adds workflow origin metadata to agent tasks", async () => {
    const runtime = createMockRuntime();
    const dsl = createDsl(runtime);
    
    const context = {
      runId: "test-run",
      workflowInvocationId: "child-id",
      parentWorkflowInvocationId: "parent-id",
      workflowName: "ChildFlow",
      depth: 1,
      ancestry: ["ParentFlow", "ChildFlow"],
      args: {},
      signal: new AbortController().signal
    } as any;

    await withActiveWorkflowInvocation(context, async () => {
      await dsl.agent({ prompt: "hello" });
    });

    expect(runtime.scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          workflowInvocationId: "child-id",
          parentWorkflowInvocationId: "parent-id",
          workflowName: "ChildFlow",
          workflowDepth: 1
        })
      }),
      expect.anything()
    );
  });

  it("prevents user metadata from overwriting origin metadata", async () => {
    const runtime = createMockRuntime();
    const dsl = createDsl(runtime);
    
    const context = {
      runId: "test-run",
      workflowInvocationId: "child-id",
      parentWorkflowInvocationId: "parent-id",
      workflowName: "ChildFlow",
      depth: 1,
      args: {},
      signal: new AbortController().signal
    } as any;

    await withActiveWorkflowInvocation(context, async () => {
      await dsl.agent({ 
        prompt: "hello",
        metadata: {
          workflowInvocationId: "evil-id",
          other: "data"
        }
      } as any);
    });

    const task = (runtime.scheduler.schedule as any).mock.calls[0][0];
    expect(task.metadata.workflowInvocationId).toBe("child-id");
    expect(task.metadata.other).toBe("data");
  });
});
