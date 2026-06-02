import type { AgentCallInput, AgentResult } from "../types/agent.js";
import type { ScheduledTask, ScheduleOptions } from "../types/scheduler.js";
import type { RuntimeState } from "./types.js";
import { resolveAgentModel } from "../agents/resolve-model.js";
import { InvalidDslCallError } from "./errors.js";
import { ExecflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { PipelineStage, PipelineOptions, PipelineResult } from "../pipeline/types.js";
import { runPipeline } from "../pipeline/run.js";
import { getActivePipelineContext, recordChildAgentId } from "../pipeline/context.js";
import { createPipelineAgentId } from "../pipeline/id.js";

export function createDsl(runtime: RuntimeState) {
  return {
    phase: (name: string): void => {
      if (!name || typeof name !== "string" || name.trim() === "") {
        throw new InvalidDslCallError("phase() requires a non-empty string for the phase name.");
      }
      if (runtime.currentPhase) {
        if (runtime.eventSink) {
          runtime.eventSink.emit("phase.completed", { name: runtime.currentPhase });
        }
      }
      runtime.currentPhase = name;
      if (runtime.eventSink) {
        runtime.eventSink.emit("phase.started", { name });
      }
    },

    log: (message: string, data?: unknown): void => {
      if (typeof message !== "string") {
        throw new InvalidDslCallError("log() message must be a string.");
      }
      if (runtime.eventSink) {
        const payload: { message: string; data?: unknown } = { message };
        if (data !== undefined) {
          payload.data = data;
        }
        runtime.eventSink.emit("workflow.log", payload);
      }
    },

    agent: async (input: AgentCallInput): Promise<AgentResult> => {
      if (!input || typeof input !== "object") {
        throw new InvalidDslCallError("agent() requires an input object.");
      }
      if (!input.prompt || typeof input.prompt !== "string" || input.prompt.trim() === "") {
        throw new InvalidDslCallError("agent() requires a non-empty prompt string.");
      }
      if (input.id !== undefined && (typeof input.id !== "string" || input.id.trim() === "")) {
        throw new InvalidDslCallError("agent() id must be a non-empty string.");
      }
      if (input.provider !== undefined && (typeof input.provider !== "string" || input.provider.trim() === "")) {
        throw new InvalidDslCallError("agent() provider must be a non-empty string.");
      }
      if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== "number" || input.timeoutMs <= 0)) {
        throw new InvalidDslCallError("agent() timeoutMs must be a positive number.");
      }
      if (input.cwd !== undefined && (typeof input.cwd !== "string" || input.cwd.trim() === "")) {
        throw new InvalidDslCallError("agent() cwd must be a non-empty string.");
      }

      // Normalization
      let normalizedId = input.id;
      const activePipeline = getActivePipelineContext();
      if (!normalizedId) {
        if (activePipeline) {
          activePipeline.agentCounter++;
          normalizedId = createPipelineAgentId({
            pipelineId: activePipeline.pipelineId,
            itemIndex: activePipeline.itemIndex,
            stageName: activePipeline.stageName,
            suffix: activePipeline.agentCounter.toString()
          });
        } else {
          normalizedId = runtime.idGenerator ? runtime.idGenerator.nextId("agent") : `agent-${++runtime.agentCounter}`;
        }
      }

      if (activePipeline) {
        recordChildAgentId(normalizedId);
      }

      const normalizedProvider = input.provider || runtime.config.defaultProvider || "mock";
      const normalizedTimeoutMs = input.timeoutMs || runtime.config.timeoutMs || 30000;
      const normalizedCwd = input.cwd || runtime.cwd;

      const resolved = resolveAgentModel({
        agentModel: input.model,
        cliModel: runtime.cli?.model,
        providerDefaultModel: runtime.config.providers?.[normalizedProvider]?.defaultModel,
        globalDefaultModel: runtime.config.defaultModel
      });

      const task: ScheduledTask<AgentResult> = {
        id: normalizedId,
        provider: normalizedProvider,
        model: resolved.model,
        run: async (schedulerSignal: AbortSignal) => {
          let finalSignal = schedulerSignal;
          let onAbort: (() => void) | undefined;

          if (activePipeline && activePipeline.stageSignal) {
            const combinedController = new AbortController();
            onAbort = () => {
              combinedController.abort(schedulerSignal.reason || activePipeline.stageSignal?.reason || "Aborted");
            };
            if (schedulerSignal.aborted) {
              combinedController.abort(schedulerSignal.reason);
            } else if (activePipeline.stageSignal.aborted) {
              combinedController.abort(activePipeline.stageSignal.reason);
            } else {
              schedulerSignal.addEventListener("abort", onAbort);
              activePipeline.stageSignal.addEventListener("abort", onAbort);
            }
            finalSignal = combinedController.signal;
          }

          const execInput: any = {
            id: normalizedId,
            provider: normalizedProvider,
            prompt: input.prompt,
            timeoutMs: normalizedTimeoutMs,
            cwd: normalizedCwd,
            signal: finalSignal,
            metadata: {
              ...input.metadata,
              modelResolutionSource: resolved.source
            }
          };
          if (input.label !== undefined) execInput.label = input.label;
          if (resolved.model !== undefined) execInput.model = resolved.model;
          if (input.schema !== undefined) execInput.schema = input.schema;

          try {
            return await runtime.agentExecutor.execute(execInput);
          } finally {
            if (onAbort) {
              schedulerSignal.removeEventListener("abort", onAbort);
              activePipeline?.stageSignal?.removeEventListener("abort", onAbort);
            }
          }
        }
      };
      if (input.label !== undefined) {
        task.label = input.label;
      }

      const scheduleOptions: ScheduleOptions = {
        provider: normalizedProvider,
        model: resolved.model,
        timeoutMs: normalizedTimeoutMs,
        failFast: runtime.failFast,
        cwd: normalizedCwd
      };

      const result = await runtime.scheduler.schedule(task, scheduleOptions);
      runtime.agentResults.push(result);

      if (!result.ok && result.error?.code === ErrorCode.PROVIDER_UNAVAILABLE) {
        throw new ExecflowError(ErrorCode.PROVIDER_UNAVAILABLE, result.error.message);
      }

      return result;
    },

    parallel: async <T>(
      tasks: Record<string, () => Promise<T>> | Array<() => Promise<T>>
    ): Promise<Record<string, T> | T[]> => {
      if (!tasks || typeof tasks !== "object") {
        throw new InvalidDslCallError("parallel() requires an array or an object of task thunks.");
      }

      if (Array.isArray(tasks)) {
        const promises = tasks.map((task, idx) => {
          if (typeof task !== "function") {
            throw new InvalidDslCallError(`parallel() task at index ${idx} must be a function.`);
          }
          return task();
        });
        return Promise.all(promises);
      } else {
        const keys = Object.keys(tasks);
        const promises = keys.map((key) => {
          const task = tasks[key];
          if (typeof task !== "function") {
            throw new InvalidDslCallError(`parallel() task '${key}' must be a function.`);
          }
          return task();
        });
        const results = await Promise.all(promises);
        const resultObj: Record<string, T> = {};
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i]!;
          resultObj[key] = results[i]!;
        }
        return resultObj;
      }
    },

    pipeline: async <I, O>(
      items: I[],
      stages: PipelineStage<any, any>[],
      options?: PipelineOptions
    ): Promise<PipelineResult<O>> => {
      return runPipeline({
        items,
        stages,
        options,
        runtime,
        signal: runtime.abortController.signal
      });
    }
  };
}
