import type { RuntimeState } from "../workflow/types.js";
import type {
  PipelineStage,
  PipelineItemResult,
  PipelineStageResult,
  NormalizedPipelineOptions
} from "./types.js";
import { ConcurrencyLimiter, createLimiter, getEffectiveStageConcurrency } from "./concurrency.js";
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

async function processItem(
  item: unknown,
  itemIndex: number,
  pipelineId: string,
  stages: PipelineStage[],
  options: NormalizedPipelineOptions,
  runtime: RuntimeState,
  pipelineSignal: AbortSignal,
  stageLimiters: ConcurrencyLimiter[],
  triggerFailFast: () => void
): Promise<PipelineItemResult> {
  const startedAt = getIsoTimestamp();
  if (runtime.eventSink) {
    runtime.eventSink.emit("pipeline.item.started", buildPipelineItemStartedPayload(pipelineId, itemIndex, startedAt));
  }
  const stagesResults: PipelineStageResult[] = [];
  let itemStatus: "succeeded" | "failed" | "cancelled" | "timed_out" = "succeeded";
  let failedStageName: string | undefined;
  let firstError: SerializedError | undefined;
  let finalValue: unknown = item;

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (!stage) continue;

    if (pipelineSignal.aborted) {
      itemStatus = "cancelled";
      const skippedTimestamp = getIsoTimestamp();
      for (let j = i; j < stages.length; j++) {
        const skippedStage = stages[j];
        if (skippedStage) {
          stagesResults.push(createSkippedStageResult(skippedStage.name, j, skippedTimestamp));
        }
      }
      break;
    }

    const limiter = stageLimiters[i];
    if (!limiter) continue;

    const stageResult = await limiter.run(async () => {
      if (pipelineSignal.aborted) {
        return createSkippedStageResult(stage.name, i, getIsoTimestamp());
      }
      return runStage({
        stage,
        stageIndex: i,
        item: finalValue,
        itemIndex,
        pipelineId,
        options,
        runtime,
        parentSignal: pipelineSignal
      });
    });

    stagesResults.push(stageResult);

    if (stageResult.status === "succeeded") {
      finalValue = stageResult.value;
    } else {
      itemStatus =
        stageResult.status === "timed_out"
          ? "timed_out"
          : stageResult.status === "cancelled"
          ? "cancelled"
          : "failed";
      failedStageName = stage.name;
      firstError = stageResult.error;

      const skippedTimestamp = getIsoTimestamp();
      for (let j = i + 1; j < stages.length; j++) {
        const skippedStage = stages[j];
        if (skippedStage) {
          stagesResults.push(createSkippedStageResult(skippedStage.name, j, skippedTimestamp));
        }
      }

      if (options.failFast) {
        triggerFailFast();
      }
      break;
    }
  }

  const finishedAt = getIsoTimestamp();
  const durationMs = getDurationMs(startedAt, finishedAt);

  let result: PipelineItemResult;
  if (itemStatus === "succeeded") {
    result = createItemSuccess(itemIndex, startedAt, finishedAt, durationMs, finalValue, stagesResults);
  } else {
    result = createItemFailure(
      itemIndex,
      itemStatus,
      startedAt,
      finishedAt,
      durationMs,
      failedStageName,
      firstError,
      stagesResults
    );
  }

  // 1. Write item artifact
  await writeItemArtifact(runtime.artifactStore, pipelineId, itemIndex, result);

  // 2. Emit item terminal event
  if (runtime.eventSink) {
    const eventType = result.status === "succeeded" ? "pipeline.item.completed" : "pipeline.item.failed";
    const itemTerminalPayload = buildPipelineItemTerminalPayload(pipelineId, result);
    runtime.eventSink.emit(eventType, itemTerminalPayload);
  }

  return result;
}

export async function runItemStreaming(
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

  const completedResults: PipelineItemResult[] = [];

  const itemPromises = items.map((item, index) => {
    return itemLimiter.run(async () => {
      const res = await processItem(
        item,
        index,
        pipelineId,
        stages,
        options,
        runtime,
        pipelineSignal,
        stageLimiters,
        triggerFailFast
      );
      completedResults.push(res);
      return res;
    });
  });

  await Promise.all(itemPromises);

  if (options.preserveOrder === false) {
    return completedResults;
  } else {
    return [...completedResults].sort((a, b) => a.itemIndex - b.itemIndex);
  }
}
