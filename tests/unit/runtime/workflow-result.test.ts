import { describe, expect, it } from "vitest";
import {
  buildSucceededRunResult,
  buildFailedRunResult,
  buildCancelledRunResult
} from "../../../src/workflow/runtime.js";
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
    stdout: `output for ${id}`,
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
  };
}

function makeRuntimeState(agentResults: AgentResult[] = []): RuntimeState {
  const parsedWorkflow: ParsedWorkflow = {
    meta: { name: "test-workflow", description: "Test description" },
    body: "",
    sourcePath: "workflow.js",
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
    runId: "run-result-test",
    parsedWorkflow,
    config,
    args: {},
    cwd: "/workspace",
    artifactsDir: "/workspace/.openflow/runs/run-result-test",
    agentResults,
    scheduler: {} as any,
    agentExecutor: {} as any,
    eventSink: {} as any,
    abortController: new AbortController(),
    agentCounter: 0,
    startedAt: "2026-06-02T00:00:00.000Z"
  };
}

// ---- Tests ----

describe("buildSucceededRunResult()", () => {
  it("returns status succeeded", () => {
    const runtime = makeRuntimeState();
    const result = buildSucceededRunResult(runtime, { ok: true }, 100, "2026-06-02T00:00:01.000Z");

    expect(result.status).toBe("succeeded");
  });

  it("includes the schema version", () => {
    const runtime = makeRuntimeState();
    const result = buildSucceededRunResult(runtime, undefined, 100, "2026-06-02T00:00:01.000Z");

    expect(result.schemaVersion).toBe("openflow.report.v1");
  });

  it("includes run ID from runtime", () => {
    const runtime = makeRuntimeState();
    const result = buildSucceededRunResult(runtime, undefined, 100, "2026-06-02T00:00:01.000Z");

    expect(result.runId).toBe("run-result-test");
  });

  it("includes workflow metadata", () => {
    const runtime = makeRuntimeState();
    const result = buildSucceededRunResult(runtime, undefined, 100, "2026-06-02T00:00:01.000Z");

    expect(result.meta.name).toBe("test-workflow");
    expect(result.meta.description).toBe("Test description");
  });

  it("includes all collected agent results", () => {
    const agents = [makeSuccessResult("a1"), makeSuccessResult("a2")];
    const runtime = makeRuntimeState(agents);
    const result = buildSucceededRunResult(runtime, undefined, 100, "2026-06-02T00:00:01.000Z");

    expect(result.agents).toHaveLength(2);
    expect(result.agents[0]!.id).toBe("a1");
    expect(result.agents[1]!.id).toBe("a2");
  });

  it("includes workflow result when provided", () => {
    const runtime = makeRuntimeState();
    const workflowResult = { ok: true, data: "hello" };
    const result = buildSucceededRunResult(runtime, workflowResult, 100, "2026-06-02T00:00:01.000Z");

    expect(result.result).toEqual(workflowResult);
  });

  it("does not include result field when undefined", () => {
    const runtime = makeRuntimeState();
    const result = buildSucceededRunResult(runtime, undefined, 100, "2026-06-02T00:00:01.000Z");

    expect(result.result).toBeUndefined();
  });

  it("includes timing fields", () => {
    const runtime = makeRuntimeState();
    const result = buildSucceededRunResult(runtime, undefined, 200, "2026-06-02T00:00:02.000Z");

    expect(result.durationMs).toBe(200);
    expect(result.finishedAt).toBe("2026-06-02T00:00:02.000Z");
    expect(result.startedAt).toBe("2026-06-02T00:00:00.000Z");
  });

  it("has no error field", () => {
    const runtime = makeRuntimeState();
    const result = buildSucceededRunResult(runtime, undefined, 100, "2026-06-02T00:00:01.000Z");

    expect(result.error).toBeUndefined();
  });
});

describe("buildFailedRunResult()", () => {
  it("returns status failed", () => {
    const runtime = makeRuntimeState();
    const result = buildFailedRunResult(runtime, new Error("boom"), 100, "2026-06-02T00:00:01.000Z");

    expect(result.status).toBe("failed");
  });

  it("includes serialized error", () => {
    const runtime = makeRuntimeState();
    const result = buildFailedRunResult(runtime, new Error("boom"), 100, "2026-06-02T00:00:01.000Z");

    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe("boom");
  });

  it("includes partial agent results collected before failure", () => {
    const agents = [makeSuccessResult("a1")];
    const runtime = makeRuntimeState(agents);
    const result = buildFailedRunResult(runtime, new Error("boom"), 100, "2026-06-02T00:00:01.000Z");

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]!.id).toBe("a1");
  });

  it("includes timing fields", () => {
    const runtime = makeRuntimeState();
    const result = buildFailedRunResult(runtime, new Error("error"), 150, "2026-06-02T00:00:01.500Z");

    expect(result.durationMs).toBe(150);
    expect(result.finishedAt).toBe("2026-06-02T00:00:01.500Z");
  });
});

describe("buildCancelledRunResult()", () => {
  it("returns status cancelled", () => {
    const runtime = makeRuntimeState();
    const result = buildCancelledRunResult(runtime, 100, "2026-06-02T00:00:01.000Z", "User cancelled");

    expect(result.status).toBe("cancelled");
  });

  it("includes cancellation reason as error message", () => {
    const runtime = makeRuntimeState();
    const result = buildCancelledRunResult(runtime, 100, "2026-06-02T00:00:01.000Z", "User cancelled");

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("User cancelled");
  });

  it("uses default message when reason is undefined", () => {
    const runtime = makeRuntimeState();
    const result = buildCancelledRunResult(runtime, 100, "2026-06-02T00:00:01.000Z");

    expect(result.error).toBeDefined();
    expect(result.error!.message).toBeTruthy();
  });

  it("includes partial agent results", () => {
    const agents = [makeSuccessResult("a1"), makeSuccessResult("a2")];
    const runtime = makeRuntimeState(agents);
    const result = buildCancelledRunResult(runtime, 100, "2026-06-02T00:00:01.000Z");

    expect(result.agents).toHaveLength(2);
  });
});
