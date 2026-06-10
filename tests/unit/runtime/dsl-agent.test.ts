import { describe, expect, it, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig } from "../../../src/types/config.js";
import type { AgentResult } from "../../../src/types/agent.js";

// ---- Helpers ----

function makeFakeEventSink() {
  const events: { type: string; payload: unknown }[] = [];
  return {
    events,
    emit(type: string, payload: unknown) {
      events.push({ type, payload });
    }
  };
}

function makeSuccessResult(id: string, provider = "mock"): AgentResult {
  return {
    ok: true,
    status: "succeeded",
    id,
    provider,
    text: `response for ${id}`,
    stdout: `response for ${id}`,
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
  };
}

function makeJsonSuccessResult(id: string, json: unknown, provider = "mock"): AgentResult {
  return {
    ok: true,
    status: "succeeded",
    id,
    provider,
    text: JSON.stringify(json),
    json,
    stdout: JSON.stringify(json),
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
  };
}

function makeFailureResult(id: string, provider = "mock"): AgentResult {
  return {
    ok: false,
    status: "failed",
    id,
    provider,
    stdout: "",
    stderr: "Agent failed",
    exitCode: 1,
    durationMs: 5,
    artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
    error: { name: "AgentFailure", message: "Agent failed", code: "PROVIDER_PROCESS_FAILED" }
  };
}

function makeSchedulerWithResult(result: AgentResult) {
  return {
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
  };
}

function makeExecutingScheduler() {
  return {
    schedule: vi.fn(async (task: { run: (signal: AbortSignal) => Promise<AgentResult> }) => {
      return task.run(new AbortController().signal);
    }),
    drain: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue({
      aborted: false,
      abortReason: undefined,
      runningCount: 0,
      queuedCount: 0,
      completedCount: 0
    })
  };
}

function makeRuntimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  const parsedWorkflow: ParsedWorkflow = {
    meta: { name: "test", description: "test" },
    body: "",
    sourcePath: "test.js",
    sourceText: "",
    sourceHash: "abc123"
  };

  const config: ResolvedConfig = {
    defaultProvider: "mock",
    concurrency: 1,
    timeoutMs: 30000,
    providers: {},
    security: { allowShell: false, allowWorkflowImports: false, passEnv: [], redactEnv: [] },
    reporting: { mode: "pretty", verbose: false },
    cwd: "/workspace",
    outDir: "/workspace/.openflow/runs",
    cliArgs: {}
  };

  return {
    runId: "run-test-1",
    parsedWorkflow,
    config,
    args: {},
    cwd: "/workspace",
    artifactsDir: "/workspace/.openflow/runs/run-test-1",
    agentResults: [],
    scheduler: makeSchedulerWithResult(makeSuccessResult("agent-1")) as any,
    agentExecutor: { execute: vi.fn() },
    eventSink: makeFakeEventSink() as any,
    abortController: new AbortController(),
    agentCounter: 0,
    ...overrides
  };
}

// ---- Tests ----

describe("DSL: agent()", () => {
  it("valid agent call schedules a task through the scheduler", async () => {
    const successResult = makeSuccessResult("agent-1");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await dsl.agent({ id: "agent-1", prompt: "Tell me a joke", provider: "mock" });

    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
  });

  it("returns the result from the scheduler", async () => {
    const successResult = makeSuccessResult("agent-1");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const result = await dsl.agent({ id: "agent-1", prompt: "Tell me a joke", provider: "mock" });

    expect(result).toEqual(successResult);
  });

  it("missing prompt throws InvalidDslCallError with a clear message", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    await expect(dsl.agent({ prompt: "" } as any)).rejects.toThrow(InvalidDslCallError);
    await expect(dsl.agent({ prompt: "   " } as any)).rejects.toThrow(InvalidDslCallError);
    await expect(dsl.agent({} as any)).rejects.toThrow(InvalidDslCallError);
  });

  it("missing input throws InvalidDslCallError", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    await expect(dsl.agent(null as any)).rejects.toThrow(InvalidDslCallError);
    await expect(dsl.agent(undefined as any)).rejects.toThrow(InvalidDslCallError);
  });

  it("rejects an invalid structuredOutput transport", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    await expect(
      dsl.agent({
        prompt: "hello",
        structuredOutput: { transport: "bogus" as any }
      })
    ).rejects.toThrow("structuredOutput.transport");
  });

  it("uses default provider from config when input provider is not specified", async () => {
    const successResult = makeSuccessResult("agent-1", "mock");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({
      scheduler: scheduler as any,
      config: {
        defaultProvider: "mock",
        concurrency: 1,
        timeoutMs: 30000,
        providers: {},
        security: { allowShell: false, allowWorkflowImports: false, passEnv: [], redactEnv: [] },
        reporting: { mode: "pretty", verbose: false },
        cwd: "/workspace",
        outDir: "/workspace/.openflow/runs",
        cliArgs: {}
      }
    });
    const dsl = createDsl(runtime);

    await dsl.agent({ prompt: "hello" });

    const scheduleCall = scheduler.schedule.mock.calls[0]!;
    const scheduledTask = scheduleCall[0];
    expect(scheduledTask.provider).toBe("mock");
  });

  it("passes structuredOutput through to agent execution", async () => {
    const agentExecutor = { execute: vi.fn().mockResolvedValue(makeSuccessResult("agent-1")) };
    const scheduler = makeExecutingScheduler();
    const runtime = makeRuntimeState({
      scheduler: scheduler as any,
      agentExecutor: agentExecutor as any
    });
    const dsl = createDsl(runtime);

    await dsl.agent({
      id: "agent-1",
      prompt: "hello",
      structuredOutput: { transport: "prompt" }
    });

    expect(agentExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "hello",
        structuredOutput: { transport: "prompt" }
      })
    );
  });

  it("uses explicit provider over config default", async () => {
    const successResult = makeSuccessResult("agent-1", "codex");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await dsl.agent({ prompt: "hello", provider: "codex" });

    const scheduleCall = scheduler.schedule.mock.calls[0]!;
    const scheduledTask = scheduleCall[0];
    expect(scheduledTask.provider).toBe("codex");
  });

  it("resolves timeout from input when provided", async () => {
    const successResult = makeSuccessResult("agent-1");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await dsl.agent({ prompt: "hello", timeoutMs: 5000 });

    const scheduleCall = scheduler.schedule.mock.calls[0]!;
    const scheduleOptions = scheduleCall[1];
    expect(scheduleOptions.timeoutMs).toBe(5000);
  });

  it("falls back to config timeout when input timeout is not provided", async () => {
    const successResult = makeSuccessResult("agent-1");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({
      scheduler: scheduler as any,
      config: {
        defaultProvider: "mock",
        concurrency: 1,
        timeoutMs: 45000,
        providers: {},
        security: { allowShell: false, allowWorkflowImports: false, passEnv: [], redactEnv: [] },
        reporting: { mode: "pretty", verbose: false },
        cwd: "/workspace",
        outDir: "/workspace/.openflow/runs",
        cliArgs: {}
      }
    });
    const dsl = createDsl(runtime);

    await dsl.agent({ prompt: "hello" });

    const scheduleCall = scheduler.schedule.mock.calls[0]!;
    const scheduleOptions = scheduleCall[1];
    expect(scheduleOptions.timeoutMs).toBe(45000);
  });

  it("generates a stable agent ID when none is provided", async () => {
    const successResult = makeSuccessResult("agent-1");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await dsl.agent({ prompt: "hello" });

    const scheduleCall = scheduler.schedule.mock.calls[0]!;
    const scheduledTask = scheduleCall[0];
    expect(typeof scheduledTask.id).toBe("string");
    expect(scheduledTask.id.length).toBeGreaterThan(0);
  });

  it("uses idGenerator when available", async () => {
    const successResult = makeSuccessResult("agent-gen-1");
    const scheduler = makeSchedulerWithResult(successResult);
    const idGenerator = { nextId: vi.fn().mockReturnValue("agent-gen-1") };
    const runtime = makeRuntimeState({
      scheduler: scheduler as any,
      idGenerator
    });
    const dsl = createDsl(runtime);

    await dsl.agent({ prompt: "hello" });

    const scheduleCall = scheduler.schedule.mock.calls[0]!;
    expect(scheduleCall[0].id).toBe("agent-gen-1");
  });

  it("adds returned result to runtime.agentResults", async () => {
    const successResult = makeSuccessResult("agent-1");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await dsl.agent({ id: "agent-1", prompt: "hello" });

    expect(runtime.agentResults).toHaveLength(1);
    expect(runtime.agentResults[0]).toEqual(successResult);
  });

  it("failed agent result is returned as a value (not thrown)", async () => {
    const failResult = makeFailureResult("agent-fail");
    const scheduler = makeSchedulerWithResult(failResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const result = await dsl.agent({ id: "agent-fail", prompt: "fail please" });

    expect(result.ok).toBe(false);
    expect((result as any).status).toBe("failed");
    expect(runtime.agentResults).toHaveLength(1);
  });

  it("throws InvalidDslCallError for invalid id", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    await expect(dsl.agent({ id: "", prompt: "hello" })).rejects.toThrow(InvalidDslCallError);
    await expect(dsl.agent({ id: 123 as any, prompt: "hello" })).rejects.toThrow(InvalidDslCallError);
  });

  it("throws InvalidDslCallError for invalid timeout", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    await expect(dsl.agent({ prompt: "hello", timeoutMs: -1 })).rejects.toThrow(InvalidDslCallError);
    await expect(dsl.agent({ prompt: "hello", timeoutMs: 0 })).rejects.toThrow(InvalidDslCallError);
  });

  it("generates unique, deterministic IDs for multiple unnamed agents", async () => {
    const scheduler = {
      schedule: vi.fn().mockImplementation((task) => {
        return Promise.resolve(makeSuccessResult(task.id));
      }),
      drain: vi.fn(),
      abort: vi.fn(),
      getSnapshot: vi.fn()
    };
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await dsl.agent({ prompt: "first" });
    await dsl.agent({ prompt: "second" });

    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    expect(scheduler.schedule.mock.calls[0][0].id).toBe("agent-1");
    expect(scheduler.schedule.mock.calls[1][0].id).toBe("agent-2");
  });

  it("ensures uniqueness across parallel unnamed agent calls", async () => {
    const scheduler = {
      schedule: vi.fn().mockImplementation((task) => {
        return Promise.resolve(makeSuccessResult(task.id));
      }),
      drain: vi.fn(),
      abort: vi.fn(),
      getSnapshot: vi.fn()
    };
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await dsl.parallel([
      () => dsl.agent({ prompt: "parallel 1" }),
      () => dsl.agent({ prompt: "parallel 2" })
    ]);

    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    const ids = scheduler.schedule.mock.calls.map(call => call[0].id);
    expect(ids).toContain("agent-1");
    expect(ids).toContain("agent-2");
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("string form returns text for successful plain agent calls", async () => {
    const successResult = makeSuccessResult("agent-1");
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const result = await dsl.agent("hello");

    expect(result).toBe("response for agent-1");
  });

  it("string form returns json when the agent result has json", async () => {
    const successResult = makeJsonSuccessResult("agent-1", { ok: true });
    const scheduler = makeSchedulerWithResult(successResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const result = await dsl.agent("return json", { schema: { type: "object" } });

    expect(result).toEqual({ ok: true });
  });

  it("string form throws on failed agent by default", async () => {
    const failResult = makeFailureResult("agent-fail");
    const scheduler = makeSchedulerWithResult(failResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await expect(dsl.agent("fail please")).rejects.toThrow("Agent failed");
  });

  it("string form returns null for optional failed agents", async () => {
    const failResult = makeFailureResult("agent-fail");
    const scheduler = makeSchedulerWithResult(failResult);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const result = await dsl.agent("fail please", { optional: true });

    expect(result).toBeNull();
  });

  it("agent.review routes through codex exec review metadata", async () => {
    const agentExecutor = { execute: vi.fn().mockResolvedValue(makeSuccessResult("review-1", "codex")) };
    const scheduler = makeExecutingScheduler();
    const runtime = makeRuntimeState({
      scheduler: scheduler as any,
      agentExecutor: agentExecutor as any
    });
    const dsl = createDsl(runtime);

    await dsl.agent.review("review current changes", {
      id: "review-1",
      uncommitted: true,
      base: "main",
      title: "Review title"
    });

    expect(agentExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        metadata: expect.objectContaining({
          codexMode: "review",
          codexReview: {
            uncommitted: true,
            base: "main",
            title: "Review title"
          }
        })
      })
    );
  });
});
