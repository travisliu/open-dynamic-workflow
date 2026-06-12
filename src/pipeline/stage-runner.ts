import type { RuntimeState } from "../workflow/types.js";
import type { PipelineStage, PipelineStageContext, PipelineStageResult, NormalizedPipelineOptions } from "./types.js";
import { createLinkedAbortController } from "../orchestration/cancellation.js";
import { serializeError } from "../errors/serialize.js";
import { createPipelineAgentId } from "./id.js";
import { createDsl } from "../workflow/dsl.js";
import { withToolForbidden } from "../workflow/scope.js";
import {
  withActivePipelineContext,
  ActivePipelineContext
} from "./context.js";
import {
  createSucceededStageResult,
  createFailedStageResult,
  getIsoTimestamp,
  getDurationMs
} from "./results.js";
import { buildPipelineStageStartedPayload, buildPipelineStageTerminalPayload } from "./events.js";
import { writeStageArtifact } from "./artifacts.js";

export interface RunStageInput {
  stage: PipelineStage;
  stageIndex: number;
  item: unknown;
  itemIndex: number;
  pipelineId: string;
  options: NormalizedPipelineOptions;
  runtime: RuntimeState;
  parentSignal: AbortSignal;
}

export async function runStage(input: RunStageInput): Promise<PipelineStageResult> {
  const { stage, stageIndex, item, itemIndex, pipelineId, options, runtime, parentSignal } = input;

  const startedAt = getIsoTimestamp();
  if (runtime.eventSink) {
    const stageStartedPayload = buildPipelineStageStartedPayload(
      pipelineId,
      itemIndex,
      stage.name,
      stageIndex,
      startedAt
    );
    runtime.eventSink.emit("pipeline.stage.started", stageStartedPayload);
  }
  const stageAbortController = createLinkedAbortController(parentSignal);

  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;

  if (stage.timeoutMs && stage.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      stageAbortController.abort("timeout");
    }, stage.timeoutMs);
  }

  const activeCtx: ActivePipelineContext = {
    pipelineId,
    strategy: options.strategy,
    itemIndex,
    stageIndex,
    stageName: stage.name,
    childAgentIds: [],
    stageSignal: stageAbortController.signal,
    agentCounter: 0
  };
  if (options.label !== undefined) {
    activeCtx.pipelineLabel = options.label;
  }

  const stageContext: PipelineStageContext = {
    pipelineId,
    runId: runtime.runId,
    artifactsDir: runtime.artifactsDir,
    itemIndex,
    stageIndex,
    stageName: stage.name,
    agent: async (agentInput) => {
      if (stageAbortController.signal.aborted) {
        throw stageAbortController.signal.reason || new Error("Aborted");
      }
      const dsl = createDsl(runtime);
      return dsl.agent(agentInput);
    },
    log: (message: string, data?: unknown): void => {
      if (stageAbortController.signal.aborted) {
        return;
      }
      if (runtime.eventSink) {
        const payload: { message: string; data?: unknown } = { message };
        const pipelineMetadata = {
          pipelineId,
          itemIndex,
          stageName: stage.name,
          ...(data && typeof data === "object" ? data : data !== undefined ? { value: data } : {})
        };
        payload.data = pipelineMetadata;
        runtime.eventSink.emit("workflow.log", payload);
      }
    },
    agentId: (suffix?: string): string => {
      const idInput: any = {
        pipelineId,
        itemIndex,
        stageName: stage.name
      };
      if (suffix !== undefined) {
        idInput.suffix = suffix;
      }
      return createPipelineAgentId(idInput);
    },
    signal: stageAbortController.signal,
    sleep: async (ms: number): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        if (stageAbortController.signal.aborted) {
          return reject(stageAbortController.signal.reason || new Error("Aborted"));
        }
        const onAbort = () => {
          clearTimeout(timeout);
          reject(stageAbortController.signal.reason || new Error("Aborted"));
        };
        const timeout = setTimeout(() => {
          stageAbortController.signal.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        stageAbortController.signal.addEventListener("abort", onAbort);
      });
    }
  };

  let value: unknown;
  let error: unknown;
  let status: "succeeded" | "failed" | "timed_out" | "cancelled" = "succeeded";
  let onAbortListener: (() => void) | undefined;

  try {
    if (stageAbortController.signal.aborted) {
      if (timedOut || stageAbortController.signal.reason === "timeout") {
        status = "timed_out";
      } else {
        status = "cancelled";
      }
    } else {
      const abortPromise = new Promise<never>((_, reject) => {
        onAbortListener = () => {
          reject(stageAbortController.signal.reason || new Error("Aborted"));
        };
        stageAbortController.signal.addEventListener("abort", onAbortListener);
      });

      const executionPromise = withActivePipelineContext(activeCtx, async () => {
        return withToolForbidden("pipeline-stage", async () => {
          return await stage.run(item, stageContext);
        });
      });

      value = await Promise.race([executionPromise, abortPromise]);
    }
  } catch (err: any) {
    error = err;
    if (stageAbortController.signal.aborted) {
      if (timedOut || stageAbortController.signal.reason === "timeout" || err.message?.includes("timed out") || err.message?.includes("timeout")) {
        status = "timed_out";
      } else {
        status = "cancelled";
      }
    } else {
      status = "failed";
    }
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (onAbortListener) {
      stageAbortController.signal.removeEventListener("abort", onAbortListener);
    }
  }

  const finishedAt = getIsoTimestamp();
  const durationMs = getDurationMs(startedAt, finishedAt);

  let result: PipelineStageResult;
  if (status === "succeeded") {
    result = createSucceededStageResult(
      stage.name,
      stageIndex,
      startedAt,
      finishedAt,
      durationMs,
      value,
      activeCtx.childAgentIds
    );
  } else {
    let actualError = error;
    if (!actualError) {
      if (status === "timed_out") {
        actualError = new Error(`Stage '${stage.name}' timed out after ${stage.timeoutMs}ms.`);
      } else if (status === "cancelled") {
        actualError = new Error(`Stage '${stage.name}' was cancelled.`);
      } else {
        actualError = new Error(`Stage '${stage.name}' failed.`);
      }
    }
    const serializedError = serializeError(actualError);
    result = createFailedStageResult(
      stage.name,
      stageIndex,
      status,
      startedAt,
      finishedAt,
      durationMs,
      serializedError,
      activeCtx.childAgentIds
    );
  }

  // 1. Write stage artifact
  await writeStageArtifact(runtime.artifactStore, pipelineId, itemIndex, result);

  // 2. Emit stage terminal event
  if (runtime.eventSink) {
    const stageTerminalPayload = buildPipelineStageTerminalPayload(
      pipelineId,
      itemIndex,
      result
    );
    const eventType = result.status === "succeeded" ? "pipeline.stage.completed" : "pipeline.stage.failed";
    runtime.eventSink.emit(eventType, stageTerminalPayload);
  }

  return result;
}
