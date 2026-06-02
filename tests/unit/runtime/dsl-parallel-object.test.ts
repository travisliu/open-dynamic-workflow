import { describe, expect, it, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig } from "../../../src/types/config.js";
import type { AgentResult } from "../../../src/types/agent.js";

// ---- Helpers ----

function makeSuccessResult(id: string): AgentResult {
  return {
    ok: true,
    status: "succeeded",
    id,
    provider: "mock",
    stdout: `response for ${id}`,
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
  };
}

function makeFailureResult(id: string): AgentResult {
  return {
    ok: false,
    status: "failed",
    id,
    provider: "mock",
    stdout: "",
    stderr: "failed",
    exitCode: 1,
    durationMs: 5,
    artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
    error: { name: "AgentFailure", message: "failed", code: "PROVIDER_PROCESS_FAILED" }
  };
}

function makeSchedulerFromMap(resultMap: Record<string, AgentResult>) {
  return {
    schedule: vi.fn().mockImplementation(async (task: { id: string }) => {
      const result = resultMap[task.id];
      if (!result) throw new Error(`No result mapped for task id: ${task.id}`);
      return result;
    }),
    drain: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue({ aborted: false })
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
    concurrency: 2,
    timeoutMs: 30000,
    providers: {},
    security: { allowShell: false, allowWorkflowImports: false, passEnv: [], redactEnv: [] },
    reporting: { mode: "pretty", verbose: false },
    cwd: "/workspace",
    outDir: "/workspace/.execflow/runs",
    cliArgs: {}
  };

  return {
    runId: "run-test-1",
    parsedWorkflow,
    config,
    args: {},
    cwd: "/workspace",
    artifactsDir: "/workspace/.execflow/runs/run-test-1",
    agentResults: [],
    scheduler: {
      schedule: vi.fn().mockResolvedValue(makeSuccessResult("default")),
      drain: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ aborted: false })
    } as any,
    agentExecutor: { execute: vi.fn() },
    eventSink: { emit: vi.fn() } as any,
    abortController: new AbortController(),
    agentCounter: 0,
    ...overrides
  };
}

// ---- Tests ----

describe("DSL: parallel() with object input", () => {
  it("runs all object task thunks and returns an object result", async () => {
    const scheduler = makeSchedulerFromMap({
      review: makeSuccessResult("review"),
      summarize: makeSuccessResult("summarize")
    });
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const out = await dsl.parallel({
      review: () => dsl.agent({ id: "review", prompt: "review" }),
      summarize: () => dsl.agent({ id: "summarize", prompt: "summarize" })
    });

    expect(typeof out).toBe("object");
    expect(Array.isArray(out)).toBe(false);
  });

  it("output keys match input keys", async () => {
    const scheduler = makeSchedulerFromMap({
      alpha: makeSuccessResult("alpha"),
      beta: makeSuccessResult("beta"),
      gamma: makeSuccessResult("gamma")
    });
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const out = await dsl.parallel({
      alpha: () => dsl.agent({ id: "alpha", prompt: "alpha" }),
      beta: () => dsl.agent({ id: "beta", prompt: "beta" }),
      gamma: () => dsl.agent({ id: "gamma", prompt: "gamma" })
    });

    const result = out as Record<string, AgentResult>;
    expect(Object.keys(result).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("maps output values to the correct key", async () => {
    const reviewResult = makeSuccessResult("review");
    const summarizeResult = makeSuccessResult("summarize");
    const scheduler = makeSchedulerFromMap({
      review: reviewResult,
      summarize: summarizeResult
    });
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const out = await dsl.parallel({
      review: () => dsl.agent({ id: "review", prompt: "review" }),
      summarize: () => dsl.agent({ id: "summarize", prompt: "summarize" })
    });

    const result = out as Record<string, AgentResult>;
    expect(result.review).toEqual(reviewResult);
    expect(result.summarize).toEqual(summarizeResult);
  });

  it("throws InvalidDslCallError when an object value is not a function", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    await expect(
      dsl.parallel({
        good: () => dsl.agent({ id: "good", prompt: "good" }),
        bad: "not-a-function" as any
      })
    ).rejects.toThrow(InvalidDslCallError);
  });

  it("includes failed agent result under the correct key", async () => {
    const goodResult = makeSuccessResult("good");
    const failResult = makeFailureResult("bad");
    const scheduler = makeSchedulerFromMap({
      good: goodResult,
      bad: failResult
    });
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const out = await dsl.parallel({
      good: () => dsl.agent({ id: "good", prompt: "good" }),
      bad: () => dsl.agent({ id: "bad", prompt: "bad" })
    });

    const result = out as Record<string, AgentResult>;
    expect(result.good!.ok).toBe(true);
    expect(result.bad!.ok).toBe(false);
  });

  it("waits for all branches before returning", async () => {
    let completedCount = 0;
    const delayedResult = (id: string): AgentResult => makeSuccessResult(id);
    const scheduler = {
      schedule: vi.fn().mockImplementation(async (task: { id: string }) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        completedCount++;
        return delayedResult(task.id);
      }),
      drain: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ aborted: false })
    };
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    await dsl.parallel({
      a: () => dsl.agent({ id: "a", prompt: "a" }),
      b: () => dsl.agent({ id: "b", prompt: "b" }),
      c: () => dsl.agent({ id: "c", prompt: "c" })
    });

    expect(completedCount).toBe(3);
  });

  it("handles empty object input gracefully", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    const out = await dsl.parallel({});

    expect(typeof out).toBe("object");
    expect(Object.keys(out as object).length).toBe(0);
  });
});
