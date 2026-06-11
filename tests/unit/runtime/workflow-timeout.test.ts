import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DefaultWorkflowInvocationManager } from "../../../src/workflow/invocation-manager.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("workflow timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createMockRuntime = () => ({
    runId: "test-run",
    config: { workflow: { maxDepth: 8 } },
    args: {},
    abortController: new AbortController(),
    eventSink: { emit: vi.fn() },
    artifactStore: { writeJson: vi.fn().mockResolvedValue(undefined) }
  } as any);

  it("aborts child when timeout is reached", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = { require: () => childDef } as any;
    
    // Evaluate that waits indefinitely until aborted
    const evaluate = vi.fn().mockImplementation((ctx) => {
      return new Promise((_, reject) => {
        ctx.signal.addEventListener("abort", () => {
          reject(ctx.signal.reason);
        });
      });
    });

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = {
      depth: 0,
      ancestry: ["parent"],
      signal: new AbortController().signal,
      deadlineAt: Infinity,
      effectiveConcurrency: 1
    } as any;

    const promise = manager.invokeChild(parentCtx, { name: "child", timeoutMs: 100 });
    
    await Promise.allSettled([
      promise,
      vi.advanceTimersByTimeAsync(150)
    ]);

    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("inherits parent deadline", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = { require: () => childDef } as any;
    
    const evaluate = vi.fn().mockImplementation((ctx) => {
      return new Promise((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
      });
    });

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const startTime = Date.now();
    const parentCtx = {
      depth: 0,
      ancestry: ["parent"],
      signal: new AbortController().signal,
      deadlineAt: startTime + 50,
      effectiveConcurrency: 1
    } as any;

    const promise = manager.invokeChild(parentCtx, { name: "child" });
    
    await Promise.allSettled([
      promise,
      vi.advanceTimersByTimeAsync(100)
    ]);

    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("enforces timeout even if child evaluator ignores signal", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = { require: () => childDef } as any;
    
    // Evaluator returns a promise that resolves after 1000ms but ignores the signal completely
    const evaluate = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => resolve("succeeded"), 1000);
      });
    });

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = {
      depth: 0,
      ancestry: ["parent"],
      signal: new AbortController().signal,
      deadlineAt: Infinity,
      effectiveConcurrency: 1
    } as any;

    // 1. Assert throwing mode rejects with WORKFLOW_TIMEOUT
    const promise1 = manager.invokeChild(parentCtx, { name: "child", timeoutMs: 100 });
    
    await Promise.allSettled([
      promise1,
      vi.advanceTimersByTimeAsync(150)
    ]);

    await expect(promise1).rejects.toThrow(/timed out/);

    // 2. Assert settled mode resolves with status: "timed_out"
    const promise2 = manager.invokeChild(parentCtx, { name: "child", timeoutMs: 100, failureMode: "settled" });

    await Promise.allSettled([
      promise2,
      vi.advanceTimersByTimeAsync(150)
    ]);

    const result2 = await promise2;
    expect(result2.status).toBe("timed_out");
    expect(result2.output).toBeNull();
  });
});
