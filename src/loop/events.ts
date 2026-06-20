import type {
  LoopRoundStatus,
} from "./types.js";
import type { SerializedError } from "../types/errors.js";
import type {
  LoopStartedPayload,
  LoopRoundStartedPayload,
  LoopRoundTerminalPayload,
  LoopTerminalPayload,
} from "../output/events.js";

/**
 * Builds the payload for a loop.started event.
 */
export function buildLoopStartedPayload(input: {
  loopId: string;
  workflowInvocationId: string;
  label: string;
  parentLoopId?: string;
  maxRounds: number;
  timeoutMs?: number;
  artifactPath?: string;
}): LoopStartedPayload {
  return {
    loopId: input.loopId,
    workflowInvocationId: input.workflowInvocationId,
    label: input.label,
    ...(input.parentLoopId !== undefined ? { parentLoopId: input.parentLoopId } : {}),
    maxRounds: input.maxRounds,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.artifactPath !== undefined ? { artifactPath: input.artifactPath } : {}),
  };
}

/**
 * Builds the payload for a loop.round.started event.
 */
export function buildLoopRoundStartedPayload(input: {
  loopId: string;
  workflowInvocationId: string;
  label: string;
  roundIndex: number;
  roundNumber: number;
  roundId: string;
  startedAt: string;
  artifactPath?: string;
}): LoopRoundStartedPayload {
  return {
    loopId: input.loopId,
    workflowInvocationId: input.workflowInvocationId,
    label: input.label,
    roundIndex: input.roundIndex,
    roundNumber: input.roundNumber,
    roundId: input.roundId,
    startedAt: input.startedAt,
    ...(input.artifactPath !== undefined ? { artifactPath: input.artifactPath } : {}),
  };
}

/**
 * Builds the payload for a loop.round terminal event (completed, failed, cancelled, timed_out).
 */
export function buildLoopRoundTerminalPayload(input: {
  loopId: string;
  workflowInvocationId: string;
  label: string;
  roundIndex: number;
  roundNumber: number;
  roundId: string;
  status: LoopRoundStatus;
  durationMs: number;
  statePreview?: unknown;
  reason?: string;
  artifactPath?: string;
  error?: SerializedError;
}): LoopRoundTerminalPayload {
  return {
    loopId: input.loopId,
    workflowInvocationId: input.workflowInvocationId,
    label: input.label,
    roundIndex: input.roundIndex,
    roundNumber: input.roundNumber,
    roundId: input.roundId,
    status: input.status,
    durationMs: input.durationMs,
    ...(input.statePreview !== undefined ? { statePreview: input.statePreview } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.artifactPath !== undefined ? { artifactPath: input.artifactPath } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
  };
}

/**
 * Builds the payload for a loop terminal event.
 */
export function buildLoopTerminalPayload(input: {
  loopId: string;
  workflowInvocationId: string;
  label: string;
  status: "succeeded" | "max_rounds" | "failed" | "cancelled" | "timed_out";
  roundsCompleted: number;
  roundCount: number;
  maxRounds: number;
  durationMs: number;
  reason?: string;
  artifactPath?: string;
  error?: SerializedError;
  statePreview?: unknown;
}): LoopTerminalPayload {
  return {
    loopId: input.loopId,
    workflowInvocationId: input.workflowInvocationId,
    label: input.label,
    status: input.status,
    roundsCompleted: input.roundsCompleted,
    roundCount: input.roundCount,
    maxRounds: input.maxRounds,
    durationMs: input.durationMs,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.artifactPath !== undefined ? { artifactPath: input.artifactPath } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.statePreview !== undefined ? { statePreview: input.statePreview } : {}),
  };
}
