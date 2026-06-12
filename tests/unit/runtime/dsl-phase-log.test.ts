import { describe, expect, it, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig } from "../../../src/types/config.js";

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

function makeSchedulerStub() {
  return {
    schedule: vi.fn(),
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
    scheduler: makeSchedulerStub() as any,
    agentExecutor: { execute: vi.fn() },
    eventSink: makeFakeEventSink() as any,
    abortController: new AbortController(),
    agentCounter: 0,
    ...overrides
  };
}

// ---- Tests ----

describe("DSL: phase()", () => {
  it("updates the current phase in runtime state", () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    dsl.phase("review");

    expect(runtime.currentPhase).toBe("review");
  });

  it("emits phase.started event when phase is set", () => {
    const eventSink = makeFakeEventSink();
    const runtime = makeRuntimeState({ eventSink: eventSink as any });
    const dsl = createDsl(runtime);

    dsl.phase("review");

    const phaseStarted = eventSink.events.find((e) => e.type === "phase.started");
    expect(phaseStarted).toBeDefined();
    expect((phaseStarted!.payload as any).name).toBe("review");
  });

  it("emits phase.completed for previous phase before starting a new one", () => {
    const eventSink = makeFakeEventSink();
    const runtime = makeRuntimeState({ eventSink: eventSink as any, currentPhase: "setup" });
    const dsl = createDsl(runtime);

    dsl.phase("review");

    const phaseCompleted = eventSink.events.find((e) => e.type === "phase.completed");
    expect(phaseCompleted).toBeDefined();
    expect((phaseCompleted!.payload as any).name).toBe("setup");
  });

  it("throws InvalidDslCallError for empty phase name", () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    expect(() => dsl.phase("")).toThrow(InvalidDslCallError);
  });

  it("throws InvalidDslCallError for whitespace-only phase name", () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    expect(() => dsl.phase("   ")).toThrow(InvalidDslCallError);
  });

  it("throws InvalidDslCallError for non-string phase name", () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    expect(() => dsl.phase(42 as any)).toThrow(InvalidDslCallError);
  });

  it("allows updating phase multiple times", () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    dsl.phase("setup");
    dsl.phase("review");
    dsl.phase("summarize");

    expect(runtime.currentPhase).toBe("summarize");
  });
});

describe("DSL: log()", () => {
  it("emits workflow.log event with message", () => {
    const eventSink = makeFakeEventSink();
    const runtime = makeRuntimeState({ eventSink: eventSink as any });
    const dsl = createDsl(runtime);

    dsl.log("hello from log");

    const logEvent = eventSink.events.find((e) => e.type === "workflow.log");
    expect(logEvent).toBeDefined();
    expect((logEvent!.payload as any).message).toBe("hello from log");
  });

  it("preserves data when provided", () => {
    const eventSink = makeFakeEventSink();
    const runtime = makeRuntimeState({ eventSink: eventSink as any });
    const dsl = createDsl(runtime);

    dsl.log("hello", { count: 1, value: "test" });

    const logEvent = eventSink.events.find((e) => e.type === "workflow.log");
    expect((logEvent!.payload as any).data).toEqual({ count: 1, value: "test" });
  });

  it("emits workflow.log without data when data is undefined", () => {
    const eventSink = makeFakeEventSink();
    const runtime = makeRuntimeState({ eventSink: eventSink as any });
    const dsl = createDsl(runtime);

    dsl.log("hello");

    const logEvent = eventSink.events.find((e) => e.type === "workflow.log");
    expect((logEvent!.payload as any).data).toBeUndefined();
  });

  it("throws InvalidDslCallError for non-string message", () => {
    const runtime = makeRuntimeState();
    const dsl = createDsl(runtime);

    expect(() => dsl.log(42 as any)).toThrow(InvalidDslCallError);
  });

  it("accepts empty string as message", () => {
    const eventSink = makeFakeEventSink();
    const runtime = makeRuntimeState({ eventSink: eventSink as any });
    const dsl = createDsl(runtime);

    expect(() => dsl.log("")).not.toThrow();
    const logEvent = eventSink.events.find((e) => e.type === "workflow.log");
    expect((logEvent!.payload as any).message).toBe("");
  });
});
