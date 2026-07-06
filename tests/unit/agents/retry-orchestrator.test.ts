import { describe, expect, it, beforeEach, vi } from "vitest";
import { RetryOrchestrator, type RetryOrchestratorInput } from "../../../src/agents/retry-orchestrator.js";
import type { AgentExecutor } from "../../../src/agents/execution-types.js";
import type { AgentResult } from "../../../src/types/agent.js";
import type { ResolvedRetryPolicy } from "../../../src/types/retry.js";
import { EventBus } from "../../../src/orchestration/event-bus.js";

describe("RetryOrchestrator", () => {
  let mockExecutor: AgentExecutor;
  let mockScheduler: any;
  let mockRunLimits: any;
  let mockArtifactStore: any;
  let eventBus: any;
  let writtenFiles: Map<string, any>;
  let orchestrator: RetryOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    writtenFiles = new Map();

    mockExecutor = {
      execute: vi.fn()
    };

    mockScheduler = {
      schedule: vi.fn(async (task: any, options: any) => {
        return await task.run(new AbortController().signal);
      }),
      drain: vi.fn(),
      abort: vi.fn()
    };

    mockRunLimits = {
      beforeAgentSchedule: vi.fn(),
      summary: vi.fn()
    };

    mockArtifactStore = {
      writeJson: vi.fn(async (path: string, val: any) => {
        writtenFiles.set(path, val);
        return path;
      }),
      writeText: vi.fn(async (path: string, val: any) => {
        writtenFiles.set(path, val);
        return path;
      }),
      readJson: vi.fn(async (path: string) => {
        return writtenFiles.get(path);
      })
    };

    eventBus = {
      emit: vi.fn()
    };

    orchestrator = new RetryOrchestrator({ executor: mockExecutor });
  });

  const createInput = (retryPolicy: Partial<ResolvedRetryPolicy> = {}): RetryOrchestratorInput => {
    return {
      logicalAgentId: "my-logical-agent",
      label: "My Agent",
      provider: "mock",
      model: "mock-model",
      basePrompt: "hello",
      timeoutMs: 1000,
      cwd: "/root",
      permissions: { mode: "default" },
      metadata: {},
      retry: {
        enabled: true,
        policy: {
          maxAttempts: 3,
          delayMs: 1000,
          backoff: "fixed",
          maxDelayMs: 5000,
          jitter: false,
          disableDelay: true // makes tests fast by skipping actual sleep
        },
        source: "agent",
        ...retryPolicy
      },
      scheduler: mockScheduler,
      runLimits: mockRunLimits,
      artifactStore: mockArtifactStore,
      eventBus,
      signal: new AbortController().signal,
      failFast: false
    };
  };

  it("performs a single attempt and returns when successful", async () => {
    const successResult: AgentResult = {
      ok: true,
      status: "succeeded",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "success stdout",
      stderr: "",
      exitCode: 0,
      durationMs: 50,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" }
    };
    vi.mocked(mockExecutor.execute).mockResolvedValueOnce(successResult);

    const input = createInput();
    const result = await orchestrator.execute(input);

    expect(result.ok).toBe(true);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    expect(mockScheduler.schedule).toHaveBeenCalledTimes(1);
    expect(mockRunLimits.beforeAgentSchedule).toHaveBeenCalledTimes(1);

    // Verify metadata
    expect(result.retry).toBeDefined();
    expect(result.retry?.attemptsStarted).toBe(1);
    expect(result.retry?.exhausted).toBe(false);
    expect(result.retry?.attempts.length).toBe(1);
    expect(result.retry?.attempts[0].status).toBe("succeeded");

    // Verify artifact writes
    expect(writtenFiles.has("agents/my-logical-agent/retry-summary.json")).toBe(true);
    expect(writtenFiles.has("agents/my-logical-agent/result.json")).toBe(true);
  });

  it("retries on retryable failures up to maxAttempts", async () => {
    const retryableFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "provider failed",
      exitCode: 1,
      durationMs: 20,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "ProviderProcessFailed", message: "Failed", code: "PROVIDER_PROCESS_FAILED" },
      permissions: { mode: "default" }
    };

    const successResult: AgentResult = {
      ok: true,
      status: "succeeded",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "recovered",
      stderr: "",
      exitCode: 0,
      durationMs: 30,
      artifacts: { dir: "agents/my-logical-agent/attempts/2", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute)
      .mockResolvedValueOnce(retryableFailure)
      .mockResolvedValueOnce(successResult);

    const input = createInput();
    const result = await orchestrator.execute(input);

    expect(result.ok).toBe(true);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
    expect(mockScheduler.schedule).toHaveBeenCalledTimes(2);
    expect(mockRunLimits.beforeAgentSchedule).toHaveBeenCalledTimes(2);

    expect(result.retry?.attemptsStarted).toBe(2);
    expect(result.retry?.exhausted).toBe(false);
    expect(result.retry?.attempts[0].status).toBe("failed");
    expect(result.retry?.attempts[0].retryable).toBe(true);
    expect(result.retry?.attempts[1].status).toBe("succeeded");
  });

  it("stops retrying and returns final failure when attempts are exhausted", async () => {
    const retryableFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "provider failed",
      exitCode: 1,
      durationMs: 20,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "ProviderProcessFailed", message: "Failed", code: "PROVIDER_PROCESS_FAILED" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute).mockResolvedValue(retryableFailure);

    const input = createInput();
    const result = await orchestrator.execute(input);

    expect(result.ok).toBe(false);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(3); // maxAttempts = 3
    expect(result.retry?.attemptsStarted).toBe(3);
    expect(result.retry?.exhausted).toBe(true);
    expect(result.retry?.finalFailureReason).toBe("provider_error");
  });

  it("does not retry on non-retryable failures", async () => {
    const nonRetryableFailure: AgentResult = {
      ok: false,
      status: "cancelled",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "cancelled",
      exitCode: null,
      durationMs: 10,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "CancelledError", message: "User abort", code: "USER_CANCELLED" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute).mockResolvedValueOnce(nonRetryableFailure);

    const input = createInput();
    const result = await orchestrator.execute(input);

    expect(result.ok).toBe(false);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    expect(result.retry?.attemptsStarted).toBe(1);
    expect(result.retry?.exhausted).toBe(true);
    expect(result.retry?.finalFailureReason).toBe("cancelled");
  });

  it("respects run limit tracker before scheduling and fails immediately if limit reached", async () => {
    mockRunLimits.beforeAgentSchedule.mockImplementation(() => {
      const err = new Error("Run limit reached");
      (err as any).code = "RUN_LIMIT_EXCEEDED";
      throw err;
    });

    const input = createInput();
    const result = await orchestrator.execute(input);

    expect(result.ok).toBe(false);
    expect(mockExecutor.execute).not.toHaveBeenCalled();
    expect(result.error?.code).toBe("RUN_LIMIT_EXCEEDED");
    expect(result.retry?.attemptsStarted).toBe(1);
    expect(result.retry?.finalFailureReason).toBe("run_limit_exceeded");
  });

  it("sets deferFailFastUntilLogicalResult correctly for retry attempts", async () => {
    const retryableFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "provider failed",
      exitCode: 1,
      durationMs: 20,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "ProviderProcessFailed", message: "Failed", code: "PROVIDER_PROCESS_FAILED" },
      permissions: { mode: "default" }
    };

    const successResult: AgentResult = {
      ok: true,
      status: "succeeded",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "recovered",
      stderr: "",
      exitCode: 0,
      durationMs: 30,
      artifacts: { dir: "agents/my-logical-agent/attempts/2", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute)
      .mockResolvedValueOnce(retryableFailure)
      .mockResolvedValueOnce(successResult);

    const input = createInput();
    await orchestrator.execute(input);

    expect(mockScheduler.schedule).toHaveBeenCalledTimes(2);
    // First attempt: deferFailFastUntilLogicalResult should be false or undefined
    expect(mockScheduler.schedule.mock.calls[0][1]).toBeDefined();
    expect(mockScheduler.schedule.mock.calls[0][1].deferFailFastUntilLogicalResult).toBe(false);

    // Second attempt: deferFailFastUntilLogicalResult should be true
    expect(mockScheduler.schedule.mock.calls[1][1]).toBeDefined();
    expect(mockScheduler.schedule.mock.calls[1][1].deferFailFastUntilLogicalResult).toBe(true);
  });

  it("appends schema validation feedback to prompt on subsequent attempts", async () => {
    const validationFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "bad json",
      stderr: "",
      exitCode: 0,
      durationMs: 20,
      artifacts: {
        dir: "agents/my-logical-agent/attempts/1",
        promptPath: "",
        stdoutPath: "",
        stderrPath: "",
        validationErrorPath: "agents/my-logical-agent/attempts/1/validation-error.json"
      },
      error: { name: "ValidationError", message: "Invalid schema", code: "SCHEMA_VALIDATION_FAILED" },
      permissions: { mode: "default" }
    };

    const successResult: AgentResult = {
      ok: true,
      status: "succeeded",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "{}",
      stderr: "",
      exitCode: 0,
      durationMs: 30,
      artifacts: { dir: "agents/my-logical-agent/attempts/2", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" }
    };

    // Mock reading validation error from store
    const errors = [{ instancePath: "/age", message: "must be integer" }];
    writtenFiles.set("agents/my-logical-agent/attempts/1/validation-error.json", errors);

    vi.mocked(mockExecutor.execute)
      .mockResolvedValueOnce(validationFailure)
      .mockResolvedValueOnce(successResult);

    const input = createInput();
    await orchestrator.execute(input);

    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
    // Verifying prompt passed to second attempt has feedback
    const secondExecInput = vi.mocked(mockExecutor.execute).mock.calls[1][0];
    expect(secondExecInput.prompt).toContain("failed JSON Schema validation");
    expect(secondExecInput.prompt).toContain("must be integer");
  });

  it("waits for the computed delay before the next attempt when delay is enabled", async () => {
    const retryableFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "provider failed",
      exitCode: 1,
      durationMs: 20,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "ProviderProcessFailed", message: "Failed", code: "PROVIDER_PROCESS_FAILED" },
      permissions: { mode: "default" }
    };

    const successResult: AgentResult = {
      ok: true,
      status: "succeeded",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "recovered",
      stderr: "",
      exitCode: 0,
      durationMs: 30,
      artifacts: { dir: "agents/my-logical-agent/attempts/2", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute)
      .mockResolvedValueOnce(retryableFailure)
      .mockResolvedValueOnce(successResult);

    const input = createInput({
      policy: {
        maxAttempts: 2,
        delayMs: 1500,
        backoff: "fixed",
        maxDelayMs: 5000,
        jitter: false,
        disableDelay: false
      }
    });

    const promise = orchestrator.execute(input);

    await vi.runAllTicks();
    await vi.runAllTicks();

    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(result.ok).toBe(true);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
    expect(result.retry?.attempts[0].computedDelayBeforeNextAttemptMs).toBe(1500);
    expect(result.retry?.attempts[0].delaySkipped).toBeUndefined();
  });

  it("skips waiting but preserves the computed delay metadata when disableDelay is true", async () => {
    const retryableFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "provider failed",
      exitCode: 1,
      durationMs: 20,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "ProviderProcessFailed", message: "Failed", code: "PROVIDER_PROCESS_FAILED" },
      permissions: { mode: "default" }
    };

    const successResult: AgentResult = {
      ok: true,
      status: "succeeded",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "recovered",
      stderr: "",
      exitCode: 0,
      durationMs: 30,
      artifacts: { dir: "agents/my-logical-agent/attempts/2", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute)
      .mockResolvedValueOnce(retryableFailure)
      .mockResolvedValueOnce(successResult);

    const input = createInput({
      policy: {
        maxAttempts: 2,
        delayMs: 2000,
        backoff: "fixed",
        maxDelayMs: 5000,
        jitter: false,
        disableDelay: true
      }
    });

    const start = Date.now();
    const result = await orchestrator.execute(input);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(100);
    expect(result.ok).toBe(true);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
    expect(result.retry?.attemptsStarted).toBe(2);

    expect(result.retry?.attempts[0].computedDelayBeforeNextAttemptMs).toBe(2000);
    expect(result.retry?.attempts[0].delaySkipped).toBe(true);
  });

  it("aborts the retry loop immediately if cancellation arrives during the wait", async () => {
    const retryableFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "provider failed",
      exitCode: 1,
      durationMs: 20,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "ProviderProcessFailed", message: "Failed", code: "PROVIDER_PROCESS_FAILED" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute).mockResolvedValue(retryableFailure);

    const controller = new AbortController();
    const input = createInput({
      policy: {
        maxAttempts: 3,
        delayMs: 5000,
        backoff: "fixed",
        maxDelayMs: 10000,
        jitter: false,
        disableDelay: false
      }
    });
    input.signal = controller.signal;

    const promise = orchestrator.execute(input);

    await vi.runAllTicks();
    await vi.runAllTicks();
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);

    controller.abort();

    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.status).toBe("cancelled");
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);

    expect(result.retry?.attemptsStarted).toBe(1);
    expect(result.retry?.attempts[0].status).toBe("cancelled");
  });

  it("computes and passes exponential delay values correctly", async () => {
    const retryableFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "provider failed",
      exitCode: 1,
      durationMs: 20,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "ProviderProcessFailed", message: "Failed", code: "PROVIDER_PROCESS_FAILED" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute).mockResolvedValue(retryableFailure);

    const input = createInput({
      policy: {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: "exponential",
        maxDelayMs: 10000,
        jitter: false,
        disableDelay: true
      }
    });

    const result = await orchestrator.execute(input);

    expect(result.retry?.attempts[0].computedDelayBeforeNextAttemptMs).toBe(1000);
    expect(result.retry?.attempts[1].computedDelayBeforeNextAttemptMs).toBe(2000);
  });

  it("caps exponential delays correctly using maxDelayMs", async () => {
    const retryableFailure: AgentResult = {
      ok: false,
      status: "failed",
      id: "my-logical-agent",
      provider: "mock",
      stdout: "",
      stderr: "provider failed",
      exitCode: 1,
      durationMs: 20,
      artifacts: { dir: "agents/my-logical-agent/attempts/1", promptPath: "", stdoutPath: "", stderrPath: "" },
      error: { name: "ProviderProcessFailed", message: "Failed", code: "PROVIDER_PROCESS_FAILED" },
      permissions: { mode: "default" }
    };

    vi.mocked(mockExecutor.execute).mockResolvedValue(retryableFailure);

    const input = createInput({
      policy: {
        maxAttempts: 3,
        delayMs: 2000,
        backoff: "exponential",
        maxDelayMs: 3000,
        jitter: false,
        disableDelay: true
      }
    });

    const result = await orchestrator.execute(input);

    expect(result.retry?.attempts[0].computedDelayBeforeNextAttemptMs).toBe(2000);
    expect(result.retry?.attempts[1].computedDelayBeforeNextAttemptMs).toBe(3000);
  });
});
