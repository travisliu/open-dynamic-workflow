import type { LoopExecutionRecord, LoopSummary } from "./types.js";

/**
 * Builds a compact summary from a loop execution record.
 */
export function buildLoopSummary(record: LoopExecutionRecord<any>): LoopSummary {
  return {
    loopId: record.loopId,
    label: record.label,
    status: record.status,
    roundsCompleted: record.roundsCompleted,
    maxRounds: record.maxRounds,
    durationMs: record.durationMs,
    artifactPath: record.artifactPath,
    ...(record.error !== undefined ? { error: record.error } : {}),
  };
}
