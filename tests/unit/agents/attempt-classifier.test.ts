import { describe, it, expect } from "vitest";
import { classifyAttemptFailure } from "../../../src/agents/attempt-classifier.js";
import type { AgentResult } from "../../../src/types/agent.js";

describe("classifyAttemptFailure", () => {
  const dummyResult = (ok: boolean, status: any, extras: Partial<AgentResult> = {}): AgentResult => {
    return {
      id: "test-agent",
      ok,
      status,
      provider: "mock",
      stdout: "",
      stderr: "",
      exitCode: ok ? 0 : 1,
      durationMs: 10,
      artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" },
      ...extras
    } as AgentResult;
  };

  it("handles a successful result", () => {
    const res = dummyResult(true, "succeeded");
    const classification = classifyAttemptFailure({ result: res });
    expect(classification).toEqual({
      reason: "unknown",
      retryable: false,
      message: "Attempt succeeded, no failure detected."
    });
  });

  it("classifies RUN_LIMIT_EXCEEDED as run_limit_exceeded and non-retryable", () => {
    const res = dummyResult(false, "failed", {
      error: { name: "RunLimitExceeded", message: "Run limit reached", code: "RUN_LIMIT_EXCEEDED" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("run_limit_exceeded");
    expect(classification.retryable).toBe(false);
  });

  it("classifies security policy violations as non-retryable", () => {
    const res = dummyResult(false, "failed", {
      error: { name: "SecurityViolation", message: "Denied", code: "SECURITY_POLICY_VIOLATION" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("security_policy_violation");
    expect(classification.retryable).toBe(false);
  });

  it("classifies user cancellation as cancelled and non-retryable", () => {
    const res = dummyResult(false, "cancelled", {
      error: { name: "CancelledError", message: "User abort", code: "USER_CANCELLED" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("cancelled");
    expect(classification.retryable).toBe(false);
  });

  it("classifies timeouts as timed_out and non-retryable", () => {
    const res = dummyResult(false, "timed_out", {
      error: { name: "TimeoutError", message: "Timed out", code: "PROCESS_TIMEOUT" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("timed_out");
    expect(classification.retryable).toBe(false);
  });

  it("classifies validation errors as schema_validation_failed and retryable", () => {
    const res = dummyResult(false, "failed", {
      error: { name: "ValidationError", message: "Invalid schema", code: "SCHEMA_VALIDATION_FAILED" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("schema_validation_failed");
    expect(classification.retryable).toBe(true);
  });

  it("classifies parsing errors as malformed_output and retryable", () => {
    const res = dummyResult(false, "failed", {
      error: { name: "ParseError", message: "Cannot parse JSON", code: "PARSE_ERROR" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("malformed_output");
    expect(classification.retryable).toBe(true);
  });

  it("classifies provider process failures as provider_error and retryable", () => {
    const res = dummyResult(false, "failed", {
      exitCode: 127,
      error: { name: "ProviderProcessFailed", message: "Failed execution", code: "PROVIDER_PROCESS_FAILED" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("provider_error");
    expect(classification.retryable).toBe(true);
  });

  it("classifies process error as process_error and retryable", () => {
    const res = dummyResult(false, "failed", {
      error: { name: "ProcessError", message: "Process spawn failed", code: "PROCESS_SPAWN_FAILED" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("process_error");
    expect(classification.retryable).toBe(true);
  });

  it("classifies invalid config as invalid_configuration and non-retryable", () => {
    const res = dummyResult(false, "failed", {
      error: { name: "ConfigError", message: "Invalid model", code: "MODEL_NOT_SUPPORTED" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("invalid_configuration");
    expect(classification.retryable).toBe(false);
  });

  it("classifies invalid workflow as invalid_workflow and non-retryable", () => {
    const res = dummyResult(false, "failed", {
      error: { name: "WorkflowError", message: "Workflow validation error", code: "WORKFLOW_VALIDATION_ERROR" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("invalid_workflow");
    expect(classification.retryable).toBe(false);
  });

  it("classifies thrownError with matching code if provided", () => {
    const res = dummyResult(true, "succeeded"); // result might not reflect error yet
    const errorObj = { name: "RunLimitExceeded", code: "RUN_LIMIT_EXCEEDED", message: "Run limit hit" };
    const classification = classifyAttemptFailure({ result: res, thrownError: errorObj });
    expect(classification.reason).toBe("run_limit_exceeded");
    expect(classification.retryable).toBe(false);
    expect(classification.code).toBe("RUN_LIMIT_EXCEEDED");
  });

  it("classifies unknown code/error as unknown and non-retryable", () => {
    const res = dummyResult(false, "failed", {
      exitCode: null,
      error: { name: "UnknownError", message: "Something went wrong", code: "SOME_RANDOM_CODE" }
    });
    const classification = classifyAttemptFailure({ result: res });
    expect(classification.reason).toBe("unknown");
    expect(classification.retryable).toBe(false);
  });
});
