import { validateAndNormalizeLoopArgs, validateLoopRunResult } from "./validate.js";
import { createLoopId, createRoundId } from "./id.js";
import {
  buildLoopStartedPayload,
  buildLoopRoundStartedPayload,
  buildLoopRoundTerminalPayload,
  buildLoopTerminalPayload,
} from "./events.js";
import {
  writeLoopDefinition,
  writeLoopInitialState,
  writeLoopFinalState,
  writeLoopExecutionRecord,
  writeLoopError,
  writeRoundArtifacts,
} from "./artifacts.js";
import {
  getIsoTimestamp,
  getDurationMs,
  createLoopRoundRecord,
  createLoopExecutionRecord,
  createSettledSuccessEnvelope,
  createSettledFailureEnvelope,
  createLoopExhaustionError,
} from "./results.js";
import { createLoopRoundContext, withActiveLoopContext, getActiveLoopContext, type ActiveLoopContext } from "./context.js";
import {
  buildLoopStartReplayMarker,
  buildLoopRoundReplayMarker,
  recordLoopCacheMarker,
  stableHashJson,
} from "./replay.js";
import { withToolForbidden } from "../workflow/scope.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { getActiveWorkflowInvocation } from "../workflow/invocation-types.js";
import { cloneJsonValue } from "../workflow/json.js";
import { serializeError } from "../errors/serialize.js";
import { buildLoopSummary } from "./summary.js";
import { createPreview } from "../tools/serialization.js";
import { collectSecretValues, redactJsonValue, redactSerializedError } from "../security/env.js";
import type {
  LoopRoundRecord,
  LoopSettledResult,
  LoopStatus,
  LoopRoundStatus,
} from "./types.js";
import type { SerializedError } from "../types/errors.js";
import type { RuntimeState } from "../workflow/types.js";
import type { AgentCallInput, AgentResult } from "../types/agent.js";
import type { WorkflowCallInput } from "../types/workflow.js";
import type { ToolCallInput } from "../types/tool.js";

/**
 * Input for runLoop.
 */
export interface RunLoopInput<TState = unknown> {
  loopInput: unknown;
  runtime: RuntimeState;
  signal: AbortSignal;
  dsl: {
    agent: (input: AgentCallInput) => Promise<AgentResult>;
    workflow: (input: WorkflowCallInput) => Promise<any>;
    tool: (input: ToolCallInput) => Promise<any>;
    log: (message: string, data?: unknown) => void;
  };
  _stateType?: TState;
}

function terminalLoopEventType(status: LoopStatus): "loop.completed" | "loop.failed" | "loop.cancelled" | "loop.timed_out" | "loop.max_rounds" {
  if (status === "failed") return "loop.failed";
  if (status === "cancelled") return "loop.cancelled";
  if (status === "timed_out") return "loop.timed_out";
  if (status === "max_rounds") return "loop.max_rounds";
  return "loop.completed";
}

function terminalRoundEventType(status: LoopRoundStatus): "loop.round.completed" | "loop.round.failed" | "loop.round.cancelled" | "loop.round.timed_out" {
  if (status === "failed") return "loop.round.failed";
  if (status === "cancelled") return "loop.round.cancelled";
  if (status === "timed_out") return "loop.round.timed_out";
  return "loop.round.completed";
}

/**
 * Main loop execution runtime.
 */
export async function runLoop<TState = unknown>(
  input: RunLoopInput<TState>
): Promise<TState | LoopSettledResult<TState>> {
  const { runtime, signal, dsl } = input;
  const secretValues = collectSecretValues(process.env, runtime.config?.security?.redactEnv);

  // 1. Normalize loop input
  const maxRoundsCeiling = runtime.config?.workflow?.maxLoopRounds ?? 20;
  const normalized = validateAndNormalizeLoopArgs<TState>(
    input.loopInput,
    maxRoundsCeiling
  );

  // 2. Allocate loop ID
  const loopId = createLoopId(normalized.label);

  // 3. Link parent cancellation and options.timeoutMs
  let loopSignal = signal;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let timeoutController: AbortController | undefined;
  let parentAbortListener: (() => void) | undefined;

  if (normalized.options.timeoutMs) {
    timeoutController = new AbortController();
    timeoutHandle = setTimeout(() => {
      timeoutController?.abort(
        new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_TIMEOUT, `Loop ${loopId} timed out after ${normalized.options.timeoutMs}ms.`)
      );
    }, normalized.options.timeoutMs);
    
    parentAbortListener = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutController?.abort(signal.reason);
    };
    if (signal.aborted) {
      timeoutController.abort(signal.reason);
    } else {
      signal.addEventListener("abort", parentAbortListener);
    }
    loopSignal = timeoutController.signal;
  }

  const parentLoop = getActiveLoopContext();
  const parentLoopId = parentLoop?.loopId;
  const loopArtifactDir = `loops/${loopId}`;
  const workflowInvocationId = getActiveWorkflowInvocation()?.workflowInvocationId ?? runtime.runId;

  // 4. Clone and validate initialState, capturing JSON-safety runtime failures
  let initialStateCloned: TState;
  try {
    initialStateCloned = cloneJsonValue(normalized.initialState, "initial state") as TState;
  } catch (err: any) {
    const startedAt = getIsoTimestamp();
    // Emit loop.started
    const startedPayloadInput: any = {
      loopId,
      workflowInvocationId,
      label: normalized.label,
      maxRounds: normalized.options.maxRounds,
      artifactPath: loopArtifactDir,
    };
    if (parentLoopId !== undefined) {
      startedPayloadInput.parentLoopId = parentLoopId;
    }
    if (normalized.options.timeoutMs !== undefined) {
      startedPayloadInput.timeoutMs = normalized.options.timeoutMs;
    }

    runtime.eventSink.emit(
      "loop.started",
      buildLoopStartedPayload(startedPayloadInput)
    );

    // Write loop definition loops/<loopId>/loop.json
    await writeLoopDefinition(runtime.artifactStore!, loopId, {
      options: {
        failureMode: normalized.options.failureMode,
        maxRounds: normalized.options.maxRounds,
        timeoutMs: normalized.options.timeoutMs,
      },
    });

    const valError = new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      `Loop '${normalized.label}' initialState is not JSON-safe: ${err.message}`
    );
    const serializedError = serializeError(valError);
    await writeLoopError(runtime.artifactStore!, loopId, serializedError);

    const finishedAt = getIsoTimestamp();
    const durationMs = getDurationMs(startedAt, finishedAt);
    const record = createLoopExecutionRecord<TState>({
      loopId,
      label: normalized.label,
      status: "failed",
      roundsCompleted: 0,
      maxRounds: normalized.options.maxRounds,
      initialState: undefined as any,
      rounds: [],
      startedAt,
      finishedAt,
      durationMs,
      artifactPath: loopArtifactDir,
      error: serializedError,
    });
    await writeLoopExecutionRecord(runtime.artifactStore!, loopId, record);

    const summary = buildLoopSummary(record);
    if (summary.error) {
      summary.error = redactSerializedError(summary.error, secretValues);
    }
    if (!runtime.loopSummaries) {
      runtime.loopSummaries = [];
    }
    runtime.loopSummaries.push(summary);

    const loopTerminalPayloadInput: any = {
      loopId,
      workflowInvocationId,
      label: normalized.label,
      status: "failed",
      roundsCompleted: 0,
      roundCount: 0,
      maxRounds: normalized.options.maxRounds,
      durationMs,
      artifactPath: loopArtifactDir,
      error: redactSerializedError(serializedError, secretValues),
    };
    runtime.eventSink.emit(
      "loop.failed",
      buildLoopTerminalPayload(loopTerminalPayloadInput)
    );

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (parentAbortListener) {
      signal.removeEventListener("abort", parentAbortListener);
    }

    throw valError;
  }

  try {
    const startedAt = getIsoTimestamp();

    // 5. Emit loop.started
    const startedPayloadInput: any = {
      loopId,
      workflowInvocationId,
      label: normalized.label,
      maxRounds: normalized.options.maxRounds,
      artifactPath: loopArtifactDir,
    };
    if (parentLoopId !== undefined) {
      startedPayloadInput.parentLoopId = parentLoopId;
    }
    if (normalized.options.timeoutMs !== undefined) {
      startedPayloadInput.timeoutMs = normalized.options.timeoutMs;
    }

    runtime.eventSink.emit(
      "loop.started",
      buildLoopStartedPayload(startedPayloadInput)
    );

    // 6. Write loop definition artifacts and initial-state.json
    await writeLoopDefinition(runtime.artifactStore!, loopId, {
      options: {
        failureMode: normalized.options.failureMode,
        maxRounds: normalized.options.maxRounds,
        timeoutMs: normalized.options.timeoutMs,
      },
    });
    await writeLoopInitialState(runtime.artifactStore!, loopId, initialStateCloned);

    // 7. Record loop-start replay marker and cache marker
    const initialStateHash = stableHashJson(initialStateCloned);
    const optionsFingerprint = stableHashJson({
      failureMode: normalized.options.failureMode,
      maxRounds: normalized.options.maxRounds,
      timeoutMs: normalized.options.timeoutMs,
    });
    const startMarkerInput: any = {
      loopId,
      label: normalized.label,
      maxRounds: normalized.options.maxRounds,
      optionsFingerprint,
      initialStateHash,
      maxRoundsCeiling,
    };
    if (parentLoopId !== undefined) {
      startMarkerInput.parentLoopId = parentLoopId;
    }
    const loopStartMarker = buildLoopStartReplayMarker(startMarkerInput);

    const callSequence = (runtime.callSequence ?? 0) + 1;
    runtime.callSequence = callSequence;
    await recordLoopCacheMarker({
      store: runtime.artifactStore!,
      ...(runtime.callCache !== undefined ? { cache: runtime.callCache } : {}),
      kind: "loop",
      sequence: callSequence,
      loopId,
      fingerprint: loopStartMarker,
      resultPath: `${loopArtifactDir}/loop.json`,
    });

    let currentState = initialStateCloned as TState;
    const rounds: LoopRoundRecord<TState>[] = [];
    let loopStatus: LoopStatus | undefined;
    let loopError: SerializedError | undefined;
    let roundErrorThrown: any;

    // 8. Loop round progression
    for (let roundIndex = 0; roundIndex < normalized.options.maxRounds; roundIndex++) {
      const roundNumber = roundIndex + 1;
      const roundId = createRoundId(loopId, roundNumber);
      const roundArtifactDir = `loops/${loopId}/rounds/${roundNumber.toString().padStart(4, "0")}`;
      const inputStateSnapshot = cloneJsonValue(currentState, "round input state") as TState;

      // Stop before scheduling if aborted
      if (loopSignal.aborted) {
        if (signal.aborted) {
          loopStatus = "cancelled";
        } else {
          loopStatus = "timed_out";
        }
        loopError = serializeError(loopSignal.reason || new Error("Aborted"));
        break;
      }

      // Create active loop context metadata
      const activeRoundContext: ActiveLoopContext = {
        loopId,
        label: normalized.label,
        roundIndex,
        roundNumber,
        roundId,
        childAgentIds: [],
        childWorkflowInvocationIds: [],
        childToolCallIds: [],
        signal: loopSignal,
        workflowInvocationId,
      };
      if (parentLoopId !== undefined) {
        activeRoundContext.parentLoopId = parentLoopId;
      }

      // Create public LoopContext
      const ctx = createLoopRoundContext({
        loopId,
        label: normalized.label,
        runId: runtime.runId,
        artifactsDir: runtime.artifactsDir,
        roundIndex,
        roundNumber,
        signal: loopSignal,
        dsl,
      });

      // Write round input-state.json
      await runtime.artifactStore!.writeJson(`${roundArtifactDir}/input-state.json`, inputStateSnapshot);

      // Emit loop.round.started
      const roundStartedAt = getIsoTimestamp();
      runtime.eventSink.emit(
        "loop.round.started",
        buildLoopRoundStartedPayload({
          loopId,
          workflowInvocationId,
          label: normalized.label,
          roundIndex,
          roundNumber,
          roundId,
          startedAt: roundStartedAt,
          artifactPath: roundArtifactDir,
        })
      );

      let roundResult: unknown;
      let roundError: any;
      let roundStatus: LoopRoundStatus = "completed";
      let abortListener: (() => void) | undefined;

      try {
        const abortPromise = new Promise<never>((_, reject) => {
          if (loopSignal.aborted) {
            reject(loopSignal.reason || new Error("Aborted"));
            return;
          }
          abortListener = () => {
            reject(loopSignal.reason || new Error("Aborted"));
          };
          loopSignal.addEventListener("abort", abortListener);
        });

        const runStateArg = cloneJsonValue(inputStateSnapshot, "run state argument") as TState;
        const roundPromise = withActiveLoopContext(activeRoundContext as ActiveLoopContext, async () => {
          return withToolForbidden("loop-round", () => {
            return normalized.run(runStateArg, ctx);
          });
        });

        roundResult = await Promise.race([roundPromise, abortPromise]);
      } catch (err: any) {
        roundError = err;
        if (signal.aborted) {
          roundStatus = "cancelled";
        } else if (loopSignal.aborted) {
          roundStatus = "timed_out";
        } else {
          roundStatus = err.name === "AbortError" || err.code === "WORKFLOW_CANCELLED" ? "cancelled" : 
                        err.code === "WORKFLOW_TIMEOUT" ? "timed_out" : "failed";
        }
      } finally {
        if (abortListener) {
          loopSignal.removeEventListener("abort", abortListener);
        }
      }

      if (activeRoundContext.activeToolPromise) {
        try {
          await activeRoundContext.activeToolPromise;
        } catch {
          // Preserve the original tool result/error ownership. Draining must not create an unhandled rejection or replace the round callback's primary error.
        }
      }

      const roundFinishedAt = getIsoTimestamp();
      const roundDurationMs = getDurationMs(roundStartedAt, roundFinishedAt);

      if (roundStatus === "completed") {
        try {
          validateLoopRunResult(roundResult, normalized.label);
        } catch (err: any) {
          roundStatus = "failed";
          roundError = err;
        }
      }

      if (roundStatus !== "completed") {
        roundErrorThrown = roundError;
        const serializedError = serializeError(roundError);
        const roundRecord = createLoopRoundRecord<TState>({
          index: roundIndex,
          roundNumber,
          status: roundStatus,
          inputState: inputStateSnapshot,
          durationMs: roundDurationMs,
          error: serializedError,
          nestedCalls: {
            agents: activeRoundContext.childAgentIds,
            workflows: activeRoundContext.childWorkflowInvocationIds,
            tools: activeRoundContext.childToolCallIds ?? [],
          },
        });
        rounds.push(roundRecord);

        await writeRoundArtifacts(runtime.artifactStore!, loopId, roundNumber, {
          inputState: inputStateSnapshot,
          error: serializedError,
          nestedCalls: {
            agents: activeRoundContext.childAgentIds,
            workflows: activeRoundContext.childWorkflowInvocationIds,
            tools: activeRoundContext.childToolCallIds ?? [],
          },
        });

        // Record round cache/replay marker
        const roundMarker = buildLoopRoundReplayMarker({
          loopId,
          label: normalized.label,
          roundIndex,
          roundNumber,
          nestedCallSequence: [
            ...activeRoundContext.childAgentIds,
            ...activeRoundContext.childWorkflowInvocationIds,
            ...(activeRoundContext.childToolCallIds ?? []),
          ],
          stateBeforeHash: stableHashJson(inputStateSnapshot),
          status: roundStatus,
        });
        const roundCallSequence: number = (runtime.callSequence ?? 0) + 1;
        runtime.callSequence = roundCallSequence;
        await recordLoopCacheMarker({
          store: runtime.artifactStore!,
          ...(runtime.callCache !== undefined ? { cache: runtime.callCache } : {}),
          kind: "loop",
          sequence: roundCallSequence,
          loopId,
          roundIndex,
          roundId,
          fingerprint: roundMarker,
          resultPath: `${roundArtifactDir}/error.json`,
          status: roundStatus,
        });

        const roundTerminalPayloadInput: Parameters<typeof buildLoopRoundTerminalPayload>[0] = {
          loopId,
          workflowInvocationId,
          label: normalized.label,
          roundIndex,
          roundNumber,
          roundId,
          status: roundStatus,
          durationMs: roundDurationMs,
        };
        if (serializedError) {
          roundTerminalPayloadInput.error = redactSerializedError(serializedError, secretValues);
        }

        runtime.eventSink.emit(
          terminalRoundEventType(roundStatus),
          buildLoopRoundTerminalPayload(roundTerminalPayloadInput)
        );

        loopStatus = roundStatus;
        loopError = serializedError;
        break;
      }

      // If execution was successful
      const { done, nextState } = roundResult as { done: boolean; nextState: any };
      let nextStateCloned: TState;
      try {
        nextStateCloned = cloneJsonValue(nextState, "next state") as TState;
      } catch (err: any) {
        const valError = new OpenDynamicWorkflowError(
          ErrorCode.WORKFLOW_INVALID_CALL,
          `Loop '${normalized.label}' nextState is not JSON-safe: ${err.message}`
        );
        roundErrorThrown = valError;
        const serializedError = serializeError(valError);
        const roundRecord = createLoopRoundRecord<TState>({
          index: roundIndex,
          roundNumber,
          status: "failed",
          inputState: inputStateSnapshot,
          durationMs: roundDurationMs,
          error: serializedError,
          nestedCalls: {
            agents: activeRoundContext.childAgentIds,
            workflows: activeRoundContext.childWorkflowInvocationIds,
            tools: activeRoundContext.childToolCallIds ?? [],
          },
        });
        rounds.push(roundRecord);

        await writeRoundArtifacts(runtime.artifactStore!, loopId, roundNumber, {
          inputState: inputStateSnapshot,
          error: serializedError,
          nestedCalls: {
            agents: activeRoundContext.childAgentIds,
            workflows: activeRoundContext.childWorkflowInvocationIds,
            tools: activeRoundContext.childToolCallIds ?? [],
          },
        });

        const roundMarker = buildLoopRoundReplayMarker({
          loopId,
          label: normalized.label,
          roundIndex,
          roundNumber,
          nestedCallSequence: [
            ...activeRoundContext.childAgentIds,
            ...activeRoundContext.childWorkflowInvocationIds,
            ...(activeRoundContext.childToolCallIds ?? []),
          ],
          stateBeforeHash: stableHashJson(inputStateSnapshot),
          status: "failed",
        });
        const roundCallSequence: number = (runtime.callSequence ?? 0) + 1;
        runtime.callSequence = roundCallSequence;
        await recordLoopCacheMarker({
          store: runtime.artifactStore!,
          ...(runtime.callCache !== undefined ? { cache: runtime.callCache } : {}),
          kind: "loop",
          sequence: roundCallSequence,
          loopId,
          roundIndex,
          roundId,
          fingerprint: roundMarker,
          resultPath: `${roundArtifactDir}/error.json`,
          status: "failed",
        });

        const failedRoundTerminalPayloadInput: Parameters<typeof buildLoopRoundTerminalPayload>[0] = {
          loopId,
          workflowInvocationId,
          label: normalized.label,
          roundIndex,
          roundNumber,
          roundId,
          status: "failed",
          durationMs: roundDurationMs,
        };
        if (serializedError) {
          failedRoundTerminalPayloadInput.error = redactSerializedError(serializedError, secretValues);
        }

        runtime.eventSink.emit(
          "loop.round.failed",
          buildLoopRoundTerminalPayload(failedRoundTerminalPayloadInput)
        );

        loopStatus = "failed";
        loopError = serializedError;
        break;
      }

      const roundRecord = createLoopRoundRecord<TState>({
        index: roundIndex,
        roundNumber,
        status: "completed",
        inputState: inputStateSnapshot,
        nextState: nextStateCloned,
        durationMs: roundDurationMs,
        nestedCalls: {
          agents: activeRoundContext.childAgentIds,
          workflows: activeRoundContext.childWorkflowInvocationIds,
          tools: activeRoundContext.childToolCallIds ?? [],
        },
      });
      rounds.push(roundRecord);

      await writeRoundArtifacts(runtime.artifactStore!, loopId, roundNumber, {
        inputState: inputStateSnapshot,
        runResult: roundResult,
        nextState: nextStateCloned,
        nestedCalls: {
          agents: activeRoundContext.childAgentIds,
          workflows: activeRoundContext.childWorkflowInvocationIds,
          tools: activeRoundContext.childToolCallIds ?? [],
        },
      });

      const roundMarker = buildLoopRoundReplayMarker({
        loopId,
        label: normalized.label,
        roundIndex,
        roundNumber,
        nestedCallSequence: [
          ...activeRoundContext.childAgentIds,
          ...activeRoundContext.childWorkflowInvocationIds,
          ...(activeRoundContext.childToolCallIds ?? []),
        ],
        stateBeforeHash: stableHashJson(inputStateSnapshot),
        stateAfterHash: stableHashJson(nextStateCloned),
        status: "completed",
      });
      const roundCallSequence: number = (runtime.callSequence ?? 0) + 1;
      runtime.callSequence = roundCallSequence;
      await recordLoopCacheMarker({
        store: runtime.artifactStore!,
        ...(runtime.callCache !== undefined ? { cache: runtime.callCache } : {}),
        kind: "loop",
        sequence: roundCallSequence,
        loopId,
        roundIndex,
        roundId,
        fingerprint: roundMarker,
        resultPath: `${roundArtifactDir}/run-result.json`,
        status: "succeeded",
      });

      const statePreview = redactJsonValue(createPreview(nextStateCloned), secretValues);
      const roundTerminalPayloadInput: any = {
        loopId,
        workflowInvocationId,
        label: normalized.label,
        roundIndex,
        roundNumber,
        roundId,
        status: "completed",
        durationMs: roundDurationMs,
        statePreview,
      };

      runtime.eventSink.emit(
        "loop.round.completed",
        buildLoopRoundTerminalPayload(roundTerminalPayloadInput)
      );

      currentState = nextStateCloned;

      if (done === true) {
        loopStatus = "succeeded";
        break;
      }

      if (roundNumber === normalized.options.maxRounds) {
        loopStatus = "max_rounds";
        const exhaustionError = createLoopExhaustionError(normalized.label, normalized.options.maxRounds);
        roundErrorThrown = exhaustionError;
        loopError = serializeError(exhaustionError);
        break;
      }
    }

    if (!loopStatus) {
      if (loopSignal.aborted) {
        if (signal.aborted) {
          loopStatus = "cancelled";
        } else {
          loopStatus = "timed_out";
        }
        loopError = serializeError(loopSignal.reason || new Error("Aborted"));
      } else {
        loopStatus = "failed";
      }
    }

    // Finalize record
    const finishedAt = getIsoTimestamp();
    const durationMs = getDurationMs(startedAt, finishedAt);

    const recordInput: any = {
      loopId,
      label: normalized.label,
      status: loopStatus,
      roundsCompleted: rounds.length,
      maxRounds: normalized.options.maxRounds,
      initialState: initialStateCloned,
      rounds,
      startedAt,
      finishedAt,
      durationMs,
      artifactPath: loopArtifactDir,
    };
    if (rounds.length > 0) {
      recordInput.finalState = cloneJsonValue(currentState, "loop final state");
    }
    if (loopError !== undefined) {
      recordInput.error = loopError;
    }

    const record = createLoopExecutionRecord<TState>(recordInput);

    // Write final loop artifacts
    if (rounds.length > 0) {
      await writeLoopFinalState(runtime.artifactStore!, loopId, currentState);
    }
    await writeLoopExecutionRecord(runtime.artifactStore!, loopId, record);
    if (loopStatus !== "succeeded" && loopError !== undefined) {
      await writeLoopError(runtime.artifactStore!, loopId, loopError);
    }

    // Push LoopSummary
    const summary = buildLoopSummary(record);
    if (summary.error) {
      summary.error = redactSerializedError(summary.error, secretValues);
    }
    if (!runtime.loopSummaries) {
      runtime.loopSummaries = [];
    }
    runtime.loopSummaries.push(summary);

    // Emit terminal loop event
    const loopTerminalPayloadInput: any = {
      loopId,
      workflowInvocationId,
      label: normalized.label,
      status: loopStatus,
      roundsCompleted: rounds.length,
      roundCount: rounds.length,
      maxRounds: normalized.options.maxRounds,
      durationMs,
      artifactPath: loopArtifactDir,
    };
    if (loopError !== undefined) {
      loopTerminalPayloadInput.error = redactSerializedError(loopError, secretValues);
    }
    if (rounds.length > 0) {
      loopTerminalPayloadInput.statePreview = redactJsonValue(createPreview(currentState), secretValues);
    }

    runtime.eventSink.emit(
      terminalLoopEventType(loopStatus),
      buildLoopTerminalPayload(loopTerminalPayloadInput)
    );

    // Return or throw
    if (normalized.options.failureMode === "throw") {
      if (loopStatus === "succeeded") {
        return currentState;
      }
      if (loopStatus === "max_rounds") {
        throw createLoopExhaustionError(normalized.label, normalized.options.maxRounds);
      }
      if (loopStatus === "timed_out") {
        throw new OpenDynamicWorkflowError(
          ErrorCode.WORKFLOW_TIMEOUT,
          `Loop '${normalized.label}' timed out.`
        );
      }
      if (loopStatus === "cancelled") {
        throw new OpenDynamicWorkflowError(
          ErrorCode.WORKFLOW_CANCELLED,
          `Loop '${normalized.label}' was cancelled.`
        );
      }
      throw roundErrorThrown || new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_FAILED, loopError?.message || `Loop '${normalized.label}' failed.`);
    } else {
      // Settled mode
      if (loopStatus === "succeeded") {
        return createSettledSuccessEnvelope({
          label: normalized.label,
          loopId,
          roundsCompleted: rounds.length,
          finalState: currentState,
          artifactsDir: loopArtifactDir,
        });
      } else {
        const failureStatus = loopStatus as "failed" | "cancelled" | "timed_out" | "max_rounds";
        const settledFailureInput: any = {
          status: failureStatus,
          label: normalized.label,
          loopId,
          roundsCompleted: rounds.length,
          artifactsDir: loopArtifactDir,
        };
        if (rounds.length > 0) {
          settledFailureInput.finalState = currentState;
        }
        if (loopError !== undefined) {
          settledFailureInput.error = loopError;
        }
        return createSettledFailureEnvelope<TState>(settledFailureInput);
      }
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (parentAbortListener) {
      signal.removeEventListener("abort", parentAbortListener);
    }
  }
}
