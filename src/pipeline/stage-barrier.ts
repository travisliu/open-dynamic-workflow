import type { RuntimeState } from "../workflow/types.js";
import type {
  PipelineStage,
  PipelineItemResult,
  PipelineStageResult,
  NormalizedPipelineOptions
} from "./types.js";
import { createLimiter, getEffectiveStageConcurrency } from "./concurrency.js";
import { runStage } from "./stage-runner.js";
import { createLinkedAbortController } from "../orchestration/cancellation.js";
import {
  getIsoTimestamp,
  getDurationMs,
  createSkippedStageResult,
  createItemSuccess,
  createItemFailure
} from "./results.js";
import type { SerializedError } from "../types/errors.js";
import { buildPipelineItemStartedPayload, buildPipelineItemTerminalPayload } from "./events.js";
import { writeItemArtifact } from "./artifacts.js";

interface ItemState {
  index: number;
  originalValue: unknown;
  currentValue: unknown;
  startedAt: string;
  stagesResults: PipelineStageResult[];
  status: "active" | "failed" | "cancelled" | "timed_out";
  firstError?: SerializedError;
  failedStageName?: string;
}

export async function runStageBarrier(
  items: unknown[],
  stages: PipelineStage[],
  options: NormalizedPipelineOptions,
  pipelineId: string,
  runtime: RuntimeState,
  parentSignal: AbortSignal
): Promise<PipelineItemResult[]> {
  const pipelineAbortController = createLinkedAbortController(parentSignal);
  const pipelineSignal = pipelineAbortController.signal;

  const itemLimiter = createLimiter(options.concurrency);
  const stageLimiters = stages.map((stage) => {
    const limit = getEffectiveStageConcurrency(
      stage.name,
      stage.concurrency,
      options.concurrency,
      options.stageConcurrency[stage.name]
    );
    return createLimiter(limit);
  });

  const triggerFailFast = () => {
    pipelineAbortController.abort("fail-fast");
  };

  // Initialize state for each item
  const itemsStates: ItemState[] = items.map((item, index) => {
    const startedAt = getIsoTimestamp();
    if (runtime.eventSink) {
      runtime.eventSink.emit("pipeline.item.started", buildPipelineItemStartedPayload(pipelineId, index, startedAt));
    }
    return {
      index,
      originalValue: item,
      currentValue: item,
      startedAt,
      stagesResults: [],
      status: "active"
    };
  });

  // Run stage by stage (barrier)
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (!stage) continue;

    // Find active items
    const activeItems = itemsStates.filter((state) => state.status === "active");
    if (activeItems.length === 0) {
      break;
    }

    if (pipelineSignal.aborted) {
      // Abort all remaining active items
      for (const state of activeItems) {
        state.status = "cancelled";
      }
      break;
    }

    const limiter = stageLimiters[i];
    if (!limiter) continue;

    // Run the current stage for all active items in parallel
    const promises = activeItems.map((state) => {
      return itemLimiter.run(() =>
        limiter.run(async () => {
          if (pipelineSignal.aborted) {
            const res = createSkippedStageResult(stage.name, i, getIsoTimestamp());
            state.stagesResults.push(res);
            state.status = "cancelled";
            return;
          }

          const stageResult = await runStage({
            stage,
            stageIndex: i,
            item: state.currentValue,
            itemIndex: state.index,
            pipelineId,
            options,
            runtime,
            parentSignal: pipelineSignal
          });

          state.stagesResults.push(stageResult);

          if (stageResult.status === "succeeded") {
            state.currentValue = stageResult.value;
          } else {
            state.status =
              stageResult.status === "timed_out"
                ? "timed_out"
                : stageResult.status === "cancelled"
                ? "cancelled"
                : "failed";
            state.failedStageName = stage.name;
            if (stageResult.error !== undefined) {
              state.firstError = stageResult.error;
            }

            if (options.failFast) {
              triggerFailFast();
            }
          }
        })
      );
    });

    await Promise.all(promises);
  }

  // Construct final results
  const completedResults: PipelineItemResult[] = [];
  const finalTimestamp = getIsoTimestamp();

  for (const state of itemsStates) {
    const finishedAt = getIsoTimestamp();
    const durationMs = getDurationMs(state.startedAt, finishedAt);

    // If still active, they completed all stages successfully
    const finalStatus = state.status === "active" ? "succeeded" : state.status;

    // Fill in skipped stage results for any unexecuted stages
    const finalStagesResults = [...state.stagesResults];
    for (let j = finalStagesResults.length; j < stages.length; j++) {
      const skippedStage = stages[j];
      if (skippedStage) {
        finalStagesResults.push(createSkippedStageResult(skippedStage.name, j, finalTimestamp));
      }
    }

    let result: PipelineItemResult;
    if (finalStatus === "succeeded") {
      result = createItemSuccess(
        state.index,
        state.startedAt,
        finishedAt,
        durationMs,
        state.currentValue,
        finalStagesResults
      );
    } else {
      result = createItemFailure(
        state.index,
        finalStatus,
        state.startedAt,
        finishedAt,
        durationMs,
        state.failedStageName,
        state.firstError,
        finalStagesResults
      );
    }

    // 1. Write item artifact
    await writeItemArtifact(runtime.artifactStore, pipelineId, state.index, result);

    // 2. Emit item terminal event
    if (runtime.eventSink) {
      const eventType = result.status === "succeeded" ? "pipeline.item.completed" : "pipeline.item.failed";
      const itemTerminalPayload = buildPipelineItemTerminalPayload(pipelineId, result);
      runtime.eventSink.emit(eventType, itemTerminalPayload);
    }

    completedResults.push(result);
  }

  if (options.preserveOrder === false) {
    return completedResults;
  } else {
    return [...completedResults].sort((a, b) => a.itemIndex - b.itemIndex);
  }
}
