import * as path from "node:path";
import type { RuntimeState } from "../workflow/types.js";
import type { PipelineStage, PipelineOptions, PipelineResult, PipelineItemResult } from "./types.js";
import { validateAndNormalizePipelineArgs } from "./validate.js";
import { createPipelineId } from "./id.js";
import { runItemStreaming } from "./item-streaming.js";
import { runStageBarrier } from "./stage-barrier.js";
import { getIsoTimestamp, getDurationMs } from "./results.js";
import { buildPipelineStartedPayload, buildPipelineTerminalPayload } from "./events.js";
import { buildPipelineSummary } from "./summary.js";
import { writePipelineArtifact } from "./artifacts.js";

export interface RunPipelineInput<I = unknown> {
  items: I[];
  stages: PipelineStage[];
  options?: PipelineOptions | undefined;
  runtime: RuntimeState;
  signal: AbortSignal;
}

export async function runPipeline<I = unknown, O = unknown>(
  input: RunPipelineInput<I>
): Promise<PipelineResult<O>> {
  // 1. Validate runtime inputs
  const { normalizedItems, normalizedStages, normalizedOptions } = validateAndNormalizePipelineArgs(
    input.items,
    input.stages,
    input.options
  );

  // 2. Create the pipeline ID
  const runtime = input.runtime;
  const pipelineId = runtime.idGenerator
    ? runtime.idGenerator.nextId("pipeline")
    : (() => {
        if (runtime.pipelineCounter === undefined) {
          runtime.pipelineCounter = 0;
        }
        runtime.pipelineCounter += 1;
        return createPipelineId(runtime.pipelineCounter);
      })();

  // 3. Emit pipeline.started
  if (runtime.eventSink) {
    const startPayload = buildPipelineStartedPayload(
      pipelineId,
      normalizedItems,
      normalizedStages,
      normalizedOptions
    );
    runtime.eventSink.emit("pipeline.started", startPayload);
  }

  const startedAt = getIsoTimestamp();
  let results: PipelineItemResult[] = [];
  let errorToThrow: unknown = undefined;

  try {
    // 4. Dispatch to the selected strategy
    if (normalizedOptions.strategy === "stage-barrier") {
      results = await runStageBarrier(
        normalizedItems,
        normalizedStages,
        normalizedOptions,
        pipelineId,
        runtime,
        input.signal
      );
    } else {
      results = await runItemStreaming(
        normalizedItems,
        normalizedStages,
        normalizedOptions,
        pipelineId,
        runtime,
        input.signal
      );
    }
  } catch (err) {
    errorToThrow = err;
  }

  // 5. Determine overall pipeline status
  let pipelineStatus: "succeeded" | "failed" | "cancelled" = "succeeded";
  if (input.signal.aborted || errorToThrow) {
    pipelineStatus = errorToThrow ? "failed" : "cancelled";
  } else if (results.some((r) => r.status === "cancelled")) {
    pipelineStatus = "cancelled";
  } else if (results.some((r) => r.status === "failed" || r.status === "timed_out")) {
    pipelineStatus = "failed";
  }

  const durationMs = getDurationMs(startedAt, getIsoTimestamp());

  // 6. Emit terminal pipeline event
  if (runtime.eventSink) {
    const eventType =
      pipelineStatus === "cancelled"
        ? "pipeline.cancelled"
        : pipelineStatus === "failed"
        ? "pipeline.failed"
        : "pipeline.completed";

    const terminalPayload = buildPipelineTerminalPayload(
      pipelineId,
      pipelineStatus,
      durationMs,
      results,
      path.join(runtime.artifactsDir, "pipelines", pipelineId, "pipeline.json")
    );

    runtime.eventSink.emit(eventType, terminalPayload);
  }

  // 7. Build pipeline summary and record in runtime
  const summary = buildPipelineSummary({
    pipelineId,
    label: normalizedOptions.label,
    strategy: normalizedOptions.strategy,
    status: pipelineStatus,
    itemCount: normalizedItems.length,
    results,
    stageNames: normalizedStages.map((s) => s.name),
    durationMs,
    artifactsDir: runtime.artifactsDir
  });

  if (!runtime.pipelineSummaries) {
    runtime.pipelineSummaries = [];
  }
  runtime.pipelineSummaries.push(summary);

  // 8. Write pipeline.json artifact (even on partial/failure)
  const pipelineArtifactData = {
    summary,
    results
  };
  await writePipelineArtifact(runtime.artifactStore, pipelineId, pipelineArtifactData);

  if (errorToThrow) {
    throw errorToThrow;
  }

  return results as PipelineResult<O>;
}
