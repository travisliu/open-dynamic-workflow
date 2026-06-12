import { describe, expect, it, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig } from "../../../src/types/config.js";
import type { AgentResult } from "../../../src/types/agent.js";

// ---- Helpers ----

function makeSuccessResult(id: string, prompt = "task"): AgentResult {
  return {
    ok: true,
    status: "succeeded",
    id,
    provider: "mock",
    stdout: `response for ${prompt}`,
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

function makeSchedulerFromFn(fn: (task: any, opts?: any) => Promise<AgentResult>) {
  return {
    schedule: vi.fn().mockImplementation(fn),
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
    security: { allowWorkflowImports: false, passEnv: [], redactEnv: [] },
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

describe("DSL: parallel() with array input", () => {
  it("runs all array task thunks and returns array results", async () => {
    let callIdx = 0;
    const results = [makeSuccessResult("a", "A"), makeSuccessResult("b", "B")];
    const scheduler = makeSchedulerFromFn(async () => results[callIdx++]!);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const out = await dsl.parallel([
      () => dsl.agent({ id: "a", prompt: "A" }),
      () => dsl.agent({ id: "b", prompt: "B" })
    ]);

    expect(Array.isArray(out)).toBe(true);
    expect((out as AgentResult[]).length).toBe(2);
  });

  it("returns results in the same order as input tasks", async () => {
    const resultA = makeSuccessResult("a", "A");
    const resultB = makeSuccessResult("b", "B");
    let callIdx = 0;
    const results = [resultA, resultB];
    const scheduler = makeSchedulerFromFn(async () => results[callIdx++]!);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const out = await dsl.parallel([
      () => dsl.agent({ id: "a", prompt: "A" }),
      () => dsl.agent({ id: "b", prompt: "B" })
    ]);

    expect((out as AgentResult[])[0]).toEqual(resultA);
    expect((out as AgentResult[])[1]).toEqual(resultB);
  });

  it("throws InvalidDslCallError when an array item is not a function", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    await expect(
      dsl.parallel([
        () => dsl.agent({ id: "a", prompt: "A" }),
        "not-a-function" as any
      ])
    ).rejects.toThrow(InvalidDslCallError);
  });

  it("includes failed agent result in the result array without throwing", async () => {
    const successResult = makeSuccessResult("a", "A");
    const failResult = makeFailureResult("b");
    let callIdx = 0;
    const results = [successResult, failResult];
    const scheduler = makeSchedulerFromFn(async () => results[callIdx++]!);
    const runtime = makeRuntimeState({ scheduler: scheduler as any });
    const dsl = createDsl(runtime);

    const out = await dsl.parallel([
      () => dsl.agent({ id: "a", prompt: "A" }),
      () => dsl.agent({ id: "b", prompt: "B" })
    ]);

    const arr = out as AgentResult[];
    expect(arr[0]!.ok).toBe(true);
    expect(arr[1]!.ok).toBe(false);
  });

  it("handles empty array input gracefully", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    const out = await dsl.parallel([]);

    expect(Array.isArray(out)).toBe(true);
    expect((out as any[]).length).toBe(0);
  });

  it("throws InvalidDslCallError when tasks argument is not an object or array", async () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    await expect(dsl.parallel(null as any)).rejects.toThrow(InvalidDslCallError);
    await expect(dsl.parallel(undefined as any)).rejects.toThrow(InvalidDslCallError);
  });
});
