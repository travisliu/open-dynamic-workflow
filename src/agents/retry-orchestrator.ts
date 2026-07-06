import type { AgentExecutor } from "./execution-types.js";
import type { AgentResult, AgentSuccessResult, AgentFailureResult, AgentPermissions } from "../types/agent.js";
import type { JsonSchema, ProviderName } from "../types/common.js";
import type { StructuredOutputConfig } from "../types/agent.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";
import type {
  RetryMetadata,
  RetryPolicy,
  ResolvedRetryPolicy,
  RetryAttemptSummary,
  RetrySummaryArtifact,
  RetryAttemptStatus,
  InternalAttemptFailureReason
} from "../types/retry.js";
import type { Scheduler } from "../types/scheduler.js";
import type { RunLimitTracker } from "../workflow/run-limits.js";
import type { ArtifactStore } from "../types/artifacts.js";
import { EventBus } from "../orchestration/event-bus.js";
import { classifyAttemptFailure } from "./attempt-classifier.js";
import { redactText, collectSecretValues } from "../security/env.js";
import { computeRetryDelay, sleepRetryDelay } from "./retry-delay.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface RetryOrchestratorInput {
  logicalAgentId: string;
  label?: string;
  provider: ProviderName;
  model?: string;
  basePrompt: string;
  schema?: JsonSchema;
  structuredOutput?: StructuredOutputConfig;
  timeoutMs: number;
  cwd: string;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
  thinkingEffort?: ThinkingEffort;
  retry: ResolvedRetryPolicy;
  scheduler: Scheduler;
  runLimits: RunLimitTracker;
  artifactStore: ArtifactStore;
  eventBus: EventBus;
  signal: AbortSignal;
  failFast: boolean;
}

export class RetryOrchestrator {
  private readonly executor: AgentExecutor;

  constructor(deps: { executor: AgentExecutor }) {
    this.executor = deps.executor;
  }

  async execute(input: RetryOrchestratorInput): Promise<AgentResult> {
    const resolvedRetry = input.retry;
    const policy = resolvedRetry.policy;
    const maxAttempts = resolvedRetry.enabled ? policy.maxAttempts : 1;

    const attempts: RetryAttemptSummary[] = [];
    let attemptsStarted = 0;
    let finalStatus: RetryAttemptStatus = "skipped";
    let finalFailureReason: InternalAttemptFailureReason | string | undefined = undefined;
    let finalResult: AgentResult | undefined = undefined;
    let exhausted = false;

    const logicalDir = `agents/${input.logicalAgentId}`;
    const secretValues = collectSecretValues(process.env);

    let attemptNum = 1;
    let currentPrompt = input.basePrompt;

    while (attemptNum <= maxAttempts) {
      if (input.signal.aborted) {
        finalStatus = "cancelled";
        finalFailureReason = "cancelled";
        break;
      }

      const attemptDir = `${logicalDir}/attempts/${attemptNum}`;
      const startedAt = new Date().toISOString();
      attemptsStarted++;

      let runLimitError: any = null;
      try {
        input.runLimits.beforeAgentSchedule(input.logicalAgentId);
      } catch (err: any) {
        runLimitError = err;
      }

      if (runLimitError) {
        const durationMs = 0;
        const errorPayload = {
          name: runLimitError.name || "RunLimitExceeded",
          message: runLimitError.message || "Run limit exceeded",
          code: runLimitError.code || "RUN_LIMIT_EXCEEDED"
        };

        const failureResult: AgentFailureResult = {
          ok: false,
          status: "failed",
          id: input.logicalAgentId,
          stdout: "",
          stderr: runLimitError.message || "Run limit exceeded",
          exitCode: null,
          durationMs,
          artifacts: {
            dir: attemptDir,
            promptPath: `${attemptDir}/prompt.txt`,
            stdoutPath: `${attemptDir}/stdout.log`,
            stderrPath: `${attemptDir}/stderr.log`
          },
          error: errorPayload,
          permissions: input.permissions,
          provider: input.provider
        };
        if (input.label !== undefined) failureResult.label = input.label;
        if (input.model !== undefined) failureResult.model = input.model;
        if (input.metadata !== undefined) failureResult.metadata = input.metadata;

        const attemptSummary: RetryAttemptSummary = {
          attempt: attemptNum,
          status: "failed",
          retryable: false,
          failureReason: "run_limit_exceeded",
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs,
          artifactPath: attemptDir
        };
        attempts.push(attemptSummary);

        finalStatus = "failed";
        finalFailureReason = "run_limit_exceeded";
        finalResult = failureResult;
        exhausted = attemptNum === maxAttempts;
        break;
      }

      // Emit event: agent.attempt.started
      await input.eventBus.emit("agent.attempt.started" as any, {
        agentId: input.logicalAgentId,
        label: input.label,
        attempt: attemptNum,
        maxAttempts
      });

      const attemptTask: any = {
        id: `${input.logicalAgentId}_attempt_${attemptNum}`,
        provider: input.provider,
        permissions: input.permissions,
        run: async (attemptSignal: AbortSignal) => {
          const execInput: any = {
            id: input.logicalAgentId,
            provider: input.provider,
            prompt: currentPrompt,
            timeoutMs: input.timeoutMs,
            cwd: input.cwd,
            permissions: input.permissions,
            signal: attemptSignal,
            artifacts: {
              baseDir: attemptDir,
              logicalDir,
              attempt: attemptNum
            }
          };
          if (input.label !== undefined) execInput.label = input.label;
          if (input.model !== undefined) execInput.model = input.model;
          if (input.schema !== undefined) execInput.schema = input.schema;
          if (input.structuredOutput !== undefined) execInput.structuredOutput = input.structuredOutput;
          if (input.thinkingEffort !== undefined) execInput.thinkingEffort = input.thinkingEffort;
          if (input.metadata !== undefined) execInput.metadata = input.metadata;

          return await this.executor.execute(execInput);
        }
      };
      if (input.label !== undefined) attemptTask.label = input.label;
      if (input.model !== undefined) attemptTask.model = input.model;
      if (input.metadata !== undefined) attemptTask.metadata = input.metadata;

      const scheduleOptions: any = {
        provider: input.provider,
        timeoutMs: input.timeoutMs,
        cwd: input.cwd,
        deferFailFastUntilLogicalResult: attemptNum > 1,
        attempt: {
          logicalAgentId: input.logicalAgentId,
          attempt: attemptNum,
          artifactDir: attemptDir
        }
      };
      if (input.model !== undefined) scheduleOptions.model = input.model;

      const attemptResultPromise = input.scheduler.schedule<AgentResult>(attemptTask, scheduleOptions);

      let attemptResult: AgentResult;
      try {
        attemptResult = await attemptResultPromise;
      } catch (err: any) {
        const durationMs = Date.now() - new Date(startedAt).getTime();
        const failureResult: AgentFailureResult = {
          ok: false,
          status: "failed",
          id: input.logicalAgentId,
          provider: input.provider,
          stdout: "",
          stderr: err.message || String(err),
          exitCode: null,
          durationMs,
          artifacts: {
            dir: attemptDir,
            promptPath: `${attemptDir}/prompt.txt`,
            stdoutPath: `${attemptDir}/stdout.log`,
            stderrPath: `${attemptDir}/stderr.log`
          },
          error: {
            name: err.name || "Error",
            message: err.message || String(err),
            code: err.code || "INTERNAL_ERROR"
          },
          permissions: input.permissions
        };
        if (input.label !== undefined) failureResult.label = input.label;
        if (input.model !== undefined) failureResult.model = input.model;
        if (input.metadata !== undefined) failureResult.metadata = input.metadata;

        attemptResult = failureResult;
      }

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - new Date(startedAt).getTime();

      const classification = classifyAttemptFailure({ result: attemptResult });

      const attemptSummary: RetryAttemptSummary = {
        attempt: attemptNum,
        status: attemptResult.status as RetryAttemptStatus,
        retryable: classification.retryable,
        startedAt,
        completedAt,
        durationMs,
        artifactPath: attemptDir
      };
      if (attemptResult.ok === false) {
        attemptSummary.failureReason = classification.reason;
      }

      if (attemptResult.ok) {
        attempts.push(attemptSummary);
        finalStatus = "succeeded";
        finalResult = attemptResult;

        await input.eventBus.emit("agent.attempt.completed" as any, {
          agentId: input.logicalAgentId,
          attempt: attemptNum,
          status: "succeeded",
          durationMs
        });
        break;
      } else {
        await input.eventBus.emit("agent.attempt.failed" as any, {
          agentId: input.logicalAgentId,
          attempt: attemptNum,
          error: attemptResult.error,
          reason: classification.reason
        });

        if (input.signal.aborted) {
          attemptSummary.status = "cancelled";
          attempts.push(attemptSummary);
          finalStatus = "cancelled";
          finalFailureReason = "cancelled";
          finalResult = attemptResult;
          break;
        }

        const canRetry = classification.retryable && attemptNum < maxAttempts;

        if (canRetry) {
          const delayMetadata = computeRetryDelay(policy, attemptNum);
          attemptSummary.computedDelayBeforeNextAttemptMs = delayMetadata.delayMs;

          if (input.signal.aborted) {
            attemptSummary.status = "cancelled";
            attempts.push(attemptSummary);
            finalStatus = "cancelled";
            finalFailureReason = "cancelled";
            finalResult = attemptResult;
            break;
          }

          if (policy.disableDelay) {
            attemptSummary.delaySkipped = true;
            await input.eventBus.emit("agent.retry.skipped_delay" as any, {
              agentId: input.logicalAgentId,
              nextAttempt: attemptNum + 1,
              delayMs: delayMetadata.delayMs
            });
          } else {
            await input.eventBus.emit("agent.retry.scheduled" as any, {
              agentId: input.logicalAgentId,
              nextAttempt: attemptNum + 1,
              delayMs: delayMetadata.delayMs
            });

            try {
              await sleepRetryDelay(delayMetadata.delayMs, input.signal);
            } catch (err: any) {
              attemptSummary.status = "cancelled";
              attempts.push(attemptSummary);
              finalStatus = "cancelled";
              finalFailureReason = "cancelled";
              finalResult = attemptResult;
              break;
            }
          }

          // Build next prompt with schema feedback if schema validation failed
          if (classification.reason === "schema_validation_failed" && attemptResult.ok === false) {
            let validationErrors: any[] = [];
            if (attemptResult.artifacts.validationErrorPath) {
              try {
                if (typeof (input.artifactStore as any).readJson === "function") {
                  validationErrors = await (input.artifactStore as any).readJson(attemptResult.artifacts.validationErrorPath) as any[];
                } else {
                  const runArtifacts = input.artifactStore.getRunArtifacts();
                  const fullPath = path.resolve(runArtifacts.rootDir, attemptResult.artifacts.validationErrorPath);
                  const fileContent = await fs.readFile(fullPath, "utf8");
                  validationErrors = JSON.parse(fileContent) as any[];
                }
              } catch {
                // Ignore read errors
              }
            }
            const feedbackText = buildSchemaRetryFeedback(validationErrors);
            const redactedFeedback = redactText(feedbackText, secretValues);
            currentPrompt = `${input.basePrompt}\n\n${redactedFeedback}`;
          }

          attempts.push(attemptSummary);
          attemptNum++;
        } else {
          attempts.push(attemptSummary);
          finalStatus = attemptResult.status as any;
          finalFailureReason = classification.reason;
          finalResult = attemptResult;
          exhausted = true;
          break;
        }
      }
    }

    if (!finalResult) {
      // Fallback in case of signal abort before loop or zero attempts run
      const durationMs = 0;
      const failureResult: AgentFailureResult = {
        ok: false,
        status: finalStatus as any,
        id: input.logicalAgentId,
        provider: input.provider,
        stdout: "",
        stderr: input.signal.reason ? String(input.signal.reason) : "Execution stopped",
        exitCode: null,
        durationMs,
        artifacts: {
          dir: `${logicalDir}/attempts/1`,
          promptPath: `${logicalDir}/attempts/1/prompt.txt`,
          stdoutPath: `${logicalDir}/attempts/1/stdout.log`,
          stderrPath: `${logicalDir}/attempts/1/stderr.log`
        },
        error: {
          name: "CancelledError",
          message: input.signal.reason ? String(input.signal.reason) : "Execution stopped",
          code: "USER_CANCELLED"
        },
        permissions: input.permissions
      };
      if (input.label !== undefined) failureResult.label = input.label;
      if (input.model !== undefined) failureResult.model = input.model;
      if (input.metadata !== undefined) failureResult.metadata = input.metadata;

      finalResult = failureResult;
    }

    if (finalStatus === "cancelled" && finalResult) {
      finalResult.status = "cancelled";
    }

    // Attach retry metadata to final result
    const retryMetadata: RetryMetadata = {
      enabled: resolvedRetry.enabled,
      exhausted,
      maxAttempts,
      attemptsStarted,
      finalAttempt: attemptNum <= maxAttempts ? attemptNum : maxAttempts,
      summaryPath: `${logicalDir}/retry-summary.json`,
      attempts
    };
    if (finalResult.ok === false && finalFailureReason !== undefined) {
      retryMetadata.finalFailureReason = finalFailureReason;
    }

    finalResult.retry = retryMetadata;

    // Write retry-summary.json
    const summaryArtifact: RetrySummaryArtifact = {
      schemaVersion: "open-dynamic-workflow.retry-summary.v1",
      enabled: resolvedRetry.enabled,
      exhausted,
      maxAttempts,
      attemptsStarted,
      finalAttempt: retryMetadata.finalAttempt,
      finalStatus: finalStatus as any,
      policy,
      attempts
    };
    if (retryMetadata.finalFailureReason !== undefined) {
      summaryArtifact.finalFailureReason = retryMetadata.finalFailureReason;
    }

    await input.artifactStore.writeJson(`${logicalDir}/retry-summary.json`, summaryArtifact);

    // Write final result.json to the logical directory
    await input.artifactStore.writeJson(`${logicalDir}/result.json`, finalResult);

    // If logical result is failed and failFast is enabled, trigger failFast on scheduler
    if (!finalResult.ok && input.failFast) {
      input.scheduler.abort({
        type: "fail-fast",
        message: `Fail-fast triggered by final logical failure of agent ${input.logicalAgentId}`,
        source: input.logicalAgentId,
        cause: finalStatus === "timed_out" ? "timeout" : "failure"
      });
    }

    return finalResult;
  }
}

function buildSchemaRetryFeedback(validationErrors: any[]): string {
  if (!validationErrors || validationErrors.length === 0) {
    return "The output failed schema validation. Please ensure you return a valid JSON object matching the requested schema.";
  }

  const formattedErrors = validationErrors.map((err, index) => {
    const pathStr = err.instancePath ? ` at ${err.instancePath}` : "";
    return `${index + 1}. Error${pathStr}: ${err.message || String(err)}`;
  });

  return [
    "Your previous response failed JSON Schema validation with the following error(s):",
    ...formattedErrors,
    "",
    "Please fix these errors in your next response. Make sure to return exactly one valid JSON object matching the requested schema. Do not output any thinking or extra text outside the JSON."
  ].join("\n");
}
