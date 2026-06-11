import { describe, it, expect, vi } from "vitest";
import { DefaultWorkflowInvocationManager } from "../../../src/workflow/invocation-manager.js";
import { OpenFlowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("WorkflowInvocationManager", () => {
  const createMockRuntime = () => ({
    runId: "test-run",
    config: { workflow: { maxDepth: 2 } },
    args: {},
    abortController: new AbortController(),
    eventSink: { emit: vi.fn() },
    idGenerator: { nextId: (p: string) => `${p}-1` },
    artifactStore: { writeJson: vi.fn().mockResolvedValue(undefined) }
  } as any);

  const createMockRegistry = (definitions: Record<string, any>) => ({
    require: vi.fn((name: string) => {
      if (!definitions[name]) throw new OpenFlowError(ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND, "Not found");
      return definitions[name];
    })
  } as any);

  it("executes root workflow", async () => {
    const runtime = createMockRuntime();
    const definition = { name: "root", parsedWorkflow: { body: "", meta: { name: "root" } } };
    const registry = createMockRegistry({ root: definition });
    const evaluate = vi.fn().mockResolvedValue("root-result");

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    const result = await manager.executeRoot(definition, { input: "test" });

    expect(result).toBe("root-result");
    expect(evaluate).toHaveBeenCalled();
    expect(runtime.eventSink.emit).toHaveBeenCalledWith("workflow.invocation.started", expect.objectContaining({
      workflowName: "root"
    }));
  });

  it("invokes child workflow successfully", async () => {
    const runtime = createMockRuntime();
    const parentDef = { name: "parent", parsedWorkflow: { body: "", meta: { name: "parent" } } };
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    const evaluate = vi.fn().mockImplementation(async (ctx) => {
      if (ctx.workflowName === "child") return "child-result";
      return "parent-result";
    });

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "root",
      workflowName: "parent",
      definition: parentDef,
      depth: 0,
      ancestry: ["parent"],
      args: {},
      startedAt: new Date().toISOString(),
      deadlineAt: Infinity,
      signal: runtime.abortController.signal,
      abortController: runtime.abortController
    } as any;

    const result = await manager.invokeChild(parentCtx, { name: "child", args: { x: 1 } });

    expect(result).toBe("child-result");
    expect(runtime.eventSink.emit).toHaveBeenCalledWith("workflow.invocation.started", expect.objectContaining({
      workflowName: "child",
      parentWorkflowInvocationId: "root"
    }));
  });

  it("validates child input schema", async () => {
    const runtime = createMockRuntime();
    const childDef = { 
      name: "child", 
      parsedWorkflow: { body: "", meta: { name: "child" } },
      inputSchema: {
        type: "object",
        properties: {
          age: { type: "number", minimum: 18 }
        },
        required: ["age"]
      }
    };
    const registry = createMockRegistry({ child: childDef });
    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate: vi.fn() });
    
    const parentCtx = { depth: 0, ancestry: ["parent"], signal: new AbortController().signal, deadlineAt: Infinity } as any;

    await expect(manager.invokeChild(parentCtx, { name: "child", args: { age: 10 } }))
      .rejects.toThrow(/Input validation failed/);
  });

  it("enforces max depth", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate: vi.fn() });
    
    const parentCtx = { depth: 2, ancestry: ["a", "b", "c"], signal: new AbortController().signal, deadlineAt: Infinity } as any;

    await expect(manager.invokeChild(parentCtx, { name: "child", args: {} }))
      .rejects.toThrow(/Maximum workflow depth/);
  });

  it("detects recursion", async () => {
    const runtime = createMockRuntime();
    const registry = createMockRegistry({ 
      parent: { name: "parent", parsedWorkflow: { body: "", meta: { name: "parent" } } }
    });
    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate: vi.fn() });
    
    const parentCtx = { depth: 0, ancestry: ["parent"], signal: new AbortController().signal, deadlineAt: Infinity } as any;

    await expect(manager.invokeChild(parentCtx, { name: "parent", args: {} }))
      .rejects.toThrow(/Active recursion detected/);
  });

  it("handles settled failure mode", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    const evaluate = vi.fn().mockRejectedValue(new Error("child failed"));

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "root",
      workflowName: "parent",
      depth: 0,
      ancestry: ["parent"],
      args: {},
      startedAt: new Date().toISOString(),
      deadlineAt: Infinity,
      signal: runtime.abortController.signal,
      abortController: runtime.abortController
    } as any;

    const result = await manager.invokeChild(parentCtx, { 
      name: "child", 
      args: {}, 
      failureMode: "settled" 
    }) as any;

    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(result.error.message).toBe("child failed");
  });

  it("handles settled failure mode with timeout status", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    const timeoutError = new OpenFlowError(ErrorCode.WORKFLOW_TIMEOUT, "Workflow timed out.");
    const evaluate = vi.fn().mockRejectedValue(timeoutError);

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "root",
      workflowName: "parent",
      depth: 0,
      ancestry: ["parent"],
      args: {},
      startedAt: new Date().toISOString(),
      deadlineAt: Infinity,
      signal: runtime.abortController.signal,
      abortController: runtime.abortController
    } as any;

    const result = await manager.invokeChild(parentCtx, { 
      name: "child", 
      args: {}, 
      failureMode: "settled" 
    }) as any;

    expect(result.status).toBe("timed_out");
    expect(result.output).toBeNull();
    expect(result.error.code).toBe(ErrorCode.WORKFLOW_TIMEOUT);
    expect(result.error.message).toBe("Workflow timed out.");

    expect(runtime.artifactStore.writeJson).toHaveBeenCalled();
    expect(runtime.eventSink.emit).toHaveBeenCalledWith("workflow.invocation.timed_out", expect.objectContaining({
      workflowName: "child",
      status: "timed_out",
      error: expect.objectContaining({
        code: ErrorCode.WORKFLOW_TIMEOUT
      })
    }));
  });

  it("handles settled failure mode with parent cancellation", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    
    const parentAbortController = new AbortController();
    
    const evaluate = vi.fn().mockImplementation(async (ctx) => {
      if (ctx.signal.aborted) {
        throw ctx.signal.reason;
      }
      const abortError = new OpenFlowError(ErrorCode.WORKFLOW_CANCELLED, "parent cancelled");
      parentAbortController.abort(abortError);
      throw ctx.signal.reason || abortError;
    });

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "root",
      workflowName: "parent",
      depth: 0,
      ancestry: ["parent"],
      args: {},
      startedAt: new Date().toISOString(),
      deadlineAt: Infinity,
      signal: parentAbortController.signal,
      abortController: parentAbortController
    } as any;

    await expect(
      manager.invokeChild(parentCtx, { 
        name: "child", 
        args: {}, 
        failureMode: "settled" 
      })
    ).rejects.toThrow("parent cancelled");
  });

  it("aborts child immediately if parent is already aborted without looking up definition", async () => {
    const runtime = createMockRuntime();
    const registry = createMockRegistry({}); // Empty registry
    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate: vi.fn() });
    
    const abortController = new AbortController();
    const abortError = new OpenFlowError(ErrorCode.WORKFLOW_CANCELLED, "Pre-aborted");
    abortController.abort(abortError);
    
    const parentCtx = { 
      depth: 0, 
      ancestry: ["parent"], 
      signal: abortController.signal, 
      deadlineAt: Infinity,
      workflowInvocationId: "parent-id"
    } as any;

    await expect(manager.invokeChild(parentCtx, { name: "non-existent", args: {} }))
      .rejects.toThrow("Pre-aborted");
      
    expect(registry.require).not.toHaveBeenCalled();
    expect(runtime.eventSink.emit).not.toHaveBeenCalledWith("workflow.invocation.started", expect.any(Object));
  });

  it("settled mode handles pre-execution definition not found", async () => {
    const runtime = createMockRuntime();
    const registry = createMockRegistry({}); // Empty registry (will throw definition not found)
    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate: vi.fn() });
    
    const parentCtx = { depth: 0, ancestry: ["parent"], signal: new AbortController().signal, deadlineAt: Infinity } as any;

    const result = await manager.invokeChild(parentCtx, { 
      name: "non-existent", 
      args: {}, 
      failureMode: "settled" 
    }) as any;

    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(result.error.code).toBe(ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND);
  });

  it("settled mode handles pre-execution max depth", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate: vi.fn() });
    
    const parentCtx = { depth: 2, ancestry: ["a", "b", "c"], signal: new AbortController().signal, deadlineAt: Infinity } as any;

    const result = await manager.invokeChild(parentCtx, { 
      name: "child", 
      args: {}, 
      failureMode: "settled" 
    }) as any;

    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(result.error.code).toBe(ErrorCode.WORKFLOW_MAX_DEPTH_EXCEEDED);
  });

  it("settled mode handles pre-execution recursion", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate: vi.fn() });
    
    const parentCtx = { depth: 0, ancestry: ["child"], signal: new AbortController().signal, deadlineAt: Infinity } as any;

    const result = await manager.invokeChild(parentCtx, { 
      name: "child", 
      args: {}, 
      failureMode: "settled" 
    }) as any;

    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(result.error.code).toBe(ErrorCode.WORKFLOW_RECURSION_DETECTED);
  });

  it("settled mode handles pre-execution input schema validation failure", async () => {
    const runtime = createMockRuntime();
    const childDef = { 
      name: "child", 
      parsedWorkflow: { body: "", meta: { name: "child" } },
      inputSchema: {
        type: "object",
        properties: { age: { type: "number" } },
        required: ["age"]
      }
    };
    const registry = createMockRegistry({ child: childDef });
    const evaluate = vi.fn();
    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = { depth: 0, ancestry: ["parent"], signal: new AbortController().signal, deadlineAt: Infinity } as any;

    const result = await manager.invokeChild(parentCtx, { 
      name: "child", 
      args: { age: "not-a-number" }, 
      failureMode: "settled" 
    }) as any;

    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(result.error.code).toBe(ErrorCode.WORKFLOW_INPUT_VALIDATION_FAILED);
    
    expect(evaluate).not.toHaveBeenCalled();
    expect(runtime.eventSink.emit).not.toHaveBeenCalledWith("workflow.invocation.started", expect.any(Object));
  });

  it("redacts sensitive keys from event metadata in emitStarted", async () => {
    const runtime = createMockRuntime();
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    const evaluate = vi.fn().mockResolvedValue("result");

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "root",
      workflowName: "parent",
      depth: 0,
      ancestry: ["parent"],
      args: {},
      startedAt: new Date().toISOString(),
      deadlineAt: Infinity,
      signal: runtime.abortController.signal,
      abortController: runtime.abortController
    } as any;

    await manager.invokeChild(parentCtx, {
      name: "child",
      args: {},
      metadata: { token: "abc", apiKey: "secret", sharedAgentId: "safe-id" }
    });

    expect(runtime.eventSink.emit).toHaveBeenCalledWith(
      "workflow.invocation.started",
      expect.objectContaining({
        metadata: {
          sharedAgentId: "safe-id"
        }
      })
    );
    
    const emitCall = runtime.eventSink.emit.mock.calls.find((call: any) => call[0] === "workflow.invocation.started");
    const payload = emitCall[1];
    expect(payload.metadata.token).toBeUndefined();
    expect(payload.metadata.apiKey).toBeUndefined();
  });

  it("clamps child concurrency to parent effectiveConcurrency", async () => {
    const runtime = createMockRuntime();
    runtime.schedulerConcurrency = 2;
    const parentDef = { name: "parent", parsedWorkflow: { body: "", meta: { name: "parent" } } };
    const childDef = { name: "child", parsedWorkflow: { body: "", meta: { name: "child" } } };
    const registry = createMockRegistry({ child: childDef });
    
    let childCtxObserved: any = null;
    const evaluate = vi.fn().mockImplementation(async (ctx) => {
      if (ctx.workflowName === "child") {
        childCtxObserved = ctx;
        return "child-result";
      }
      return "parent-result";
    });

    const manager = new DefaultWorkflowInvocationManager({ runtime, registry, evaluate });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "root",
      workflowName: "parent",
      definition: parentDef,
      depth: 0,
      ancestry: ["parent"],
      args: {},
      startedAt: new Date().toISOString(),
      deadlineAt: Infinity,
      signal: runtime.abortController.signal,
      abortController: runtime.abortController,
      effectiveConcurrency: 2
    } as any;

    await manager.invokeChild(parentCtx, { name: "child", args: {}, concurrency: 8 });

    expect(childCtxObserved).not.toBeNull();
    expect(childCtxObserved.effectiveConcurrency).toBe(2);
  });
});
