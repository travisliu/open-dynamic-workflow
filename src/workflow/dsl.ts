import type { AgentCallInput, AgentResult, AgentPermissions, DirectAgentCallInput, DefinitionAgentCallInput } from "../types/agent.js";
import type { ScheduledTask, ScheduleOptions } from "../types/scheduler.js";
import type { AgentExecutionInput } from "../agents/execution-types.js";
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
  computeAgentFingerprint,
  findPrefixCacheHit,
  materializeCachedAgentResult,
  recordCall,
  resolveCallId
} from "../artifacts/call-cache.js";
import { executeSharedAgent } from "../shared-agents/execute.js";
import { serializeError } from "../errors/serialize.js";

export function createDsl(runtime: RuntimeState) {
  const logWorkflow = (message: string, data?: unknown): void => {
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
  };

  const runDirectAgent = async (input: DirectAgentCallInput): Promise<AgentResult> => {
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

    if (input.permissions !== undefined) {
      if (typeof input.permissions !== "object" || input.permissions === null || Array.isArray(input.permissions)) {
        throw new InvalidDslCallError("agent() permissions must be an object.");
      }
      if (!("mode" in input.permissions)) {
        throw new InvalidDslCallError("agent() permissions must include a 'mode' property.");
      }
      if ((input.permissions as any).mode !== "dangerously-full-access") {
        throw new InvalidDslCallError("agent() permissions.mode must be 'dangerously-full-access'.");
      }
      const extraKeys = Object.keys(input.permissions).filter(k => k !== "mode");
      if (extraKeys.length > 0) {
        throw new InvalidDslCallError("agent() permissions object cannot contain extra keys.");
      }
    }

    const resolvedPermissions: AgentPermissions = input.permissions
      ? { mode: "dangerously-full-access" }
      : { mode: "default" };

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

    const sequence = (runtime.callSequence ?? 0) + 1;
    runtime.callSequence = sequence;
    const callId = resolveCallId(input);
    const fingerprint = computeAgentFingerprint({
      call: input,
      provider: normalizedProvider,
      model: resolved.model,
      timeoutMs: normalizedTimeoutMs,
      cwd: normalizedCwd,
      providerConfig: runtime.config.providers?.[normalizedProvider]
    });

    const cachedEntry = findPrefixCacheHit({
      cache: runtime.callCache,
      sequence,
      callId,
      fingerprint
    });
    if (cachedEntry && runtime.artifactStore && runtime.callCache?.previousRunRoot) {
      const cachedResult = await materializeCachedAgentResult({
        store: runtime.artifactStore,
        previousRunRoot: runtime.callCache.previousRunRoot,
        previousRunId: runtime.callCache.previousRunId,
        entry: cachedEntry,
        currentAgentId: normalizedId,
        label: input.label,
        provider: normalizedProvider,
        model: resolved.model
      });
      runtime.agentResults.push(cachedResult);
      runtime.eventSink?.emit("agent.cache_hit", {
        agentId: normalizedId,
        label: input.label,
        provider: normalizedProvider,
        model: resolved.model,
        sequence,
        callId,
        previousRunId: runtime.callCache.previousRunId,
        previousAgentId: cachedEntry.agentId,
        artifacts: cachedResult.artifacts
      });
      await recordCall({
        store: runtime.artifactStore,
        cache: runtime.callCache,
        sequence,
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
      permissions: resolvedPermissions,
      metadata: {
        ...input.metadata,
        modelResolutionSource: resolved.source
      },
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

        const execInput: AgentExecutionInput = {
          id: normalizedId,
          provider: normalizedProvider,
          prompt: input.prompt,
          timeoutMs: normalizedTimeoutMs,
          cwd: normalizedCwd,
          permissions: resolvedPermissions,
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
      sequence,
      callId,
      fingerprint,
      result
    });

    if (!result.ok && result.error?.code === ErrorCode.PROVIDER_UNAVAILABLE) {
      throw new OpenFlowError(ErrorCode.PROVIDER_UNAVAILABLE, result.error.message);
    }

    return result;
  };

  const runAgentCall = async (input: AgentCallInput): Promise<AgentResult> => {
    if (!input || typeof input !== "object") {
      throw new InvalidDslCallError("agent() requires an input object.");
    }
    if ("definition" in input && input.definition !== undefined) {
      if (!runtime.sharedAgentRegistry) {
        throw new OpenFlowError(
          ErrorCode.SHARED_AGENT_NOT_FOUND,
          "Shared agent registry is not available."
        );
      }
      const activePipeline = getActivePipelineContext();
      try {
        return await executeSharedAgent({
          sharedAgentId: input.definition,
          context: input,
          origin: activePipeline ? "pipeline-stage" : "workflow",
          pipeline: activePipeline ? {
            pipelineId: activePipeline.pipelineId,
            itemIndex: activePipeline.itemIndex,
            stageIndex: activePipeline.stageIndex,
            stageName: activePipeline.stageName,
            pipelineLabel: activePipeline.pipelineLabel
          } : undefined
        }, {
          registry: runtime.sharedAgentRegistry,
          config: runtime.config,
          runId: runtime.runId,
          cwd: runtime.cwd,
          artifactsDir: runtime.artifactsDir,
          signal: runtime.abortController.signal,
          agent: async (innerInput) => {
            if ("definition" in innerInput && innerInput.definition !== undefined) {
              throw new OpenFlowError(
                ErrorCode.SHARED_AGENT_RUNTIME_FAILED,
                "Nested shared agent definitions are not supported."
              );
            }
            return runDirectAgent(innerInput as any);
          },
          log: logWorkflow
        });
      } catch (err: any) {
        if (err instanceof OpenFlowError && err.code === ErrorCode.SHARED_AGENT_CONTEXT_VALIDATION_FAILED) {
          let failureAgentId = input.id;
          if (!failureAgentId) {
            if (activePipeline) {
              activePipeline.agentCounter++;
              failureAgentId = createPipelineAgentId({
                pipelineId: activePipeline.pipelineId,
                itemIndex: activePipeline.itemIndex,
                stageName: activePipeline.stageName,
                suffix: activePipeline.agentCounter.toString()
              });
            } else {
              failureAgentId = runtime.idGenerator ? runtime.idGenerator.nextId("agent") : `agent-${++runtime.agentCounter}`;
            }
          }
          if (activePipeline) {
            recordChildAgentId(failureAgentId);
          }
          
          const failureResult: AgentResult = {
            ok: false,
            status: "failed",
            id: failureAgentId,
            label: input.definition,
            provider: "mock",
            stdout: "",
            stderr: err.message,
            exitCode: null,
            durationMs: 0,
            artifacts: {
              dir: "",
              promptPath: "",
              stdoutPath: "",
              stderrPath: ""
            },
            error: serializeError(err),
            permissions: { mode: "default" },
            metadata: {
              sharedAgentId: input.definition,
              sharedAgentSource: "registry",
              ...(activePipeline ? {
                pipelineId: activePipeline.pipelineId,
                itemIndex: activePipeline.itemIndex,
                stageIndex: activePipeline.stageIndex,
                stageName: activePipeline.stageName,
                pipelineLabel: activePipeline.pipelineLabel
              } : {})
            }
          };
          runtime.agentResults.push(failureResult);
          throw err;
        }
        throw err;
      }
    }
    return runDirectAgent(input as any);
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

    log: logWorkflow,
    agent: runAgentCall,

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
