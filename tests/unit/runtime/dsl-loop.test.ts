import { describe, expect, it, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { runLoop } from "../../../src/loop/run.js";
import { withActiveLoopContext } from "../../../src/loop/context.js";
import { withActiveWorkflowInvocation } from "../../../src/workflow/invocation-types.js";

vi.mock("../../../src/loop/run.js", () => ({
  runLoop: vi.fn()
}));

describe("DSL loop()", () => {
  it("calls runLoop with correct arguments", async () => {
    const runtime = {
      agentCounter: 0,
      agentResults: [],
      toolResults: [],
      abortController: new AbortController(),
      config: { workflow: { maxLoopRounds: 20 } },
      eventSink: { emit: vi.fn() }
    } as any;

    const dsl = createDsl(runtime);
    const loopInput = {
      label: "test-loop",
      initialState: { count: 0 },
      options: { maxRounds: 5 },
      run: async (state: any) => ({ done: true, nextState: state })
    };

    await dsl.loop(loopInput);

    expect(runLoop).toHaveBeenCalledWith(expect.objectContaining({
      loopInput,
      runtime,
      signal: runtime.abortController.signal,
      dsl: expect.objectContaining({
        agent: expect.any(Function),
        workflow: expect.any(Function),
        tool: expect.any(Function),
        log: expect.any(Function)
      })
    }));

    // Assert that the exact loopInput object is forwarded unchanged
    const callArgs = vi.mocked(runLoop).mock.calls[0]![0];
    expect(callArgs.loopInput).toBe(loopInput);

    // Assert it does not expect a parallel helper in the loop runtime DSL object
    expect(callArgs.dsl).not.toHaveProperty("parallel");
  });

  describe("agent ID scoping in active loops", () => {
    const makeFakeEventSink = () => ({
      emit: vi.fn(),
    });

    const makeSuccessResult = (id: string) => ({
      ok: true,
      status: "succeeded",
      id,
      provider: "mock",
      stdout: "result",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" }
    });

    const makeSchedulerWithResult = (result: any) => ({
      schedule: vi.fn().mockResolvedValue(result),
      drain: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        aborted: false,
        abortReason: undefined,
        runningCount: 0,
        queuedCount: 0,
        completedCount: 1
      })
    });

    const makeRuntimeState = (overrides: any = {}) => {
      const parsedWorkflow = {
        meta: { name: "test", description: "test" },
        body: "",
        sourcePath: "test.js",
        sourceText: "",
        sourceHash: "abc123"
      };

      const config = {
        defaultProvider: "mock",
        concurrency: 1,
        timeoutMs: 30000,
        providers: {},
        security: { allowWorkflowImports: false, passEnv: [], redactEnv: [] },
        reporting: { mode: "pretty", verbose: false },
        cwd: "/workspace",
        outDir: "/workspace/.open-dynamic-workflow/runs",
        cliArgs: {}
      };

      return {
        runId: "run-test-1",
        parsedWorkflow,
        config,
        args: {},
        cwd: "/workspace",
        artifactsDir: "/workspace/.open-dynamic-workflow/runs/run-test-1",
        agentResults: [],
        scheduler: makeSchedulerWithResult(makeSuccessResult("agent-1")) as any,
        agentExecutor: { execute: vi.fn() },
        eventSink: makeFakeEventSink() as any,
        abortController: new AbortController(),
        agentCounter: 0,
        ...overrides
      };
    };

    it("preserves direct loop explicit ID behavior (reaches scheduler as input.id)", async () => {
      const scheduler = makeSchedulerWithResult(makeSuccessResult("my-agent"));
      const runtime = makeRuntimeState({ scheduler });
      const dsl = createDsl(runtime);

      const loopCtx = {
        loopId: "loop-1",
        label: "test-loop",
        roundIndex: 0,
        roundNumber: 1,
        roundId: "round-1",
        childAgentIds: [],
        childWorkflowInvocationIds: [],
        signal: new AbortController().signal,
        workflowInvocationId: "workflow-invocation-1"
      };

      const wfCtx: any = {
        runId: "run-test-1",
        workflowInvocationId: "workflow-invocation-1",
        workflowName: "test-workflow",
        depth: 0,
        ancestry: ["test-workflow"],
        args: {},
        startedAt: "2026-06-19T00:00:00Z",
        signal: new AbortController().signal,
        abortController: new AbortController()
      };

      await withActiveLoopContext(loopCtx, async () => {
        await withActiveWorkflowInvocation(wfCtx, async () => {
          await dsl.agent({ id: "my-agent", prompt: "hello" });
        });
      });

      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      const scheduledTask = scheduler.schedule.mock.calls[0]![0];
      expect(scheduledTask.id).toBe("my-agent");
      expect(loopCtx.childAgentIds).toContain("my-agent");
    });

    it("scopes child workflow explicit ID", async () => {
      const scheduler = makeSchedulerWithResult(makeSuccessResult("test-loop:round-1:nested-child-agent"));
      const runtime = makeRuntimeState({ scheduler });
      const dsl = createDsl(runtime);

      const loopCtx = {
        loopId: "loop-1",
        label: "test-loop",
        roundIndex: 0,
        roundNumber: 1,
        roundId: "round-1",
        childAgentIds: [],
        childWorkflowInvocationIds: [],
        signal: new AbortController().signal,
        workflowInvocationId: "workflow-invocation-1"
      };

      const wfCtx: any = {
        runId: "run-test-1",
        workflowInvocationId: "child-workflow-invocation-1", // different from parent
        workflowName: "child-workflow",
        depth: 1,
        ancestry: ["test-workflow", "child-workflow"],
        args: {},
        startedAt: "2026-06-19T00:00:00Z",
        signal: new AbortController().signal,
        abortController: new AbortController()
      };

      await withActiveLoopContext(loopCtx, async () => {
        await withActiveWorkflowInvocation(wfCtx, async () => {
          await dsl.agent({ id: "nested-child-agent", prompt: "hello" });
        });
      });

      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      const scheduledTask = scheduler.schedule.mock.calls[0]![0];
      expect(scheduledTask.id).toBe("test-loop:round-1:nested-child-agent");
      expect(loopCtx.childAgentIds).toContain("test-loop:round-1:nested-child-agent");
    });

    it("already-scoped child workflow ID returned by ctx.agentId() is not double-scoped", async () => {
      const scheduler = makeSchedulerWithResult(makeSuccessResult("test-loop:round-1:nested-child-agent"));
      const runtime = makeRuntimeState({ scheduler });
      const dsl = createDsl(runtime);

      const loopCtx = {
        loopId: "loop-1",
        label: "test-loop",
        roundIndex: 0,
        roundNumber: 1,
        roundId: "round-1",
        childAgentIds: [],
        childWorkflowInvocationIds: [],
        signal: new AbortController().signal,
        workflowInvocationId: "workflow-invocation-1"
      };

      const wfCtx: any = {
        runId: "run-test-1",
        workflowInvocationId: "child-workflow-invocation-1",
        workflowName: "child-workflow",
        depth: 1,
        ancestry: ["test-workflow", "child-workflow"],
        args: {},
        startedAt: "2026-06-19T00:00:00Z",
        signal: new AbortController().signal,
        abortController: new AbortController()
      };

      await withActiveLoopContext(loopCtx, async () => {
        await withActiveWorkflowInvocation(wfCtx, async () => {
          await dsl.agent({ id: "test-loop:round-1:nested-child-agent", prompt: "hello" });
        });
      });

      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      const scheduledTask = scheduler.schedule.mock.calls[0]![0];
      expect(scheduledTask.id).toBe("test-loop:round-1:nested-child-agent");
      expect(loopCtx.childAgentIds).toContain("test-loop:round-1:nested-child-agent");
    });
  });
});
