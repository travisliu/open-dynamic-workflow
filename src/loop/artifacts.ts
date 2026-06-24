import type { ArtifactStore } from "../types/artifacts.js";
import { cloneJsonValue } from "../workflow/json.js";
import type { LoopExecutionRecord, LoopReplayRecord } from "./types.js";

/**
 * Writes the loop definition artifact.
 */
export async function writeLoopDefinition(
  artifactStore: ArtifactStore,
  loopId: string,
  data: unknown
): Promise<string> {
  return artifactStore.writeJson(`loops/${loopId}/loop.json`, data);
}

/**
 * Writes the loop initial state artifact.
 */
export async function writeLoopInitialState(
  artifactStore: ArtifactStore,
  loopId: string,
  initialState: unknown
): Promise<string> {
  return artifactStore.writeJson(
    `loops/${loopId}/initial-state.json`,
    cloneJsonValue(initialState, "loop initial state")
  );
}

/**
 * Writes the loop final state artifact.
 */
export async function writeLoopFinalState(
  artifactStore: ArtifactStore,
  loopId: string,
  finalState: unknown
): Promise<string> {
  return artifactStore.writeJson(
    `loops/${loopId}/final-state.json`,
    cloneJsonValue(finalState, "loop final state")
  );
}

/**
 * Writes the loop execution record (result.json).
 */
export async function writeLoopExecutionRecord(
  artifactStore: ArtifactStore,
  loopId: string,
  record: LoopExecutionRecord<any>
): Promise<string> {
  return artifactStore.writeJson(`loops/${loopId}/result.json`, record);
}

/**
 * Writes the loop error artifact.
 */
export async function writeLoopError(
  artifactStore: ArtifactStore,
  loopId: string,
  error: unknown
): Promise<string> {
  return artifactStore.writeJson(`loops/${loopId}/error.json`, error);
}

/**
 * Writes the loop replay record artifact.
 */
export async function writeLoopReplayArtifact(
  artifactStore: ArtifactStore,
  loopId: string,
  replayRecord: LoopReplayRecord
): Promise<string> {
  return artifactStore.writeJson(`loops/${loopId}/replay.json`, replayRecord);
}

/**
 * Writes all artifacts for a single round.
 */
export async function writeRoundArtifacts(
  artifactStore: ArtifactStore,
  loopId: string,
  roundNumber: number,
  data: {
    inputState: unknown;
    runResult?: unknown;
    nextState?: unknown;
    error?: unknown;
    nestedCalls?: {
      agents: string[];
      workflows: string[];
      tools: string[];
    };
  }
): Promise<void> {
  const paddedNumber = roundNumber.toString().padStart(4, "0");
  const baseDir = `loops/${loopId}/rounds/${paddedNumber}`;

  await artifactStore.writeJson(`${baseDir}/input-state.json`, cloneJsonValue(data.inputState, "round inputState"));

  if (data.runResult !== undefined) {
    await artifactStore.writeJson(`${baseDir}/run-result.json`, cloneJsonValue(data.runResult, "round runResult"));
  }

  if (data.nextState !== undefined) {
    await artifactStore.writeJson(`${baseDir}/next-state.json`, cloneJsonValue(data.nextState, "round nextState"));
  }

  if (data.error !== undefined) {
    await artifactStore.writeJson(`${baseDir}/error.json`, data.error);
  }

  if (data.nestedCalls !== undefined) {
    await artifactStore.writeJson(`${baseDir}/nested-calls.json`, data.nestedCalls);
  }
}
