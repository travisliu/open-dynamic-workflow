import { describe, expect, it } from "vitest";
import { EXIT_CODES, exitCodeForErrorCode } from "../src/types/index.js";
import type { AgentResult, EventEnvelope } from "../src/types/index.js";

describe("Phase 0 contracts", () => {
  it("maps workflow validation errors to exit code 3", () => {
    expect(exitCodeForErrorCode("WORKFLOW_VALIDATION_ERROR")).toBe(EXIT_CODES.WORKFLOW_PARSE_OR_VALIDATION_ERROR);
  });

  it("supports a discriminated success agent result", () => {
    const result: AgentResult = {
      ok: true,
      status: "succeeded",
      id: "agent-1",
      provider: "mock",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      artifacts: {
        dir: "agents/agent-1",
        promptPath: "agents/agent-1/prompt.txt",
        stdoutPath: "agents/agent-1/stdout.log",
        stderrPath: "agents/agent-1/stderr.log"
      }
    };

    expect(result.ok).toBe(true);
  });

  it("requires event schema version and sequence", () => {
    const event: EventEnvelope = {
      schemaVersion: "execflow.event.v1",
      runId: "run-1",
      sequence: 1,
      timestamp: "2026-06-02T00:00:00.000Z",
      type: "workflow.log",
      payload: { message: "hello" }
    };

    expect(event.sequence).toBe(1);
  });
});
