import type { AgentCallInput, AgentResult } from "../types/agent.js";
import type { ScheduledTask, ScheduleOptions } from "../types/scheduler.js";
import type { RuntimeState } from "./types.js";
import { resolveAgentModel } from "../agents/resolve-model.js";
import { InvalidDslCallError } from "./errors.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { PipelineStage, PipelineOptions, PipelineResult } from "../pipeline/types.js";
import { runPipeline } from "../pipeline/run.js";
import { getActivePipelineContext, recordChildAgentId } from "../pipeline/context.js";
import { createPipelineAgentId } from "../pipeline/id.js";
import { isStructuredOutputTransport } from "../structured/structured-output.js";
import {
  cacheKey,
  computeAgentFingerprint,
  materializeCachedAgentResult,
  recordCall
} from "../artifacts/call-cache.js";

type AgentStringOptions = Omit<AgentCallInput, "prompt"> & {
  optional?: boolean;
};

type AgentReviewOptions = AgentStringOptions & {
  uncommitted?: boolean;
  base?: string;
  commit?: string;
  title?: string;
};

type AgentFacade = {
  (input: AgentCallInput): Promise<AgentResult>;
  (prompt: string, options?: AgentStringOptions): Promise<string | unknown | null>;
  review(prompt: string, options?: AgentReviewOptions): Promise<string | unknown | null>;
};

export function createDsl(runtime: RuntimeState) {
  const runAgentObject = async (input: AgentCallInput): Promise<AgentResult> => {
    validateAgentInput(input);

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

    const normalizedProvider = input.provider || runtime.cli?.provider || runtime.config.defaultProvider || "mock";
    const normalizedTimeoutMs = input.timeoutMs || runtime.config.timeoutMs || 30000;
    const normalizedCwd = input.cwd || runtime.cwd;

    const resolved = resolveAgentModel({
      agentModel: input.model,
      cliModel: runtime.cli?.model,
      providerDefaultModel: runtime.config.providers?.[normalizedProvider]?.defaultModel,
      globalDefaultModel: runtime.config.defaultModel
    });
    const callId = input.id || input.label || normalizedId;
    const fingerprint = computeAgentFingerprint({
      call: input,
      provider: normalizedProvider,
      model: resolved.model,
      cwd: normalizedCwd
    });

    const cachedEntry = runtime.callCache?.previousEntries[cacheKey(callId, fingerprint)];
    if (
      runtime.callCache?.enabled &&
      runtime.callCache.previousRunRoot &&
      cachedEntry &&
      cachedEntry.status === "succeeded" &&
      runtime.artifactStore
    ) {
      const cachedResult = await materializeCachedAgentResult({
        store: runtime.artifactStore,
        previousRunRoot: runtime.callCache.previousRunRoot,
        entry: cachedEntry,
        currentAgentId: normalizedId,
        label: input.label,
        provider: normalizedProvider,
        model: resolved.model
      });
      runtime.agentResults.push(cachedResult);
      await recordCall({
        store: runtime.artifactStore,
        cache: runtime.callCache,
        callId,
        fingerprint,
        result: cachedResult
      });
      return cachedResult;
    }

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
        if (input.structuredOutput !== undefined) execInput.structuredOutput = input.structuredOutput;

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
    await recordCall({
      store: runtime.artifactStore,
      cache: runtime.callCache,
      callId,
      fingerprint,
      result
    });

    if (!result.ok && result.error?.code === ErrorCode.PROVIDER_UNAVAILABLE) {
      throw new OpenFlowError(ErrorCode.PROVIDER_UNAVAILABLE, result.error.message);
    }

    return result;
  };

  const runAgentString = async (
    prompt: string,
    options: AgentStringOptions = {}
  ): Promise<string | unknown | null> => {
    if (typeof prompt !== "string" || prompt.trim() === "") {
      throw new InvalidDslCallError("agent() prompt must be a non-empty string.");
    }

    const { optional, ...rest } = options;
    const result = await runAgentObject({ ...rest, prompt });
    if (!result.ok) {
      if (optional) {
        return null;
      }
      throw new OpenFlowError(
        (result.error.code as ErrorCode) || ErrorCode.PROVIDER_PROCESS_FAILED,
        result.error.message || "Agent execution failed."
      );
    }

    if (result.json !== undefined) {
      return result.json;
    }
    return result.text ?? "";
  };

  const agent = (async (inputOrPrompt: AgentCallInput | string, options?: AgentStringOptions) => {
    if (typeof inputOrPrompt === "string") {
      return runAgentString(inputOrPrompt, options);
    }
    return runAgentObject(inputOrPrompt);
  }) as AgentFacade;

  agent.review = async (prompt: string, options: AgentReviewOptions = {}) => {
    const { uncommitted, base, commit, title, metadata, ...rest } = options;
    return runAgentString(prompt, {
      ...rest,
      provider: "codex",
      metadata: {
        ...metadata,
        codexMode: "review",
        codexReview: {
          ...(uncommitted !== undefined ? { uncommitted } : {}),
          ...(base !== undefined ? { base } : {}),
          ...(commit !== undefined ? { commit } : {}),
          ...(title !== undefined ? { title } : {})
        }
      }
    });
  };

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

    agent,

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

function validateAgentInput(input: AgentCallInput): void {
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
  if (
    input.structuredOutput !== undefined &&
    (typeof input.structuredOutput !== "object" || input.structuredOutput === null || Array.isArray(input.structuredOutput))
  ) {
    throw new InvalidDslCallError("agent() structuredOutput must be an object when provided.");
  }
  if (
    input.structuredOutput?.transport !== undefined &&
    !isStructuredOutputTransport(input.structuredOutput.transport)
  ) {
    throw new InvalidDslCallError(
      'agent() structuredOutput.transport must be one of "validate-only", "prompt", "native", or "auto".'
    );
  }
}
