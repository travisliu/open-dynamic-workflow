import { describe, expect, it, vi, beforeEach } from "vitest";
import { DefaultToolExecutor } from "../../../src/tools/executor.js";
import type { RegisteredToolDefinition } from "../../../src/types/tool.js";
import type { PreparedToolCall, ToolExecutorDependencies } from "../../../src/tools/executor-types.js";
import { TOOL_DEFINITION_MARKER } from "../../../src/types/tool.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenFlowError } from "../../../src/errors/types.js";

describe("DefaultToolExecutor", () => {
  let deps: ToolExecutorDependencies;
  let mockEventSink: any;
  let mockArtifactStore: any;
  let mockRunArtifacts: any;

  beforeEach(() => {
    mockEventSink = {
      emit: vi.fn()
    };
    mockArtifactStore = {
      writeJson: vi.fn().mockResolvedValue("path/to/json"),
      writeText: vi.fn().mockResolvedValue("path/to/text")
    };
    mockRunArtifacts = {
      toolDir: vi.fn((id) => `/root/runs/tools/${id}`)
    };

    deps = {
      concurrency: 2,
      eventSink: mockEventSink,
      artifactStore: mockArtifactStore,
      runArtifacts: mockRunArtifacts,
      runId: "test-run",
      cwd: "/test",
      rootSignal: new AbortController().signal
    };
  });

  const createDefinition = (id: string, run: any): RegisteredToolDefinition => ({
    definition: {
      id,
      description: "test tool",
      inputSchema: {},
      run,
      [TOOL_DEFINITION_MARKER]: true
    } as any,
    sourcePath: "/test/tool.ts",
    validateInput: (data) => ({ ok: true, value: data }),
    validateOutput: (data) => ({ ok: true, value: data })
  });

  it("executes a successful tool call", async () => {
    const run = vi.fn().mockResolvedValue({ foo: "bar" });
    const definition = createDefinition("echo", run);
    const executor = new DefaultToolExecutor(deps);

    const call: PreparedToolCall = {
      toolCallId: "call-1",
      definition,
      args: { input: "test" },
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-1",
      invocationSignal: new AbortController().signal
    };

    const result = await executor.execute(call);

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ foo: "bar" });
    expect(run).toHaveBeenCalled();
    
    // Check events
    expect(mockEventSink.emit).toHaveBeenCalledWith("tool.queued", expect.any(Object));
    expect(mockEventSink.emit).toHaveBeenCalledWith("tool.started", expect.any(Object));
    expect(mockEventSink.emit).toHaveBeenCalledWith("tool.completed", expect.any(Object));

    // Check artifacts
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("tools/call-1/input.json", call.args);
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("tools/call-1/output.json", { foo: "bar" });
    
    // Check metadata contract in artifacts
    const metadataCall = mockArtifactStore.writeJson.mock.calls.find((c: any) => c[0].endsWith("metadata.json"));
    expect(metadataCall[1]).toEqual(expect.objectContaining({
      schemaVersion: "openflow.tool.v1",
      toolCallId: "call-1",
      definition: "echo",
      status: "succeeded",
      workflowInvocationId: "wf-1"
    }));
  });

  it("handles tool execution failure", async () => {
    const run = vi.fn().mockRejectedValue(new Error("tool failed"));
    const definition = createDefinition("fail", run);
    const executor = new DefaultToolExecutor(deps);

    const call: PreparedToolCall = {
      toolCallId: "call-2",
      definition,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-2",
      invocationSignal: new AbortController().signal
    };

    const result = await executor.execute(call);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe("tool failed");
    expect(mockEventSink.emit).toHaveBeenCalledWith("tool.failed", expect.any(Object));
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("tools/call-2/error.json", expect.any(Object));
  });

  it("enforces concurrency limits", async () => {
    deps.concurrency = 1;
    let active = 0;
    let maxActive = 0;

    const run = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 20));
      active--;
      return "ok";
    };

    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("delayed", run);

    const call1: PreparedToolCall = {
      toolCallId: "call-1",
      definition: def,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-1",
      invocationSignal: new AbortController().signal
    };

    const call2: PreparedToolCall = {
      toolCallId: "call-2",
      definition: def,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-2",
      invocationSignal: new AbortController().signal
    };

    await Promise.all([
      executor.execute(call1),
      executor.execute(call2)
    ]);

    expect(maxActive).toBe(1);
  });

  it("handles timeout", async () => {
    const run = async (args: any, context: any) => {
      await new Promise((resolve, reject) => {
        if (context.signal.aborted) {
          reject(context.signal.reason);
          return;
        }
        const timeout = setTimeout(resolve, 100);
        context.signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(context.signal.reason);
        });
      });
      return "ok";
    };

    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("timeout", run);

    const call: PreparedToolCall = {
      toolCallId: "call-timeout",
      definition: def,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-timeout",
      timeoutMs: 10,
      invocationSignal: new AbortController().signal
    };

    const result = await executor.execute(call);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.PROCESS_TIMEOUT);
    expect(mockEventSink.emit).toHaveBeenCalledWith("tool.timed_out", expect.any(Object));
  });

  it("cancels running calls", async () => {
    const run = async (args: any, context: any) => {
      await new Promise((resolve, reject) => {
        if (context.signal.aborted) {
          reject(context.signal.reason);
          return;
        }
        context.signal.addEventListener("abort", () => {
          reject(context.signal.reason);
        });
      });
      return "ok";
    };

    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("cancel", run);

    const call: PreparedToolCall = {
      toolCallId: "call-cancel",
      definition: def,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-cancel",
      invocationSignal: new AbortController().signal
    };

    const execPromise = executor.execute(call);
    // Give it a tiny bit of time to start
    await new Promise(r => setTimeout(r, 10));
    
    executor.cancel({ name: "Cancel", message: "User cancelled", code: "USER_CANCELLED" });

    const result = await execPromise;
    expect(result.ok).toBe(false);
    expect(mockEventSink.emit).toHaveBeenCalledWith("tool.cancelled", expect.any(Object));
  });

  it("validates output schema", async () => {
    const run = vi.fn().mockResolvedValue({ invalid: "output" });
    const definition = createDefinition("validate", run);
    (definition as any).validateOutput = vi.fn().mockReturnValue({
      ok: false,
      errors: [{ path: "root", message: "invalid" }]
    });

    const executor = new DefaultToolExecutor(deps);

    const call: PreparedToolCall = {
      toolCallId: "call-val",
      definition,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-val",
      invocationSignal: new AbortController().signal
    };

    const result = await executor.execute(call);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.TOOL_INVALID_OUTPUT);
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("tools/call-val/invalid-output.json", expect.any(Object));
  });

  it("respects deadline", async () => {
    const run = async (args: any, context: any) => {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 100);
        context.signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(context.signal.reason);
        });
      });
      return "ok";
    };

    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("deadline", run);

    const call: PreparedToolCall = {
      toolCallId: "call-deadline",
      definition: def,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-deadline",
      deadline: Date.now() + 10,
      invocationSignal: new AbortController().signal
    };

    const result = await executor.execute(call);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.PROCESS_TIMEOUT);
  });

  it("responds to rootSignal abortion", async () => {
    const rootController = new AbortController();
    deps.rootSignal = rootController.signal;
    
    const run = async (args: any, context: any) => {
      await new Promise((resolve, reject) => {
        context.signal.addEventListener("abort", () => {
          reject(context.signal.reason);
        });
      });
    };

    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("root-abort", run);

    const call: PreparedToolCall = {
      toolCallId: "call-root-abort",
      definition: def,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-root-abort",
      invocationSignal: new AbortController().signal
    };

    const execPromise = executor.execute(call);
    rootController.abort();

    const result = await execPromise;
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.USER_CANCELLED);
  });

  it("cancels queued calls before start without invoking run (Case 43)", async () => {
    deps.concurrency = 1;
    const run1 = vi.fn().mockReturnValue(new Promise(() => {})); // blocks forever
    const run2 = vi.fn().mockResolvedValue("ok");
    
    const executor = new DefaultToolExecutor(deps);
    
    const call1 = { ...createPreparedCall("call-1", createDefinition("d1", run1)) };
    const call2 = { ...createPreparedCall("call-2", createDefinition("d2", run2)) };
    const controller2 = new AbortController();
    call2.invocationSignal = controller2.signal;

    executor.execute(call1); // occupies the slot
    const exec2Promise = executor.execute(call2); // queued

    controller2.abort();
    const result2 = await exec2Promise;

    expect(result2.ok).toBe(false);
    expect(result2.status).toBe("cancelled");
    expect(run2).not.toHaveBeenCalled();
  });

  it("rejects non-serializable inputs, outputs, and metadata (Case 46)", async () => {
    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("serial", (input: any) => ({ BigInt: 123n }));
    
    // Non-serializable input
    const call = createPreparedCall("call-serial", def);
    call.args = { func: () => {} };

    const result = await executor.execute(call);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.TOOL_SERIALIZATION_FAILED);
  });

  it("maps artifact write failures to tool artifact errors (Case 47)", async () => {
    mockArtifactStore.writeJson.mockRejectedValue(new Error("Disk full"));
    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("write-fail", (input: any) => "ok");
    const call = createPreparedCall("call-write-fail", def);

    const result = await executor.execute(call);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.TOOL_ARTIFACT_WRITE_FAILED);
  });

  it("rejects args containing BigInt, Symbol, or function, and circular references (Issue 3)", async () => {
    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("args-fail", () => "ok");

    // BigInt
    const callBigInt = createPreparedCall("call-bigint", def);
    callBigInt.args = { big: 123n };
    const resBigInt = await executor.execute(callBigInt);
    expect(resBigInt.ok).toBe(false);
    expect(resBigInt.error?.code).toBe(ErrorCode.TOOL_SERIALIZATION_FAILED);
    expect(mockEventSink.emit).not.toHaveBeenCalledWith("tool.queued", expect.any(Object));

    // Symbol
    const callSymbol = createPreparedCall("call-symbol", def);
    callSymbol.args = { sym: Symbol("foo") };
    const resSymbol = await executor.execute(callSymbol);
    expect(resSymbol.ok).toBe(false);
    expect(resSymbol.error?.code).toBe(ErrorCode.TOOL_SERIALIZATION_FAILED);

    // Circular
    const circularObj: any = {};
    circularObj.self = circularObj;
    const callCircular = createPreparedCall("call-circular", def);
    callCircular.args = circularObj;
    const resCircular = await executor.execute(callCircular);
    expect(resCircular.ok).toBe(false);
    expect(resCircular.error?.code).toBe(ErrorCode.TOOL_SERIALIZATION_FAILED);
  });

  it("handles tool output containing BigInt and fails deterministically (Issue 3)", async () => {
    const run = vi.fn().mockResolvedValue({ big: 123n });
    const def = createDefinition("output-bigint", run);
    const executor = new DefaultToolExecutor(deps);
    const call = createPreparedCall("call-output-bigint", def);

    const result = await executor.execute(call);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.TOOL_SERIALIZATION_FAILED);
  });

  it("ensures writeToolError failure rejects execution instead of swallowing (Issue 3)", async () => {
    // Mock run to fail so that writeToolError is invoked
    const run = vi.fn().mockRejectedValue(new Error("run failed"));
    const def = createDefinition("err-fail", run);
    const executor = new DefaultToolExecutor(deps);
    const call = createPreparedCall("call-err-fail", def);

    // Let the first write of input and metadata succeed, but writeToolError fail
    mockArtifactStore.writeJson.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("error.json")) {
        throw new Error("Disk full on error log");
      }
      return "mock-path";
    });

    await expect(executor.execute(call)).rejects.toThrow(/Failed to write failure artifacts/);
    expect(mockEventSink.emit).not.toHaveBeenCalledWith("tool.failed", expect.any(Object));
  });

  it("returns promptly on timeout even if tool is non-cooperative (ISSUE-001)", async () => {
    let runFinished = false;
    const run = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      runFinished = true;
      return "late result";
    };

    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("non-cooperative", run);

    const call = createPreparedCall("call-timeout-non-coop", def);
    call.timeoutMs = 50;

    const result = await executor.execute(call);

    expect(result.status).toBe("timed_out");
    expect(runFinished).toBe(false);

    // Wait for the tool to eventually finish (to avoid floating promises in tests)
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(runFinished).toBe(true);
    
    // Check events: should only have timed_out, no completed
    const completedEvents = mockEventSink.emit.mock.calls.filter(c => c[0] === "tool.completed");
    const timedOutEvents = mockEventSink.emit.mock.calls.filter(c => c[0] === "tool.timed_out");
    
    expect(timedOutEvents.length).toBe(1);
    expect(completedEvents.length).toBe(0);
  });

  it("returns promptly on cancellation even if tool is non-cooperative (ISSUE-001)", async () => {
    let runFinished = false;
    const run = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      runFinished = true;
      return "late result";
    };

    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("non-cooperative-cancel", run);

    const call = createPreparedCall("call-cancel-non-coop", def);
    const controller = new AbortController();
    call.invocationSignal = controller.signal;

    const execPromise = executor.execute(call);
    
    // Trigger cancellation after start
    await new Promise(resolve => setTimeout(resolve, 50));
    controller.abort();

    const result = await execPromise;

    expect(result.status).toBe("cancelled");
    expect(runFinished).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 600));
    expect(runFinished).toBe(true);
    
    const completedEvents = mockEventSink.emit.mock.calls.filter(c => c[0] === "tool.completed");
    const cancelledEvents = mockEventSink.emit.mock.calls.filter(c => c[0] === "tool.cancelled");
    
    expect(cancelledEvents.length).toBe(1);
    expect(completedEvents.length).toBe(0);
  });

  it("classifies WORKFLOW_TIMEOUT as timed_out (ISSUE-001)", async () => {
    const run = async (args: any, context: any) => {
      await new Promise((_, reject) => {
        context.signal.addEventListener("abort", () => {
          reject(context.signal.reason);
        });
      });
    };

    const executor = new DefaultToolExecutor(deps);
    const def = createDefinition("timeout-workflow", run);

    const controller = new AbortController();
    const call: PreparedToolCall = {
      toolCallId: "call-wf-timeout",
      definition: def,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-wf-timeout",
      invocationSignal: controller.signal
    };

    const execPromise = executor.execute(call);
    
    // Simulate workflow timeout
    const abortReason = new OpenFlowError(ErrorCode.WORKFLOW_TIMEOUT, "Workflow timed out");
    controller.abort(abortReason);

    const result = await execPromise;

    expect(result.status).toBe("timed_out");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.WORKFLOW_TIMEOUT);
    
    expect(mockEventSink.emit).toHaveBeenCalledWith("tool.timed_out", expect.objectContaining({
      status: "timed_out",
      error: expect.objectContaining({
        code: ErrorCode.WORKFLOW_TIMEOUT
      })
    }));
  });

  it("redacts secrets in tool artifacts and events (ISSUE-002)", async () => {
    deps.redactedSecrets = ["secret-token-1234"];
    const run = vi.fn().mockResolvedValue({ output: "here is the secret-token-1234 value" });
    const definition = createDefinition("redactor", run);
    const executor = new DefaultToolExecutor(deps);

    const call: PreparedToolCall = {
      toolCallId: "call-redact",
      definition,
      args: { input: "my secret-token-1234 is here" },
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-redact",
      invocationSignal: new AbortController().signal,
      metadata: { note: "secret-token-1234" }
    };

    const result = await executor.execute(call);

    expect(result.ok).toBe(true);
    // Direct return value should NOT be redacted
    expect(result.output).toEqual({ output: "here is the secret-token-1234 value" });

    // Check artifacts - SHOULD be redacted
    const writeJsonCalls = mockArtifactStore.writeJson.mock.calls;
    
    const inputCall = writeJsonCalls.find((c: any) => c[0].endsWith("input.json"));
    expect(inputCall[1].input).toBe("my [REDACTED] is here");

    const outputCall = writeJsonCalls.find((c: any) => c[0].endsWith("output.json"));
    expect(outputCall[1].output).toBe("here is the [REDACTED] value");

    const metadataCalls = writeJsonCalls.filter((c: any) => c[0].endsWith("metadata.json"));
    metadataCalls.forEach((c: any) => {
      expect(c[1].metadata.note).toBe("[REDACTED]");
    });

    // Check events - SHOULD be redacted
    const completedEvent = mockEventSink.emit.mock.calls.find((c: any) => c[0] === "tool.completed");
    expect(completedEvent[1].outputPreview.output).toBe("here is the [REDACTED] value");
    expect(completedEvent[1].metadata.metadata.note).toBe("[REDACTED]");
  });

  it("redacts secrets in tool log messages (ISSUE-002)", async () => {
    deps.redactedSecrets = ["secret-token-1234"];
    const run = async (args: any, context: any) => {
      context.log("log with secret-token-1234", { data: "secret-token-1234" });
      return "ok";
    };
    const definition = createDefinition("logger", run);
    const executor = new DefaultToolExecutor(deps);

    const call: PreparedToolCall = {
      toolCallId: "call-log-redact",
      definition,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-log-redact",
      invocationSignal: new AbortController().signal
    };

    await executor.execute(call);

    const logEvent = mockEventSink.emit.mock.calls.find((c: any) => c[0] === "workflow.log");
    expect(logEvent[1].message).toContain("[REDACTED]");
    expect(logEvent[1].data.data).toBe("[REDACTED]");
  });

  it("bounds large tool outputs in artifacts and events (ISSUE-002)", async () => {
    const largeValue = "A".repeat(20000);
    const run = vi.fn().mockResolvedValue({ large: largeValue });
    const definition = createDefinition("bounder", run);
    const executor = new DefaultToolExecutor(deps);

    const call: PreparedToolCall = {
      toolCallId: "call-bound",
      definition,
      args: {},
      failureMode: "throw",
      workflowInvocationId: "wf-1",
      queuedAt: new Date().toISOString(),
      artifactPath: "tools/call-bound",
      invocationSignal: new AbortController().signal
    };

    const result = await executor.execute(call);
    expect(result.ok).toBe(true);
    // Direct output is NOT truncated
    expect(result.output.large.length).toBe(20000);

    // Artifact output SHOULD be truncated
    const outputCall = mockArtifactStore.writeJson.mock.calls.find((c: any) => c[0].endsWith("output.json"));
    expect(outputCall[1].large.length).toBeLessThan(20000);
    expect(outputCall[1].large).toContain("[TRUNCATED]");

    // Preview SHOULD be even smaller
    const completedEvent = mockEventSink.emit.mock.calls.find((c: any) => c[0] === "tool.completed");
    expect(completedEvent[1].outputPreview.large.length).toBeLessThan(1100);
    expect(completedEvent[1].outputPreview.large).toContain("[TRUNCATED]");
  });
});

function createPreparedCall(id: string, definition: RegisteredToolDefinition): PreparedToolCall {
  return {
    toolCallId: id,
    definition,
    args: {},
    failureMode: "throw",
    workflowInvocationId: "wf-1",
    queuedAt: new Date().toISOString(),
    artifactPath: `tools/${id}`,
    invocationSignal: new AbortController().signal
  };
}
