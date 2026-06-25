import type { AgentCallInput, AgentResult, AgentPermissions, DirectAgentCallInput } from "../types/agent.js";
import type { ScheduledTask, ScheduleOptions } from "../types/scheduler.js";
import type { AgentExecutionInput } from "../agents/execution-types.js";
import type { RuntimeState } from "./types.js";
import { resolveAgentModel } from "../agents/resolve-model.js";
import { isThinkingEffort } from "../types/thinking-effort.js";
import { resolveThinkingEffort } from "../agents/resolve-thinking-effort.js";

import { InvalidDslCallError } from "./errors.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { runPipeline } from "../pipeline/run.js";
import { getActivePipelineContext, recordChildAgentId } from "../pipeline/context.js";
import { createPipelineAgentId } from "../pipeline/id.js";
import { isStructuredOutputTransport } from "../structured/structured-output.js";
import {
  computeAgentFingerprint,
  computeToolFingerprint,
  findPrefixCacheHit,
  materializeCachedAgentResult,
  materializeCachedToolResult,
  recordAgentCall,
  recordToolCall,
  resolveCallId
} from "../artifacts/call-cache.js";
import { executeSharedAgent } from "../shared-agents/execute.js";
import { serializeError } from "../errors/serialize.js";
import { cloneJsonValue } from "./json.js";
import { getActiveWorkflowInvocation } from "./invocation-types.js";
import { assertLoopContextToolAllowed, assertToolAllowed, withToolForbidden } from "./scope.js";
import { runLoop } from "../loop/run.js";
import {
  getActiveLoopContext,
  recordLoopChildAgentId,
  recordLoopChildToolCallId,
  type ActiveLoopContext
} from "../loop/context.js";
import { createLoopAgentId, normalizeLoopLabel } from "../loop/id.js";
import { collectSecretValues } from "../security/env.js";
import type { ToolCallInput, ToolExecutionResult, ToolSettledResult, ToolFailureMode } from "../types/tool.js";
import type { PreparedToolCall } from "../tools/executor-types.js";
import type { 
  PipelineStage, 
  PipelineOptions, 
  PipelineResult, 
  WorkflowCallInput, 
  WorkflowSettledResult 
} from "../types/workflow.js";

function normalizeToolCallInput(input: unknown, runtime: RuntimeState): ToolCallInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidDslCallError("tool() requires an input object.");
  }

  const allowedKeys = ["definition", "args", "id", "label", "timeoutMs", "failureMode", "metadata"];
  const unknownKeys = Object.keys(input).filter(k => !allowedKeys.includes(k));
  if (unknownKeys.length > 0) {
    throw new InvalidDslCallError(`tool() call contains unknown keys: ${unknownKeys.join(", ")}`);
  }

  const typedInput = input as ToolCallInput;

  if (!typedInput.definition || typeof typedInput.definition !== "string") {
    throw new InvalidDslCallError("tool() 'definition' must be a non-empty string.");
  }

  if (typedInput.args === undefined) {
    throw new InvalidDslCallError("tool() 'args' is required.");
  }

  if (typedInput.id !== undefined) {
    if (typeof typedInput.id !== "string" || typedInput.id.trim() === "") {
      throw new InvalidDslCallError("tool() 'id' must be a non-empty string.");
    }
    if (/[^a-zA-Z0-9_-]/.test(typedInput.id)) {
      throw new InvalidDslCallError(`tool() 'id' contains unsafe characters: "${typedInput.id}"`);
    }
    if (runtime.toolCallIds?.has(typedInput.id)) {
      throw new InvalidDslCallError(`tool() 'id' is already used in this run: "${typedInput.id}"`);
    }
  }

  if (typedInput.timeoutMs !== undefined) {
    if (typeof typedInput.timeoutMs !== "number" || typedInput.timeoutMs <= 0 || !Number.isInteger(typedInput.timeoutMs)) {
      throw new InvalidDslCallError("tool() 'timeoutMs' must be a positive integer.");
    }
  }

  if (typedInput.failureMode !== undefined && typedInput.failureMode !== "throw" && typedInput.failureMode !== "settled") {
    throw new InvalidDslCallError('tool() \'failureMode\' must be "throw" or "settled".');
  }

  if (typedInput.label !== undefined && (typeof typedInput.label !== "string" || typedInput.label.trim() === "")) {
    throw new InvalidDslCallError("tool() 'label' must be a non-empty string.");
  }

  if (typedInput.metadata !== undefined) {
    if (typeof typedInput.metadata !== "object" || typedInput.metadata === null || Array.isArray(typedInput.metadata)) {
      throw new InvalidDslCallError("tool() 'metadata' must be an object.");
    }
    const proto = Object.getPrototypeOf(typedInput.metadata);
    if (proto !== null && proto.constructor?.name !== "Object") {
      throw new InvalidDslCallError("tool() 'metadata' must be a plain object.");
    }
    try {
      cloneJsonValue(typedInput.metadata, "tool metadata");
    } catch (err: any) {
      throw new OpenDynamicWorkflowError(ErrorCode.TOOL_SERIALIZATION_FAILED, err.message, { cause: err });
    }
  }

  // Also validate args for serializability early
  try {
    cloneJsonValue(typedInput.args, "tool args");
  } catch (err: any) {
    throw new OpenDynamicWorkflowError(ErrorCode.TOOL_SERIALIZATION_FAILED, err.message, { cause: err });
  }

  return typedInput;
}

function nextToolCallId(runtime: RuntimeState, definitionId: string): string {
  const counter = (runtime.toolCounter || 0) + 1;
  runtime.toolCounter = counter;
  const suffix = definitionId.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  return `tool-${counter.toString().padStart(4, "0")}-${suffix}`;
}

interface ToolExecutionOrigin {
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  loop?: ActiveLoopContext | undefined;
}

export function createDsl(runtime: RuntimeState) {
  const logWorkflow = (message: string, data?: unknown): void => {
    if (typeof message !== "string") {
      throw new InvalidDslCallError("log() message must be a string.");
    }
    if (runtime.eventSink) {
      const activeInvocation = getActiveWorkflowInvocation();
      const payload: { message: string; data?: unknown; workflowInvocationId?: string } = { message };
      if (activeInvocation) {
        payload.workflowInvocationId = activeInvocation.workflowInvocationId;
      }
      if (data !== undefined) {
        payload.data = data;
      }
      runtime.eventSink.emit("workflow.log", payload);
    }
  };

  const runDirectAgent = async (input: DirectAgentCallInput): Promise<AgentResult> => {
    const activeInvocation = getActiveWorkflowInvocation();
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

    if (input.thinkingEffort !== undefined) {
      if (!isThinkingEffort(input.thinkingEffort)) {
        throw new InvalidDslCallError(
          `agent() thinkingEffort must be one of: "off", "minimal", "low", "medium", "high", "xhigh".`
        );
      }
    }


    const resolvedPermissions: AgentPermissions = input.permissions
      ? { mode: "dangerously-full-access" }
      : { mode: "default" };

    const originMetadata = activeInvocation ? {
      workflowInvocationId: activeInvocation.workflowInvocationId,
      parentWorkflowInvocationId: activeInvocation.parentWorkflowInvocationId,
      workflowName: activeInvocation.workflowName,
      workflowDepth: activeInvocation.depth
    } : {};

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

    const activeLoop = getActiveLoopContext();
    if (activeLoop) {
      const activeInvocation = getActiveWorkflowInvocation();
      const isChildWorkflow = !!(activeInvocation && activeLoop.workflowInvocationId && activeInvocation.workflowInvocationId !== activeLoop.workflowInvocationId);

      normalizedId = resolveLoopAgentId(normalizedId, input, activeLoop, isChildWorkflow, runtime);
      recordLoopChildAgentId(normalizedId);
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

    const resolvedThinking = resolveThinkingEffort({
      agentThinkingEffort: input.thinkingEffort,
      cliThinkingEffort: runtime.cli?.thinkingEffort,
      providerDefaultThinkingEffort: runtime.config.providers?.[normalizedProvider]?.defaultThinkingEffort
    });


    const sequence = (runtime.callSequence ?? 0) + 1;
    runtime.callSequence = sequence;
    const callId = resolveCallId(input, normalizedId);
    const fingerprint = computeAgentFingerprint({
      call: input,
      provider: normalizedProvider,
      model: resolved.model,
      timeoutMs: normalizedTimeoutMs,
      cwd: normalizedCwd,
      providerConfig: runtime.config.providers?.[normalizedProvider],
      thinkingEffort: resolvedThinking.thinkingEffort
    });


    const cachedEntry = findPrefixCacheHit({
      cache: runtime.callCache,
      kind: "agent",
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
        model: resolved.model,
        permissions: resolvedPermissions
      });
      const artifactResult = (cachedResult as any).__artifactResult || cachedResult;
      runtime.agentResults.push(artifactResult);
      runtime.eventSink?.emit("agent.cache_hit", {
        agentId: normalizedId,
        label: input.label,
        provider: normalizedProvider,
        model: resolved.model,
        sequence,
        callId,
        previousRunId: runtime.callCache.previousRunId,
        previousAgentId: cachedEntry.agentId,
        artifacts: artifactResult.artifacts
      });
      await recordAgentCall({
        store: runtime.artifactStore,
        cache: runtime.callCache,
        sequence,
        callId,
        fingerprint,
        result: artifactResult
      });
      return cachedResult;
    }

    runtime.runLimitTracker?.beforeAgentSchedule(normalizedId);

    const task: ScheduledTask<AgentResult> = {
      id: normalizedId,
      provider: normalizedProvider,
      model: resolved.model,
      permissions: resolvedPermissions,
      metadata: {
        ...input.metadata,
        ...originMetadata,
        modelResolutionSource: resolved.source,
        thinkingEffortResolutionSource: resolvedThinking.source,
        ...(resolvedThinking.thinkingEffort !== undefined ? { thinkingEffort: resolvedThinking.thinkingEffort } : {})
      },

      run: async (schedulerSignal: AbortSignal) => {
        let finalSignal = schedulerSignal;
        let onAbort: (() => void) | undefined;

        const invocationSignal = activeInvocation?.signal;
        const activeLoop = getActiveLoopContext();
        const loopSignal = activeLoop?.signal;

        if ((activePipeline && activePipeline.stageSignal) || invocationSignal || loopSignal) {
          const combinedController = new AbortController();
          onAbort = () => {
            combinedController.abort(
              schedulerSignal.reason || 
              activePipeline?.stageSignal?.reason || 
              invocationSignal?.reason || 
              loopSignal?.reason ||
              "Aborted"
            );
          };
          if (schedulerSignal.aborted) {
            combinedController.abort(schedulerSignal.reason);
          } else if (activePipeline?.stageSignal?.aborted) {
            combinedController.abort(activePipeline.stageSignal.reason);
          } else if (invocationSignal?.aborted) {
            combinedController.abort(invocationSignal.reason);
          } else if (loopSignal?.aborted) {
            combinedController.abort(loopSignal.reason);
          } else {
            schedulerSignal.addEventListener("abort", onAbort);
            if (activePipeline?.stageSignal) {
              activePipeline.stageSignal.addEventListener("abort", onAbort);
            }
            if (invocationSignal) {
              invocationSignal.addEventListener("abort", onAbort);
            }
            if (loopSignal) {
              loopSignal.addEventListener("abort", onAbort);
            }
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
            ...originMetadata,
            modelResolutionSource: resolved.source,
            thinkingEffortResolutionSource: resolvedThinking.source,
            ...(resolvedThinking.thinkingEffort !== undefined ? { thinkingEffort: resolvedThinking.thinkingEffort } : {})
          }
        };
        if (input.label !== undefined) execInput.label = input.label;
        if (resolved.model !== undefined) execInput.model = resolved.model;
        if (input.schema !== undefined) execInput.schema = input.schema;
        if (input.structuredOutput !== undefined) execInput.structuredOutput = input.structuredOutput;
        if (resolvedThinking.thinkingEffort !== undefined) execInput.thinkingEffort = resolvedThinking.thinkingEffort;


        try {
          return await runtime.agentExecutor.execute(execInput);
        } finally {
          if (onAbort) {
            schedulerSignal.removeEventListener("abort", onAbort);
            if (activePipeline?.stageSignal) {
              activePipeline.stageSignal.removeEventListener("abort", onAbort);
            }
            invocationSignal?.removeEventListener("abort", onAbort);
            loopSignal?.removeEventListener("abort", onAbort);
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

    if (activeInvocation?.concurrencyBudget) {
      await activeInvocation.concurrencyBudget.acquire();
    }
    
    try {
      const result = await runtime.scheduler.schedule(task, scheduleOptions);
      runtime.agentResults.push(result);
      await recordAgentCall({
        store: runtime.artifactStore,
        cache: runtime.callCache,
        sequence,
        callId,
        fingerprint,
        result
      });

      if (!result.ok && result.error?.code === ErrorCode.PROVIDER_UNAVAILABLE) {
        throw new OpenDynamicWorkflowError(ErrorCode.PROVIDER_UNAVAILABLE, result.error.message);
      }

      return result;
    } finally {
      if (activeInvocation?.concurrencyBudget) {
        activeInvocation.concurrencyBudget.release();
      }
    }
  };

  const runAgentCall = async (input: AgentCallInput): Promise<AgentResult> => {
    if (!input || typeof input !== "object") {
      throw new InvalidDslCallError("agent() requires an input object.");
    }

    const activeLoop = getActiveLoopContext();
    if (activeLoop?.signal.aborted) {
      throw activeLoop.signal.reason;
    }

    if ("definition" in input && input.definition !== undefined) {
      if (!runtime.sharedAgentRegistry) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.SHARED_AGENT_NOT_FOUND,
          "Shared agent registry is not available."
        );
      }
      const activePipeline = getActivePipelineContext();
      const activeInvocation = getActiveWorkflowInvocation();
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
          signal: activeInvocation?.signal || runtime.abortController.signal,
          agent: async (innerInput) => {
            if ("definition" in innerInput && innerInput.definition !== undefined) {
              throw new OpenDynamicWorkflowError(
                ErrorCode.SHARED_AGENT_RUNTIME_FAILED,
                "Nested shared agent definitions are not supported."
              );
            }
            return runDirectAgent(innerInput as any);
          },
          log: logWorkflow
        });
      } catch (err: any) {
        if (err instanceof OpenDynamicWorkflowError && err.code === ErrorCode.SHARED_AGENT_CONTEXT_VALIDATION_FAILED) {
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

  const workflowFunction = async <T>(input: WorkflowCallInput): Promise<T | WorkflowSettledResult<T>> => {
    const activeInvocation = getActiveWorkflowInvocation();
    if (!activeInvocation) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.WORKFLOW_FAILED,
        "workflow() can only be called from within a workflow invocation."
      );
    }
    if (!runtime.invocationManager) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.WORKFLOW_FAILED,
        "Workflow invocation manager is not available."
      );
    }

    const activeLoop = getActiveLoopContext();
    if (activeLoop?.signal.aborted) {
      throw activeLoop.signal.reason;
    }

    let effectiveParent = activeInvocation;
    let onAbort: (() => void) | undefined;

    if (activeLoop?.signal) {
      const combinedController = new AbortController();
      onAbort = () => {
        combinedController.abort(activeLoop.signal.reason || activeInvocation.signal.reason || "Aborted");
      };
      if (activeLoop.signal.aborted) {
        combinedController.abort(activeLoop.signal.reason);
      } else if (activeInvocation.signal.aborted) {
        combinedController.abort(activeInvocation.signal.reason);
      } else {
        activeLoop.signal.addEventListener("abort", onAbort);
        activeInvocation.signal.addEventListener("abort", onAbort);
      }
      effectiveParent = {
        ...activeInvocation,
        signal: combinedController.signal,
        abortController: combinedController,
      };
    }

    try {
      const result = await runtime.invocationManager.invokeChild<T>(effectiveParent, input);
      return result;
    } finally {
      if (onAbort) {
        activeLoop?.signal.removeEventListener("abort", onAbort);
        activeInvocation.signal.removeEventListener("abort", onAbort);
      }
    }
  };

  const parallelFunction = async <T>(
    tasks: Record<string, () => Promise<T>> | Array<() => Promise<T>>
  ): Promise<Record<string, T> | T[]> => {
    if (!tasks || typeof tasks !== "object") {
      throw new InvalidDslCallError("parallel() requires an array or an object of task thunks.");
    }

    const activeLoop = getActiveLoopContext();
    if (activeLoop?.signal.aborted) {
      throw activeLoop.signal.reason;
    }

    if (Array.isArray(tasks)) {
      const promises = tasks.map((task, idx) => {
        if (typeof task !== "function") {
          throw new InvalidDslCallError(`parallel() task at index ${idx} must be a function.`);
        }
        return withToolForbidden("parallel-task", () => task());
      });
      return Promise.all(promises);
    } else {
      const keys = Object.keys(tasks);
      const promises = keys.map((key) => {
        const task = tasks[key];
        if (typeof task !== "function") {
          throw new InvalidDslCallError(`parallel() task '${key}' must be a function.`);
        }
        return withToolForbidden("parallel-task", () => task());
      });
      const results = await Promise.all(promises);
      const resultObj: Record<string, T> = {};
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        resultObj[key] = results[i]!;
      }
      return resultObj;
    }
  };

  const executeToolCall = async (
    input: ToolCallInput,
    origin: ToolExecutionOrigin
  ): Promise<unknown> => {
    const activeLoop = origin.loop ?? getActiveLoopContext();
    if (activeLoop?.signal.aborted) {
      throw activeLoop.signal.reason;
    }

    const normalizedInput = normalizeToolCallInput(input, runtime);
    
    if (!runtime.toolRegistry || !runtime.toolExecutor) {
      throw new OpenDynamicWorkflowError(ErrorCode.TOOL_INVALID_CONTEXT, "tool() is not configured for this run.");
    }

    const definition = runtime.toolRegistry.require(normalizedInput.definition);
    
    const inputValidation = definition.validateInput(normalizedInput.args);
    if (!inputValidation.ok) {
      const errors = inputValidation.errors.map(e => `${e.path} ${e.message}`).join(", ");
      throw new OpenDynamicWorkflowError(
        ErrorCode.TOOL_INVALID_INPUT,
        `Input validation failed for tool '${normalizedInput.definition}': ${errors}`
      );
    }

    let toolCallId = normalizedInput.id;
    if (!toolCallId) {
      toolCallId = nextToolCallId(runtime, normalizedInput.definition);
    }
    runtime.toolCallIds?.add(toolCallId);
    if (origin.loop) {
      recordLoopChildToolCallId(toolCallId);
    }

    const activeInvocation = getActiveWorkflowInvocation();
    const failureMode = normalizedInput.failureMode || "throw";

    let invocationSignal = activeInvocation?.signal || runtime.abortController.signal;
    let onAbort: (() => void) | undefined;
    if (activeLoop?.signal) {
      const combinedController = new AbortController();
      onAbort = () => combinedController.abort(activeLoop.signal.reason || invocationSignal.reason);
      if (activeLoop.signal.aborted) {
        combinedController.abort(activeLoop.signal.reason);
      } else if (invocationSignal.aborted) {
        combinedController.abort(invocationSignal.reason);
      } else {
        activeLoop.signal.addEventListener("abort", onAbort);
        invocationSignal.addEventListener("abort", onAbort);
      }
      invocationSignal = combinedController.signal;
    }

    try {
      const preparedCall: PreparedToolCall = {
        toolCallId,
        definition,
        args: cloneJsonValue(normalizedInput.args, "tool args"),
        label: normalizedInput.label,
        failureMode,
        timeoutMs: normalizedInput.timeoutMs || definition.definition.defaultTimeoutMs,
        deadline: activeInvocation?.deadlineAt,
        metadata: normalizedInput.metadata ? (cloneJsonValue(normalizedInput.metadata, "tool metadata") as Record<string, unknown>) : undefined,
        workflowInvocationId: origin.workflowInvocationId,
        parentWorkflowInvocationId: origin.parentWorkflowInvocationId,
        queuedAt: new Date().toISOString(),
        artifactPath: `tools/${toolCallId}/output.json`,
        invocationSignal,
        origin: origin.loop ? {
          kind: "loop-round",
          loopId: origin.loop.loopId,
          loopLabel: origin.loop.label,
          roundIndex: origin.loop.roundIndex,
          roundNumber: origin.loop.roundNumber,
          roundId: origin.loop.roundId
        } : undefined
      };

      const isCacheable = !!definition.definition.cacheable;
      let sequence: number | undefined;
      let fingerprint: string | undefined;
      let callId: string | undefined;

      if (isCacheable) {
        sequence = (runtime.callSequence ?? 0) + 1;
        runtime.callSequence = sequence;
        callId = normalizedInput.id ?? normalizedInput.label;
        fingerprint = computeToolFingerprint({
          definitionId: definition.definition.id,
          args: preparedCall.args,
          timeoutMs: preparedCall.timeoutMs,
          metadata: preparedCall.metadata,
          sourcePath: definition.sourcePath,
          definitionVersion: definition.definition.metadata?.version
        });

        const cachedEntry = findPrefixCacheHit({
          cache: runtime.callCache,
          kind: "tool",
          sequence,
          callId,
          fingerprint
        });

        if (cachedEntry && runtime.artifactStore && runtime.callCache?.previousRunRoot) {
          const cachedResult = await materializeCachedToolResult({
            store: runtime.artifactStore,
            previousRunRoot: runtime.callCache.previousRunRoot,
            previousRunId: runtime.callCache.previousRunId,
            entry: cachedEntry,
            currentToolCallId: toolCallId,
            definitionId: definition.definition.id,
            failureMode,
            label: normalizedInput.label,
            workflowInvocationId: origin.workflowInvocationId,
            parentWorkflowInvocationId: origin.parentWorkflowInvocationId,
            origin: preparedCall.origin,
            runId: runtime.runId,
            args: preparedCall.args,
            timeoutMs: preparedCall.timeoutMs,
            metadata: preparedCall.metadata,
            redactedSecrets: collectSecretValues(process.env, runtime.config?.security?.redactEnv)
          });

          runtime.eventSink?.emit("tool.cache_hit", {
            toolCallId,
            definition: definition.definition.id,
            label: normalizedInput.label,
            sequence,
            callId,
            previousRunId: runtime.callCache.previousRunId,
            previousToolCallId: cachedEntry.toolCallId,
            artifactPath: cachedResult.artifactPath,
            workflowInvocationId: preparedCall.workflowInvocationId,
            ...(preparedCall.origin || {})
          });

          await recordToolCall({
            store: runtime.artifactStore,
            cache: runtime.callCache,
            sequence,
            callId,
            fingerprint,
            result: cachedResult
          });

          const toolResult = returnToolResult(cachedResult, failureMode);
          runtime.toolResults.push(cachedResult);
          if (runtime.toolExecutor) {
            runtime.toolExecutor.addSummary({
              toolCallId: cachedResult.toolCallId,
              definition: cachedResult.definitionId,
              status: cachedResult.status,
              ok: cachedResult.ok,
              workflowInvocationId: cachedResult.workflowInvocationId,
              parentWorkflowInvocationId: cachedResult.parentWorkflowInvocationId,
              origin: preparedCall.origin,
              durationMs: cachedResult.durationMs,
              artifactPath: cachedResult.artifactPath!,
              cache: cachedResult.cache
            });
          }
          return toolResult;
        }
      } else {
        if (runtime.callCache) {
          runtime.callCache.prefixCacheUsable = false;
        }
      }

      const result = await runtime.toolExecutor.execute(preparedCall);

      if (isCacheable && sequence !== undefined && fingerprint !== undefined) {
        await recordToolCall({
          store: runtime.artifactStore,
          cache: runtime.callCache,
          sequence,
          callId,
          fingerprint,
          result
        });
      }

      runtime.toolResults.push(result);
      return returnToolResult(result, failureMode);
    } finally {
      if (onAbort) {
        activeLoop?.signal.removeEventListener("abort", onAbort);
        const originalInvocationSignal = activeInvocation?.signal || runtime.abortController.signal;
        originalInvocationSignal.removeEventListener("abort", onAbort);
      }
    }
  };

  const runTool = async (input: ToolCallInput): Promise<unknown> => {
    const scope = assertToolAllowed();
    return executeToolCall(input, {
      workflowInvocationId: scope.workflowInvocationId,
      parentWorkflowInvocationId: scope.parentWorkflowInvocationId
    });
  };

  const runLoopTool = async (input: ToolCallInput): Promise<unknown> => {
    const activeLoop = getActiveLoopContext();
    if (!activeLoop) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.TOOL_INVALID_CONTEXT,
        "ctx.tool() requires an active loop round."
      );
    }
    assertLoopContextToolAllowed();
    if (activeLoop.activeToolPromise) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.TOOL_INVALID_CONTEXT,
        `ctx.tool() calls must run serially inside loop '${activeLoop.label}' round ${activeLoop.roundNumber}.`
      );
    }

    const activeInvocation = getActiveWorkflowInvocation();
    const promise = executeToolCall(input, {
      workflowInvocationId: activeInvocation?.workflowInvocationId ?? activeLoop.workflowInvocationId ?? runtime.runId,
      parentWorkflowInvocationId: activeInvocation?.parentWorkflowInvocationId,
      loop: activeLoop
    });
    activeLoop.activeToolPromise = promise;
    try {
      return await promise;
    } finally {
      activeLoop.activeToolPromise = undefined;
    }
  };

  function returnToolResult(result: ToolExecutionResult, failureMode: ToolFailureMode): unknown {
    if (failureMode === "throw") {
      if (!result.ok) {
        let code: ErrorCode = ErrorCode.TOOL_EXECUTION_FAILED;
        if (result.status === "cancelled") code = ErrorCode.TOOL_CANCELLED;
        if (result.status === "timed_out") code = ErrorCode.TOOL_TIMEOUT;

        const error = result.error || { name: "ToolExecutionError", message: `Tool execution failed` };
        throw new OpenDynamicWorkflowError(
          code,
          `Tool execution ${result.status}: ${error.message}`,
          { cause: error }
        );
      }
      return result.output;
    }

    if (result.ok) {
      return {
        status: result.status,
        ok: true,
        toolCallId: result.toolCallId,
        definition: result.definitionId,
        value: result.output,
        startedAt: result.startedAt!,
        finishedAt: result.finishedAt!,
        durationMs: result.durationMs,
        artifactPath: result.artifactPath!
      } as ToolSettledResult;
    }

    return {
      status: result.status as any,
      ok: false,
      toolCallId: result.toolCallId,
      definition: result.definitionId,
      error: result.error?.error || {
        name: "ToolExecutionError",
        message: result.error?.message || `Tool failed`,
        code: result.error?.code
      },
      startedAt: result.startedAt,
      finishedAt: result.finishedAt!,
      durationMs: result.durationMs,
      artifactPath: result.artifactPath!
    } as ToolSettledResult;
  }


  return {
    phase: (name: string): void => {
      if (!name || typeof name !== "string" || name.trim() === "") {
        throw new InvalidDslCallError("phase() requires a non-empty string for the phase name.");
      }
      
      const activeInvocation = getActiveWorkflowInvocation();
      const currentPhase = activeInvocation ? activeInvocation.currentPhase : runtime.currentPhase;
      
      if (currentPhase) {
        if (runtime.eventSink) {
          runtime.eventSink.emit("phase.completed", { name: currentPhase });
        }
      }
      
      if (activeInvocation) {
        activeInvocation.currentPhase = name;
      } else {
        runtime.currentPhase = name;
      }
      
      if (runtime.eventSink) {
        runtime.eventSink.emit("phase.started", { name });
      }
    },

    log: logWorkflow,
    agent: runAgentCall,
    tool: runTool,

    parallel: parallelFunction,

    pipeline: async <I, O>(
      items: I[],
      stages: PipelineStage<any, any>[],
      options?: PipelineOptions
    ): Promise<PipelineResult<O>> => {
      const activeInvocation = getActiveWorkflowInvocation();
      return runPipeline({
        items,
        stages,
        options: options || {},
        runtime,
        signal: activeInvocation?.signal || runtime.abortController.signal
      });
    },

    workflow: workflowFunction,

    loop: async (input: any) => {
      const activeInvocation = getActiveWorkflowInvocation();
      return runLoop({
        loopInput: input,
        runtime,
        signal: activeInvocation?.signal || runtime.abortController.signal,
        dsl: {
          agent: runAgentCall,
          workflow: workflowFunction,
          tool: runLoopTool,
          log: logWorkflow
        }
      });
    }
  };
}

function isSafeAgentId(id: string | undefined): boolean {
  if (!id) return false;
  const trimmed = id.trim();
  const pattern = /^[A-Za-z0-9_.:-]+$/;
  return (
    trimmed !== "" &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    !trimmed.includes("..") &&
    pattern.test(trimmed)
  );
}

function resolveLoopAgentId(
  currentId: string,
  input: { id?: string | undefined; label?: string | undefined },
  activeLoop: ActiveLoopContext,
  isChildWorkflow: boolean,
  runtime: RuntimeState
): string {
  const normalizedLabel = normalizeLoopLabel(activeLoop.label);
  const loopPrefix = `${normalizedLabel}:round-${activeLoop.roundNumber}`;

  if (currentId === loopPrefix || currentId.startsWith(loopPrefix + ":")) {
    return currentId;
  }

  let suffix: string | undefined;
  if (isChildWorkflow && input.id) {
    suffix = input.id;
  } else if (!input.id) {
    suffix = isSafeAgentId(input.label) ? input.label!.trim() : `agent-${++runtime.agentCounter}`;
  }

  return suffix !== undefined
    ? createLoopAgentId({ label: activeLoop.label, roundNumber: activeLoop.roundNumber, suffix })
    : currentId;
}
