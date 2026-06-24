import type {
  LoopRoundRecord,
  LoopExecutionRecord,
  LoopSettledSuccess,
  LoopSettledFailure,
} from "./types.js";
import type { SerializedError } from "../types/errors.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

/**
 * Returns the current ISO timestamp.
 */
export function getIsoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Calculates duration between two ISO timestamps.
 */
export function getDurationMs(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, end - start);
}

/**
 * Creates a concise round record.
 */
export function createLoopRoundRecord<TState>(input: {
  index: number;
  roundNumber: number;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  inputState: TState;
  nextState?: TState;
  durationMs: number;
  error?: SerializedError;
  nestedCalls: {
    agents: string[];
    workflows: string[];
    tools: string[];
  };
}): LoopRoundRecord<TState> {
  return {
    index: input.index,
    roundNumber: input.roundNumber,
    status: input.status,
    inputState: input.inputState,
    ...(input.nextState !== undefined ? { nextState: input.nextState } : {}),
    durationMs: input.durationMs,
    ...(input.error !== undefined ? { error: input.error } : {}),
    nestedCalls: {
      agents: [...input.nestedCalls.agents],
      workflows: [...input.nestedCalls.workflows],
      tools: [...input.nestedCalls.tools],
    },
  };
}

/**
 * Creates an execution record.
 */
export function createLoopExecutionRecord<TState>(input: {
  loopId: string;
  label: string;
  status: "succeeded" | "failed" | "cancelled" | "timed_out" | "max_rounds";
  roundsCompleted: number;
  maxRounds: number;
  initialState: TState;
  finalState?: TState;
  rounds: LoopRoundRecord<TState>[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  artifactPath: string;
  error?: SerializedError;
}): LoopExecutionRecord<TState> {
  return {
    schemaVersion: "open-dynamic-workflow.loop-result.v2",
    loopId: input.loopId,
    label: input.label,
    status: input.status,
    roundsCompleted: input.roundsCompleted,
    maxRounds: input.maxRounds,
    initialState: input.initialState,
    ...(input.finalState !== undefined ? { finalState: input.finalState } : {}),
    rounds: [...input.rounds],
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    artifactPath: input.artifactPath,
    ...(input.error !== undefined ? { error: input.error } : {}),
  };
}

/**
 * Creates settled success envelope.
 */
export function createSettledSuccessEnvelope<TState>(input: {
  label: string;
  loopId: string;
  roundsCompleted: number;
  finalState: TState;
  artifactsDir: string;
}): LoopSettledSuccess<TState> {
  return {
    ok: true,
    status: "succeeded",
    label: input.label,
    loopId: input.loopId,
    roundsCompleted: input.roundsCompleted,
    finalState: input.finalState,
    artifacts: {
      dir: input.artifactsDir,
    },
  };
}

/**
 * Creates settled failure envelope.
 */
export function createSettledFailureEnvelope<TState>(input: {
  status: "failed" | "cancelled" | "timed_out" | "max_rounds";
  label: string;
  loopId: string;
  roundsCompleted: number;
  finalState?: TState;
  error?: SerializedError;
  artifactsDir: string;
}): LoopSettledFailure<TState> {
  return {
    ok: false,
    status: input.status,
    label: input.label,
    loopId: input.loopId,
    roundsCompleted: input.roundsCompleted,
    ...(input.finalState !== undefined ? { finalState: input.finalState } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    artifacts: {
      dir: input.artifactsDir,
    },
  };
}

/**
 * Creates loop exhaustion error.
 */
export function createLoopExhaustionError(label: string, maxRounds: number): Error {
  return new OpenDynamicWorkflowError(
    ErrorCode.WORKFLOW_FAILED,
    `Loop '${label}' exhausted maxRounds of ${maxRounds}.`
  );
}

/**
 * Creates invalid round result error.
 */
export function createInvalidRunResultError(label: string, details: string): Error {
  return new OpenDynamicWorkflowError(
    ErrorCode.WORKFLOW_INVALID_CALL,
    `Loop '${label}' round returned invalid run result: ${details}`
  );
}
