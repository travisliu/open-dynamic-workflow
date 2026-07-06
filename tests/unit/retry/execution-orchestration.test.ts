import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyAttemptFailure } from "../../../src/agents/attempt-classifier.js";
import { RetryOrchestrator } from "../../../src/agents/retry-orchestrator.js";
import { DefaultAgentExecutor } from "../../../src/agents/execute-agent.js";
import { DefaultScheduler } from "../../../src/orchestration/scheduler.js";
import { FileSystemArtifactStore } from "../../../src/artifacts/run-store.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { RunLimitTracker } from "../../../src/workflow/run-limits.js";
import type { AgentResult } from "../../../src/types/agent.js";
import type { ResolvedRetryPolicy } from "../../../src/types/retry.js";

describe("Retry execution orchestration and failure classification (Phase 3)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "phase-3-retry-acceptance-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createArtifacts(baseDir: string) {
    return {
      dir: baseDir,
      promptPath: `${baseDir}/prompt.txt`,
      stdoutPath: `${baseDir}/stdout.log`,
      stderrPath: `${baseDir}/stderr.log`
    };
  }

  function createAgentResult(input: {
    ok: boolean;
    status: AgentResult["status"];
    exitCode: number | null;
    errorCode?: string;
    errorName?: string;
    errorMessage?: string;
    artifacts?: ReturnType<typeof createArtifacts>;
  }): AgentResult {
    const baseArtifacts = input.artifacts ?? createArtifacts("agents/phase-3-agent/attempts/1");
    return {
      id: "phase-3-agent",
      provider: "mock",
      stdout: "",
      stderr: "",
      durationMs: 10,
      exitCode: input.exitCode,
      ok: input.ok,
      status: input.status,
      artifacts: baseArtifacts,
      permissions: { mode: "default" },
      error: input.ok
        ? undefined
        : {
            name: input.errorName ?? "Error",
            message: input.errorMessage ?? "failure",
            code: input.errorCode ?? "INTERNAL_ERROR"
          }
    } as AgentResult;
  }

  function createRecordingArtifactStore() {
    const writes = new Map<string, unknown>();
    const runArtifacts = {
      runId: "phase-3-run",
      rootDir: "/virtual/phase-3-run",
      manifestPath: "/virtual/phase-3-run/manifest.json",
      workflowInputPath: "/virtual/phase-3-run/workflow.input.ts",
      resolvedConfigPath: "/virtual/phase-3-run/config.resolved.json",
      runInputPath: "/virtual/phase-3-run/run-input.json",
      callsPath: "/virtual/phase-3-run/calls.jsonl",
      cacheIndexPath: "/virtual/phase-3-run/cache-index.json",
      eventsPath: "/virtual/phase-3-run/events.jsonl",
      reportPath: "/virtual/phase-3-run/report.json",
      agentDir: (agentId: string) => `agents/${agentId}`,
      toolDir: (toolCallId: string) => `tools/${toolCallId}`,
      workflowInvocationDir: (workflowInvocationId: string) => `workflows/${workflowInvocationId}`
    };

    const store = {
      writes,
      createRun: vi.fn().mockResolvedValue(runArtifacts),
      writeText: vi.fn(async (relativePath: string, content: string) => {
        writes.set(relativePath, content);
        return relativePath;
      }),
      appendText: vi.fn(async (relativePath: string, content: string) => {
        const current = String(writes.get(relativePath) ?? "");
        writes.set(relativePath, current + content);
        return relativePath;
      }),
      writeJson: vi.fn(async (relativePath: string, value: unknown) => {
        writes.set(relativePath, value);
        return relativePath;
      }),
      appendJsonl: vi.fn(async (relativePath: string, value: unknown) => {
        const current = String(writes.get(relativePath) ?? "");
        writes.set(relativePath, `${current}${JSON.stringify(value)}\n`);
        return relativePath;
      }),
      writeFinalReport: vi.fn().mockResolvedValue("/virtual/phase-3-run/report.json"),
      updateManifest: vi.fn().mockResolvedValue("/virtual/phase-3-run/manifest.json"),
      getRunArtifacts: vi.fn().mockReturnValue(runArtifacts),
      isRunCreated: vi.fn().mockReturnValue(true)
    };

    return store;
  }

  it("should classify transient failures (e.g. process crashes, schema failures) as retryable", () => {
    // Arrange
    const cases = [
      createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "PROVIDER_PROCESS_FAILED",
        errorName: "ProviderProcessFailed"
      }),
      createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "PROCESS_SPAWN_FAILED",
        errorName: "ProcessError"
      }),
      createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "PARSE_ERROR",
        errorName: "ParseError"
      }),
      createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "SCHEMA_VALIDATION_FAILED",
        errorName: "ValidationError"
      })
    ];

    // Act
    const classifications = cases.map((result) => classifyAttemptFailure({ result }));

    // Assert
    expect(classifications).toEqual([
      expect.objectContaining({ reason: "provider_error", retryable: true }),
      expect.objectContaining({ reason: "process_error", retryable: true }),
      expect.objectContaining({ reason: "malformed_output", retryable: true }),
      expect.objectContaining({ reason: "schema_validation_failed", retryable: true })
    ]);
  });

  it("should classify fatal errors (e.g. timeouts, cancellations, bad config) as non-retryable", () => {
    // Arrange
    const cases = [
      createAgentResult({
        ok: false,
        status: "timed_out",
        exitCode: null,
        errorCode: "PROCESS_TIMEOUT",
        errorName: "TimeoutError"
      }),
      createAgentResult({
        ok: false,
        status: "cancelled",
        exitCode: null,
        errorCode: "USER_CANCELLED",
        errorName: "CancelledError"
      }),
      createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "CONFIG_VALIDATION_ERROR",
        errorName: "ConfigError"
      }),
      createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "WORKFLOW_VALIDATION_ERROR",
        errorName: "WorkflowError"
      }),
      createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "SECURITY_POLICY_VIOLATION",
        errorName: "SecurityViolation"
      }),
      createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "RUN_LIMIT_EXCEEDED",
        errorName: "RunLimitExceeded"
      })
    ];

    // Act
    const classifications = cases.map((result) => classifyAttemptFailure({ result }));

    // Assert
    expect(classifications).toEqual([
      expect.objectContaining({ reason: "timed_out", retryable: false }),
      expect.objectContaining({ reason: "cancelled", retryable: false }),
      expect.objectContaining({ reason: "invalid_configuration", retryable: false }),
      expect.objectContaining({ reason: "invalid_workflow", retryable: false }),
      expect.objectContaining({ reason: "security_policy_violation", retryable: false }),
      expect.objectContaining({ reason: "run_limit_exceeded", retryable: false })
    ]);
  });

  it("should route each attempt execution through the scheduler and capture attempt-level metadata", async () => {
    // Arrange
    const artifactStore = createRecordingArtifactStore();
    const runLimits = new RunLimitTracker({ maxAgentCalls: 10 });
    const beforeScheduleSpy = vi.spyOn(runLimits, "beforeAgentSchedule");
    const scheduler = {
      schedule: vi.fn(async (task: { run: (signal: AbortSignal) => Promise<AgentResult> }, options: any) => {
        return await task.run(new AbortController().signal);
      }),
      abort: vi.fn(),
      drain: vi.fn()
    };
    const executor = {
      execute: vi.fn()
        .mockResolvedValueOnce(
          createAgentResult({
            ok: false,
            status: "failed",
            exitCode: 1,
            errorCode: "PROVIDER_PROCESS_FAILED",
            errorName: "ProviderProcessFailed"
          })
        )
        .mockResolvedValueOnce(
          createAgentResult({
            ok: true,
            status: "succeeded",
            exitCode: 0,
            artifacts: createArtifacts("agents/phase-3-agent/attempts/2")
          })
        )
    };
    const orchestrator = new RetryOrchestrator({ executor: executor as any });
    const retry: ResolvedRetryPolicy = {
      enabled: true,
      source: "agent",
      policy: {
        maxAttempts: 3,
        delayMs: 0,
        maxDelayMs: 0,
        backoff: "fixed",
        jitter: false,
        disableDelay: true
      }
    };

    // Act
    const result = await orchestrator.execute({
      logicalAgentId: "phase-3-agent",
      label: "Phase 3 Agent",
      provider: "mock",
      model: "mock-model",
      basePrompt: "do the thing",
      timeoutMs: 1000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      retry,
      scheduler: scheduler as any,
      runLimits,
      artifactStore: artifactStore as any,
      eventBus: { emit: vi.fn().mockResolvedValue(undefined) } as any,
      signal: new AbortController().signal,
      failFast: false
    });

    // Assert
    expect(result.ok).toBe(true);
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    expect(beforeScheduleSpy).toHaveBeenCalledTimes(2);
    expect(beforeScheduleSpy.mock.invocationCallOrder[0]).toBeLessThan(scheduler.schedule.mock.invocationCallOrder[0]);
    expect(beforeScheduleSpy.mock.invocationCallOrder[1]).toBeLessThan(scheduler.schedule.mock.invocationCallOrder[1]);
    expect(scheduler.schedule.mock.calls[0][1]).toEqual(
      expect.objectContaining({ deferFailFastUntilLogicalResult: true })
    );
    expect(scheduler.schedule.mock.calls[1][1]).toEqual(
      expect.objectContaining({ deferFailFastUntilLogicalResult: true })
    );
    expect(result.retry).toEqual(
      expect.objectContaining({
        attemptsStarted: 2,
        exhausted: false,
        finalAttempt: 2
      })
    );
    expect(result.retry?.attempts).toEqual([
      expect.objectContaining({ attempt: 1, status: "failed", retryable: true, failureReason: "provider_error" }),
      expect.objectContaining({ attempt: 2, status: "succeeded", retryable: false })
    ]);
    expect(artifactStore.writes.get("agents/phase-3-agent/retry-summary.json")).toEqual(
      expect.objectContaining({
        enabled: true,
        exhausted: false,
        maxAttempts: 3,
        attemptsStarted: 2,
        finalAttempt: 2,
        finalStatus: "succeeded"
      })
    );
    expect(artifactStore.writes.get("agents/phase-3-agent/result.json")).toEqual(
      expect.objectContaining({ ok: true, status: "succeeded" })
    );
    expect(runLimits.summary()).toEqual({
      limits: { maxAgentCalls: 10 },
      agentCalls: 2,
      exceeded: false
    });
  });

  it("should calculate and record the aggregated logical duration across all attempts", async () => {
    const artifactStore = createRecordingArtifactStore();
    const runLimits = new RunLimitTracker({ maxAgentCalls: 10 });
    const scheduler = {
      schedule: vi.fn(async (task: { run: (signal: AbortSignal) => Promise<AgentResult> }) => {
        return await task.run(new AbortController().signal);
      }),
      abort: vi.fn(),
      drain: vi.fn()
    };
    const executor = {
      execute: vi.fn()
        .mockResolvedValueOnce(
          createAgentResult({
            ok: false,
            status: "failed",
            exitCode: 1,
            errorCode: "PROVIDER_PROCESS_FAILED",
            errorName: "ProviderProcessFailed"
          })
        )
        .mockResolvedValueOnce(
          createAgentResult({
            ok: true,
            status: "succeeded",
            exitCode: 0,
            artifacts: createArtifacts("agents/phase-3-agent/attempts/2")
          })
        )
    };
    const orchestrator = new RetryOrchestrator({ executor: executor as any });

    const result = await orchestrator.execute({
      logicalAgentId: "phase-3-agent",
      label: "Phase 3 Agent",
      provider: "mock",
      model: "mock-model",
      basePrompt: "do the thing",
      timeoutMs: 1000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      retry: {
        enabled: true,
        source: "agent",
        policy: {
          maxAttempts: 2,
          delayMs: 10,
          maxDelayMs: 10,
          backoff: "fixed",
          jitter: false,
          disableDelay: false
        }
      },
      scheduler: scheduler as any,
      runLimits,
      artifactStore: artifactStore as any,
      eventBus: { emit: vi.fn().mockResolvedValue(undefined) } as any,
      signal: new AbortController().signal,
      failFast: false
    });

    expect(result.ok).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(artifactStore.writes.get("agents/phase-3-agent/result.json")).toEqual(
      expect.objectContaining({
        ok: true,
        status: "succeeded",
        durationMs: result.durationMs
      })
    );
  });

  it("should halt retries upon encountering a terminal failure, deferring scheduler fail-fast until the final outcome", async () => {
    // Arrange
    const artifactStore = createRecordingArtifactStore();
    const runLimits = new RunLimitTracker({ maxAgentCalls: 10 });
    const beforeScheduleSpy = vi.spyOn(runLimits, "beforeAgentSchedule");
    const scheduler = {
      schedule: vi.fn(async (task: { run: (signal: AbortSignal) => Promise<AgentResult> }) => {
        return await task.run(new AbortController().signal);
      }),
      abort: vi.fn(),
      drain: vi.fn()
    };
    const executor = {
      execute: vi.fn().mockResolvedValue(
        createAgentResult({
          ok: false,
          status: "timed_out",
          exitCode: null,
          errorCode: "PROCESS_TIMEOUT",
          errorName: "TimeoutError"
        })
      )
    };
    const orchestrator = new RetryOrchestrator({ executor: executor as any });

    // Act
    const result = await orchestrator.execute({
      logicalAgentId: "phase-3-agent",
      label: "Phase 3 Agent",
      provider: "mock",
      model: "mock-model",
      basePrompt: "do the thing",
      timeoutMs: 1000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      retry: {
        enabled: true,
        source: "agent",
        policy: {
          maxAttempts: 3,
          delayMs: 0,
          maxDelayMs: 0,
          backoff: "fixed",
          jitter: false,
          disableDelay: true
        }
      },
      scheduler: scheduler as any,
      runLimits,
      artifactStore: artifactStore as any,
      eventBus: { emit: vi.fn().mockResolvedValue(undefined) } as any,
      signal: new AbortController().signal,
      failFast: true
    });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.status).toBe("timed_out");
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    expect(beforeScheduleSpy).toHaveBeenCalledTimes(1);
    expect(result.retry).toEqual(
      expect.objectContaining({
        attemptsStarted: 1,
        exhausted: true,
        finalAttempt: 1,
        finalFailureReason: "timed_out"
      })
    );
    expect(scheduler.abort).toHaveBeenCalledTimes(1);
    expect(scheduler.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "fail-fast",
        source: "phase-3-agent",
        cause: "timeout"
      })
    );
    expect(artifactStore.writes.get("agents/phase-3-agent/result.json")).toEqual(
      expect.objectContaining({ ok: false, status: "timed_out" })
    );
  });

  it("should handle global cancellation signals during the retry delay, returning a cancelled result status", async () => {
    const artifactStore = createRecordingArtifactStore();
    const runLimits = new RunLimitTracker({ maxAgentCalls: 10 });
    const scheduler = {
      schedule: vi.fn(async (task: { run: (signal: AbortSignal) => Promise<AgentResult> }) => {
        return await task.run(new AbortController().signal);
      }),
      abort: vi.fn(),
      drain: vi.fn()
    };
    const executor = {
      execute: vi.fn().mockResolvedValue(
        createAgentResult({
          ok: false,
          status: "failed",
          exitCode: 1,
          errorCode: "PROVIDER_PROCESS_FAILED",
          errorName: "ProviderProcessFailed"
        })
      )
    };
    const orchestrator = new RetryOrchestrator({ executor: executor as any });
    const controller = new AbortController();
    const eventBus = {
      emit: vi.fn().mockResolvedValue(undefined)
    };

    const resultPromise = orchestrator.execute({
      logicalAgentId: "phase-3-agent",
      label: "Phase 3 Agent",
      provider: "mock",
      model: "mock-model",
      basePrompt: "do the thing",
      timeoutMs: 1000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      retry: {
        enabled: true,
        source: "agent",
        policy: {
          maxAttempts: 3,
          delayMs: 50,
          maxDelayMs: 50,
          backoff: "fixed",
          jitter: false,
          disableDelay: false
        }
      },
      scheduler: scheduler as any,
      runLimits,
      artifactStore: artifactStore as any,
      eventBus: eventBus as any,
      signal: controller.signal,
      failFast: false
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(result.status).toBe("cancelled");
    expect(result.error.code).toBe(ErrorCode.USER_CANCELLED);
    expect(result.exitCode).toBeNull();
    expect(artifactStore.writes.get("agents/phase-3-agent/result.json")).toEqual(
      expect.objectContaining({
        ok: false,
        status: "cancelled",
        exitCode: null,
        error: expect.objectContaining({ code: ErrorCode.USER_CANCELLED })
      })
    );
  });

  it("should format and save per-attempt logs/artifacts under nested attempt directories", async () => {
    // Arrange
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {
            "phase-3-executor": {
              text: "attempt-specific success"
            }
          }
        }
      }
    };
    const artifactStore = new FileSystemArtifactStore({ rootDir: tempDir });
    const runId = "phase-3-executor-run";
    await artifactStore.createRun({
      runId,
      outDir: tempDir,
      workflowPath: "workflow.ts",
      workflowSource: "",
      workflowHash: "hash",
      resolvedConfig: config,
      openDynamicWorkflowVersion: "1.0.0",
      cwd: process.cwd()
    });
    const eventBus = {
      emit: vi.fn().mockResolvedValue(undefined)
    };
    const executor = new DefaultAgentExecutor({
      config,
      artifactStore,
      eventBus: eventBus as any
    });
    const attemptDir = "agents/phase-3-logical/attempts/2";
    const rootDir = artifactStore.getRunArtifacts().rootDir;

    // Act
    const result = await executor.execute({
      id: "phase-3-executor",
      label: "Phase 3 Executor",
      provider: "mock",
      prompt: "attempt prompt",
      model: "mock-model",
      timeoutMs: 1000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: { attempt: 2 },
      artifacts: {
        baseDir: attemptDir,
        logicalDir: "agents/phase-3-logical",
        attempt: 2
      }
    });

    // Assert
    expect(result.ok).toBe(true);
    expect(result.retry).toBeUndefined();
    expect(result.artifacts.dir).toBe(attemptDir);
    expect(result.artifacts.rawResultPath).toBe(`${attemptDir}/raw-result.json`);
    expect(result.artifacts.normalizedResultPath).toBe(`${attemptDir}/normalized-result.json`);
    expect(result.artifacts.permissionsPath).toBe(`${attemptDir}/permissions.json`);
    expect(result.artifacts.metadataPath).toBe(`${attemptDir}/metadata.json`);
    expect(await readFile(join(rootDir, attemptDir, "prompt.txt"), "utf8")).toBe("attempt prompt");
    expect(await readFile(join(rootDir, attemptDir, "stdout.log"), "utf8")).toBe("attempt-specific success");
    expect(await readFile(join(rootDir, attemptDir, "stderr.log"), "utf8")).toBe("");
    expect(JSON.parse(await readFile(join(rootDir, attemptDir, "metadata.json"), "utf8"))).toEqual(
      expect.objectContaining({ model: "mock-model" })
    );
    expect(JSON.parse(await readFile(join(rootDir, attemptDir, "permissions.json"), "utf8"))).toEqual({
      mode: "default"
    });
    expect(JSON.parse(await readFile(join(rootDir, attemptDir, "raw-result.json"), "utf8"))).toEqual(
      expect.objectContaining({ text: "attempt-specific success" })
    );
    await expect(access(join(rootDir, "agents/phase-3-logical/prompt.txt"))).rejects.toThrow();
  });

  it("should defer scheduler fail-fast propagation while retry attempts are ongoing", async () => {
    // Arrange
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });
    const order: string[] = [];
    const deferredFailure = async () => {
      order.push("deferred-failure");
      return createAgentResult({
        ok: false,
        status: "failed",
        exitCode: 1,
        errorCode: "PROVIDER_PROCESS_FAILED",
        errorName: "ProviderProcessFailed"
      });
    };
    const success = async () => {
      order.push("success");
      return createAgentResult({
        ok: true,
        status: "succeeded",
        exitCode: 0
      });
    };

    // Act
    const deferredPromise = scheduler.schedule(
      { id: "phase-3-deferred", run: deferredFailure },
      { deferFailFastUntilLogicalResult: true }
    );
    const successPromise = scheduler.schedule({ id: "phase-3-success", run: success });
    const [deferredResult, successResult] = await Promise.all([deferredPromise, successPromise]);

    // Assert
    expect(order).toEqual(["deferred-failure", "success"]);
    expect(deferredResult.ok).toBe(false);
    expect(successResult.ok).toBe(true);
    expect(scheduler.getSnapshot().aborted).toBe(false);
  });

  it("should maintain execution across retryable failures even if general scheduler fail-fast is active", async () => {
    const artifactStore = createRecordingArtifactStore();
    const runLimits = new RunLimitTracker({ maxAgentCalls: 10 });
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });
    const abortSpy = vi.spyOn(scheduler, "abort");
    const executor = {
      execute: vi.fn()
        .mockResolvedValueOnce(
          createAgentResult({
            ok: false,
            status: "failed",
            exitCode: 1,
            errorCode: "PROVIDER_PROCESS_FAILED",
            errorName: "ProviderProcessFailed"
          })
        )
        .mockResolvedValueOnce(
          createAgentResult({
            ok: true,
            status: "succeeded",
            exitCode: 0,
            artifacts: createArtifacts("agents/phase-3-agent/attempts/2")
          })
        )
    };
    const orchestrator = new RetryOrchestrator({ executor: executor as any });

    const result = await orchestrator.execute({
      logicalAgentId: "phase-3-agent",
      label: "Phase 3 Agent",
      provider: "mock",
      model: "mock-model",
      basePrompt: "do the thing",
      timeoutMs: 1000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      retry: {
        enabled: true,
        source: "agent",
        policy: {
          maxAttempts: 2,
          delayMs: 0,
          maxDelayMs: 0,
          backoff: "fixed",
          jitter: false,
          disableDelay: true
        }
      },
      scheduler: scheduler as any,
      runLimits,
      artifactStore: artifactStore as any,
      eventBus: { emit: vi.fn().mockResolvedValue(undefined) } as any,
      signal: new AbortController().signal,
      failFast: true
    });

    expect(result.ok).toBe(true);
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(abortSpy).not.toHaveBeenCalled();
    expect(scheduler.getSnapshot().aborted).toBe(false);
  });

  it("should enforce call limits per individual attempt and exit with RUN_LIMIT_EXCEEDED when maxAgentCalls is reached", async () => {
    // Arrange
    const artifactStore = createRecordingArtifactStore();
    const runLimits = new RunLimitTracker({ maxAgentCalls: 2 });
    const beforeScheduleSpy = vi.spyOn(runLimits, "beforeAgentSchedule");
    const scheduler = {
      schedule: vi.fn(async (task: { run: (signal: AbortSignal) => Promise<AgentResult> }) => {
        return await task.run(new AbortController().signal);
      }),
      abort: vi.fn(),
      drain: vi.fn()
    };
    const executor = {
      execute: vi.fn().mockResolvedValue(
        createAgentResult({
          ok: false,
          status: "failed",
          exitCode: 1,
          errorCode: "PROVIDER_PROCESS_FAILED",
          errorName: "ProviderProcessFailed"
        })
      )
    };
    const orchestrator = new RetryOrchestrator({ executor: executor as any });

    // Act
    const result = await orchestrator.execute({
      logicalAgentId: "phase-3-agent",
      label: "Phase 3 Agent",
      provider: "mock",
      model: "mock-model",
      basePrompt: "do the thing",
      timeoutMs: 1000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      retry: {
        enabled: true,
        source: "agent",
        policy: {
          maxAttempts: 4,
          delayMs: 0,
          maxDelayMs: 0,
          backoff: "fixed",
          jitter: false,
          disableDelay: true
        }
      },
      scheduler: scheduler as any,
      runLimits,
      artifactStore: artifactStore as any,
      eventBus: { emit: vi.fn().mockResolvedValue(undefined) } as any,
      signal: new AbortController().signal,
      failFast: true
    });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCode.RUN_LIMIT_EXCEEDED);
    expect(result.retry).toEqual(
      expect.objectContaining({
        attemptsStarted: 3,
        exhausted: false,
        finalAttempt: 3,
        finalFailureReason: "run_limit_exceeded"
      })
    );
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    expect(beforeScheduleSpy).toHaveBeenCalledTimes(3);
    expect(runLimits.summary()).toEqual(
      expect.objectContaining({
        limits: { maxAgentCalls: 2 },
        agentCalls: 2,
        exceeded: true,
        exceededBy: "maxAgentCalls"
      })
    );
    expect(scheduler.abort).toHaveBeenCalledTimes(1);
    expect(scheduler.abort).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "fail-fast",
        source: "phase-3-agent"
      })
    );
    expect(artifactStore.writes.get("agents/phase-3-agent/retry-summary.json")).toEqual(
      expect.objectContaining({
        exhausted: false,
        attemptsStarted: 3,
        finalFailureReason: "run_limit_exceeded"
      })
    );
    expect(artifactStore.writes.get("agents/phase-3-agent/result.json")).toEqual(
      expect.objectContaining({
        ok: false,
        retry: expect.objectContaining({
          finalFailureReason: "run_limit_exceeded"
        })
      })
    );
  });
});
