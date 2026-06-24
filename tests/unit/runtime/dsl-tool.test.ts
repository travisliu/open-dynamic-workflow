import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import {
  assertLoopContextToolAllowed,
  withDslExecutionScope,
  withToolForbidden
} from "../../../src/workflow/scope.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import * as callCache from "../../../src/artifacts/call-cache.js";
import { withActiveLoopContext } from "../../../src/loop/context.js";

vi.mock("../../../src/artifacts/call-cache.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    computeToolFingerprint: vi.fn().mockReturnValue("test-fingerprint"),
    findPrefixCacheHit: vi.fn().mockReturnValue(undefined),
    materializeCachedToolResult: vi.fn(),
    recordToolCall: vi.fn(),
    recordAgentCall: vi.fn()
  };
});

describe("DSL tool() runtime", () => {
  let mockRuntime: any;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(callCache.computeToolFingerprint).mockReturnValue("test-fingerprint");
    vi.mocked(callCache.findPrefixCacheHit).mockReturnValue(undefined);
    mockRuntime = {
      runId: "test-run",
      config: { timeoutMs: 30000 },
      abortController: new AbortController(),
      toolCallIds: new Set(),
      toolCounter: 0,
      callSequence: 0,
      agentResults: [],
      toolResults: [],
      toolRegistry: {
        require: vi.fn().mockReturnValue({ 
          definition: { id: "read-json", defaultTimeoutMs: 1000, cacheable: true, run: async () => ({}) },
          validateInput: vi.fn().mockReturnValue({ ok: true, value: {} }),
          sourcePath: "tools/read-json.ts"
        })
      },
      toolExecutor: {
        execute: vi.fn().mockResolvedValue({ ok: true, output: { content: "{}" }, durationMs: 1 }),
        getSummaries: vi.fn().mockReturnValue([]),
        addSummary: vi.fn()
      },
      artifactStore: {},
      callCache: { readEnabled: true, prefixCacheUsable: true, previousRunRoot: "/prev" },
      eventSink: { emit: vi.fn() }
    };
  });

  it("should return cached result on cache hit", async () => {
    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    const mockCachedResult = {
      ok: true,
      status: "succeeded",
      toolCallId: "tool-0001-read-json",
      definitionId: "read-json",
      output: { content: "cached" },
      durationMs: 0,
      artifactPath: "tools/tool-0001-read-json/output.json"
    };

    vi.mocked(callCache.findPrefixCacheHit).mockReturnValue({
      kind: "tool",
      sequence: 1,
      toolCallId: "prev-tool-0001",
      fingerprint: "test-fingerprint",
      status: "succeeded",
      resultPath: "prev/tools/prev-tool-0001/output.json"
    } as any);

    vi.mocked(callCache.materializeCachedToolResult).mockResolvedValue(mockCachedResult as any);

    const result = await withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: { path: "foo.json" } })
    );

    expect(result).toEqual({ content: "cached" });
    expect(callCache.findPrefixCacheHit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "tool",
      sequence: 1
    }));
    expect(callCache.materializeCachedToolResult).toHaveBeenCalled();
    expect(mockRuntime.eventSink.emit).toHaveBeenCalledWith("tool.cache_hit", expect.objectContaining({
      definition: "read-json"
    }));
    expect(mockRuntime.toolExecutor.execute).not.toHaveBeenCalled();
    expect(callCache.recordToolCall).toHaveBeenCalledWith(expect.objectContaining({
      result: mockCachedResult
    }));
  });

  it("should disable prefix cache for non-cacheable tools", async () => {
    mockRuntime.toolRegistry.require.mockReturnValue({ 
      definition: { id: "write-file", defaultTimeoutMs: 1000, cacheable: false, run: async () => ({}) },
      validateInput: vi.fn().mockReturnValue({ ok: true, value: {} }),
      sourcePath: "tools/write-file.ts"
    });

    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    await withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "write-file", args: { path: "foo.json", content: "bar" } })
    );

    expect(mockRuntime.callCache.prefixCacheUsable).toBe(false);
    expect(callCache.findPrefixCacheHit).not.toHaveBeenCalled();
    expect(mockRuntime.callSequence).toBe(0); 
  });

  it("should execute tool successfully in valid context", async () => {
    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    const result = await withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: { path: "foo.json" } })
    );

    expect(result).toEqual({ content: "{}" });
    expect(mockRuntime.toolExecutor.execute).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ definition: expect.objectContaining({ id: "read-json" }) }),
      args: { path: "foo.json" }
    }));
  });

  it("should throw if tool is called in forbidden context", async () => {
    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "parallel-task" as const,
      toolAllowed: false,
      topLevelWindow: false
    };

    await expect(withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: {} })
    )).rejects.toThrow(/tool\(\) is not allowed in parallel task context/);
  });

  it("should throw if tool registry is missing", async () => {
    const runtimeNoRegistry = { ...mockRuntime, toolRegistry: undefined };
    const dsl = createDsl(runtimeNoRegistry as any);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    await expect(withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: {} })
    )).rejects.toThrow(/tool\(\) is not configured for this run/);
  });

  it("should return settled result in settled mode (ISSUE-002)", async () => {
    mockRuntime.toolExecutor.execute.mockResolvedValueOnce({
      status: "failed",
      ok: false,
      error: { code: "ERROR", message: "Failed", error: { name: "TestError", message: "Actual Error" } },
      toolCallId: "tool-0001",
      definitionId: "read-json",
      durationMs: 123,
      startedAt: "2026-06-12T12:00:00Z",
      finishedAt: "2026-06-12T12:00:00.123Z",
      artifactPath: "tools/tool-0001"
    });

    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    const result = (await withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: {}, failureMode: "settled" })
    )) as any;

    expect(result).toEqual({
      status: "failed",
      ok: false,
      toolCallId: "tool-0001",
      definition: "read-json",
      error: { name: "TestError", message: "Actual Error" },
      startedAt: "2026-06-12T12:00:00Z",
      finishedAt: "2026-06-12T12:00:00.123Z",
      durationMs: 123,
      artifactPath: "tools/tool-0001"
    });
  });

  it("should return successful settled result (ISSUE-002)", async () => {
    mockRuntime.toolExecutor.execute.mockResolvedValueOnce({
      status: "succeeded",
      ok: true,
      output: { foo: "bar" },
      toolCallId: "tool-0002",
      definitionId: "read-json",
      durationMs: 456,
      startedAt: "2026-06-12T12:01:00Z",
      finishedAt: "2026-06-12T12:01:00.456Z",
      artifactPath: "tools/tool-0002"
    });

    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    const result = (await withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: {}, failureMode: "settled" })
    )) as any;

    expect(result).toEqual({
      status: "succeeded",
      ok: true,
      toolCallId: "tool-0002",
      definition: "read-json",
      value: { foo: "bar" },
      startedAt: "2026-06-12T12:01:00Z",
      finishedAt: "2026-06-12T12:01:00.456Z",
      durationMs: 456,
      artifactPath: "tools/tool-0002"
    });
  });

  it("should generate unique artifact-safe IDs (Case 36)", async () => {
    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    await withDslExecutionScope(scope, async () => {
      await dsl.tool({ definition: "read-json", args: {} });
      await dsl.tool({ definition: "read-json", args: {} });
    });

    const calls = mockRuntime.toolExecutor.execute.mock.calls;
    expect(calls[0][0].toolCallId).toMatch(/^tool-0001-read-json/);
    expect(calls[1][0].toolCallId).toMatch(/^tool-0002-read-json/);
  });

  it("should preserve forbidden ancestry through child workflow calls (Case 38)", async () => {
    const dsl = createDsl(mockRuntime);
    const parentScope = {
      runId: "test-run",
      workflowInvocationId: "parent",
      location: "parallel-task" as const,
      toolAllowed: false,
      topLevelWindow: false
    };

    await withDslExecutionScope(parentScope, async () => {
      // simulate child workflow call
      const childScope = {
        runId: "test-run",
        workflowInvocationId: "child",
        location: "workflow-top-level" as const,
        toolAllowed: parentScope.toolAllowed, // Inherited
        topLevelWindow: parentScope.toolAllowed // Inherited
      };

      await expect(withDslExecutionScope(childScope, () => 
        dsl.tool({ definition: "read-json", args: {} })
      )).rejects.toThrow(/tool\(\) is not allowed/);
    });
  });

  it("should throw before queueing for missing definition or invalid input (Case 34)", async () => {
    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    mockRuntime.toolRegistry.require.mockImplementationOnce(() => {
      throw new OpenDynamicWorkflowError(ErrorCode.TOOL_DEFINITION_NOT_FOUND as any, "Not found");
    });

    await expect(withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: {} })
    )).rejects.toThrow(/Not found/);

    expect(mockRuntime.toolExecutor.execute).not.toHaveBeenCalled();
  });

  it("should reject tool() call inside an indirect helper if context was forbidden (WS-001)", async () => {
    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };

    const helper = async () => {
       return await dsl.tool({ definition: "read-json", args: { path: "foo.json" } });
    };

    await withDslExecutionScope(scope, async () => {
      // In allowed context, it works
      const result = await helper();
      expect(result).toEqual({ content: "{}" });

      // In forbidden context, it fails at runtime if called
      await expect(withToolForbidden("parallel-task" as any, () => helper())).rejects.toThrow(
        /tool\(\) is not allowed in parallel task context/
      );
    });
  });

  it("should fail with TOOL_INVALID_CONTEXT before serialization error when in forbidden context (ISSUE-001)", async () => {
    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "parallel-task" as const,
      toolAllowed: false,
      topLevelWindow: false
    };

    // BigInt is not JSON serializable, would fail in normalizeToolCallInput (cloneJsonValue)
    await expect(withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: { value: 123n } })
    )).rejects.toThrow(expect.objectContaining({
      code: ErrorCode.TOOL_INVALID_CONTEXT
    }));
  });

  it("should throw if topLevelWindow is false even if toolAllowed is true (ISSUE-001)", async () => {
    const dsl = createDsl(mockRuntime);
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: false // Forbidden runtime call window
    };

    await expect(withDslExecutionScope(scope, () => 
      dsl.tool({ definition: "read-json", args: {} })
    )).rejects.toThrow(/tool\(\) is not allowed/);
  });

  it("allows ctx.tool() only in the direct loop-round runtime scope", () => {
    const loopScope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "loop-round" as const,
      toolAllowed: false,
      topLevelWindow: false
    };
    const callbackScope = {
      ...loopScope,
      location: "asynchronous-callback" as const
    };

    expect(() => withDslExecutionScope(
      loopScope,
      () => assertLoopContextToolAllowed()
    )).not.toThrow();

    expect(() => withDslExecutionScope(
      callbackScope,
      () => assertLoopContextToolAllowed()
    )).toThrow(/ctx\.tool\(\) is not allowed in asynchronous callback context/);
  });

  it("should throw TOOL_INVALID_CONTEXT if loop tool is called in parallel task context", async () => {
    mockRuntime.artifactStore = {
      writeJson: vi.fn().mockResolvedValue("path"),
      getRunArtifacts: vi.fn().mockReturnValue({ rootDir: "/tmp" })
    };
    mockRuntime.loopCounter = 0;
    mockRuntime.loopSummaries = [];
    mockRuntime.config.workflow = { maxLoopRounds: 20 };

    const dsl = createDsl(mockRuntime);

    // Get the loop tool function via a minimal loop invocation
    let loopToolFn: any;
    await dsl.loop({
      label: "get-tool-fn",
      initialState: {},
      options: { maxRounds: 1 },
      run: async (state, loopCtx) => {
        loopToolFn = loopCtx.tool;
        return { done: true, nextState: state };
      }
    });

    expect(loopToolFn).toBeDefined();

    // Establish active loop context and run under parallel-task scope
    const activeLoop = {
      loopId: "test-loop",
      label: "test-loop",
      roundIndex: 0,
      roundNumber: 1,
      roundId: "test-loop:round-1",
      childAgentIds: [],
      childWorkflowInvocationIds: [],
      signal: new AbortController().signal
    };

    const parallelScope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "parallel-task" as const,
      toolAllowed: false,
      topLevelWindow: false
    };

    await withActiveLoopContext(activeLoop, async () => {
      await withDslExecutionScope(parallelScope, async () => {
        await expect(loopToolFn({ definition: "read-json", args: {} })).rejects.toThrow(
          expect.objectContaining({
            code: ErrorCode.TOOL_INVALID_CONTEXT
          })
        );
      });
    });

    expect(mockRuntime.toolExecutor.execute).not.toHaveBeenCalled();
  });
});
