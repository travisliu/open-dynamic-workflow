import * as path from "node:path";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { serializeError } from "../errors/serialize.js";
import type { SerializedError } from "../types/errors.js";
import type { ToolExecutionResult, ToolSummary, ToolExecutionContext } from "../types/tool.js";
import type { ToolExecutor, ToolExecutorDependencies, PreparedToolCall } from "./executor-types.js";
import { ToolLimiter } from "../orchestration/tool-limiter.js";
import * as artifacts from "./artifacts.js";
import { serializeToolValue, createPreview, redactAndBoundValue } from "./serialization.js";
import { createLinkedAbortController } from "../orchestration/cancellation.js";
import { redactText } from "../security/env.js";

export class DefaultToolExecutor implements ToolExecutor {
  private readonly limiter: ToolLimiter;
  private readonly summaries: ToolSummary[] = [];
  private readonly running = new Set<string>();
  private readonly runningPromises = new Set<Promise<any>>();
  private readonly abortController = new AbortController();
  private closed = false;
  private cancelReason?: SerializedError;

  constructor(private readonly deps: ToolExecutorDependencies) {
    this.limiter = new ToolLimiter(deps.concurrency);
    
    // Listen to root signal
    if (deps.rootSignal) {
      if (deps.rootSignal.aborted) {
        this.cancel(serializeError(new OpenDynamicWorkflowError(ErrorCode.USER_CANCELLED, "Root signal already aborted")));
      } else {
        deps.rootSignal.addEventListener("abort", () => {
          this.cancel(serializeError(new OpenDynamicWorkflowError(ErrorCode.USER_CANCELLED, "Root signal aborted")));
        }, { once: true });
      }
    }
  }

  async execute<TOutput>(call: PreparedToolCall): Promise<ToolExecutionResult<TOutput>> {
    const promise = this.doExecute<TOutput>(call);
    this.runningPromises.add(promise);
    try {
      return await promise;
    } finally {
      this.runningPromises.delete(promise);
    }
  }

  private async doExecute<TOutput>(call: PreparedToolCall): Promise<ToolExecutionResult<TOutput>> {
    if (this.closed || this.cancelReason) {
      const error = this.cancelReason || serializeError(new OpenDynamicWorkflowError(ErrorCode.USER_CANCELLED, "Tool executor cancelled"));
      return this.terminalFailure(call, error, "cancelled", 0);
    }

    const startTime = this.deps.clock ? this.deps.clock.now().getTime() : Date.now();
    const toolCallId = call.toolCallId;
    const secrets = this.deps.redactedSecrets || [];
    
    // WORKSTREAM-003: Serialize and validate JSON compatibility before writing
    let serializedArgs: any;
    try {
      serializedArgs = serializeToolValue(call.args, "tool args", secrets);
    } catch (error: any) {
      return {
        toolCallId,
        definitionId: call.definition.definition.id,
        status: "failed",
        ok: false,
        error: {
          code: ErrorCode.TOOL_SERIALIZATION_FAILED,
          message: error.message,
          error: serializeError(error)
        },
        durationMs: 0,
        workflowInvocationId: call.workflowInvocationId,
        parentWorkflowInvocationId: call.parentWorkflowInvocationId,
        origin: call.origin,
        artifactPath: call.artifactPath
      };
    }

    // Prepare metadata with project-relative source path
    const definitionSourcePath = path.relative(this.deps.cwd, call.definition.sourcePath);
    const fullMetadata: any = {
      schemaVersion: "open-dynamic-workflow.tool.v1",
      runId: this.deps.runId,
      toolCallId,
      definition: call.definition.definition.id,
      definitionSourcePath,
      workflowInvocationId: call.workflowInvocationId,
      status: "queued",
      queuedAt: call.queuedAt
    };
    if (call.label !== undefined) fullMetadata.label = call.label;
    if (call.parentWorkflowInvocationId !== undefined) fullMetadata.parentWorkflowInvocationId = call.parentWorkflowInvocationId;
    if (call.timeoutMs !== undefined) fullMetadata.effectiveTimeoutMs = call.timeoutMs;
    if (call.metadata !== undefined) fullMetadata.metadata = call.metadata;
    if (call.origin !== undefined) fullMetadata.origin = call.origin;

    let serializedMetadata: any;
    try {
      serializedMetadata = serializeToolValue(fullMetadata, "tool metadata", secrets);
    } catch (error: any) {
      return {
        toolCallId,
        definitionId: call.definition.definition.id,
        status: "failed",
        ok: false,
        error: {
          code: ErrorCode.TOOL_SERIALIZATION_FAILED,
          message: error.message,
          error: serializeError(error)
        },
        durationMs: 0,
        workflowInvocationId: call.workflowInvocationId,
        parentWorkflowInvocationId: call.parentWorkflowInvocationId,
        origin: call.origin,
        artifactPath: call.artifactPath
      };
    }

    try {
      // Initial artifacts
      await artifacts.writeToolInput(this.deps.artifactStore, toolCallId, serializedArgs);
      await artifacts.writeToolMetadata(this.deps.artifactStore, toolCallId, serializedMetadata);
    } catch (error: any) {
      return {
        toolCallId,
        definitionId: call.definition.definition.id,
        status: "failed",
        ok: false,
        error: {
          code: ErrorCode.TOOL_ARTIFACT_WRITE_FAILED,
          message: error.message,
          error: serializeError(error)
        },
        durationMs: 0,
        workflowInvocationId: call.workflowInvocationId,
        parentWorkflowInvocationId: call.parentWorkflowInvocationId,
        origin: call.origin,
        artifactPath: call.artifactPath
      };
    }

    this.emit("tool.queued", this.createEventPayload(call, {
      status: "queued",
      inputPreview: createPreview(serializedArgs, secrets),
      metadata: serializedMetadata
    }));

    let release: (() => void) | undefined;
    const callAbortController = createLinkedAbortController(call.invocationSignal, this.abortController.signal);
    
    let timeoutTimer: NodeJS.Timeout | null = null;
    let startedAt: string | undefined;
    
    // Calculate effective timeout including deadline
    const now = this.deps.clock ? this.deps.clock.now().getTime() : Date.now();
    let effectiveTimeoutMs = call.timeoutMs;
    if (call.deadline) {
      const msUntilDeadline = call.deadline - now;
      if (effectiveTimeoutMs === undefined || msUntilDeadline < effectiveTimeoutMs) {
        effectiveTimeoutMs = Math.max(0, msUntilDeadline);
      }
    }

    if (effectiveTimeoutMs !== undefined && effectiveTimeoutMs >= 0) {
      timeoutTimer = setTimeout(() => {
        callAbortController.abort(new OpenDynamicWorkflowError(ErrorCode.PROCESS_TIMEOUT, `Tool ${call.definition.definition.id} timed out`));
      }, effectiveTimeoutMs);
    }

    try {
      this.running.add(toolCallId);

      // Concurrency limit - wait for queue
      release = await this.limiter.acquire(callAbortController.signal);

      const queueDurationMs = (this.deps.clock ? this.deps.clock.now().getTime() : Date.now()) - startTime;
      const startedAtTime = this.deps.clock ? this.deps.clock.now().getTime() : Date.now();
      startedAt = new Date(startedAtTime).toISOString();

      serializedMetadata.status = "running";
      serializedMetadata.startedAt = startedAt;
      serializedMetadata.queueDurationMs = queueDurationMs;

      try {
        await artifacts.writeToolMetadata(this.deps.artifactStore, toolCallId, serializedMetadata);
      } catch (err: any) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.TOOL_ARTIFACT_WRITE_FAILED,
          `Failed to write tool running metadata: ${err.message}`,
          { cause: err }
        );
      }

      this.emit("tool.started", this.createEventPayload(call, {
        queueDurationMs,
        metadata: serializedMetadata,
        startedAt
      }));

      const context: ToolExecutionContext = {
        runId: this.deps.runId,
        toolCallId,
        definitionId: call.definition.definition.id,
        workflowInvocationId: call.workflowInvocationId,
        parentWorkflowInvocationId: call.parentWorkflowInvocationId,
        artifactsDir: this.deps.runArtifacts.toolDir(toolCallId),
        signal: callAbortController.signal,
        log: (message, data) => {
          this.emit("workflow.log", {
            message: `[tool:${toolCallId}] ${redactText(message, secrets)}`,
            data: redactAndBoundValue(data, { secrets }),
            toolCallId,
            ...(call.origin || {})
          });
        }
      };

      const runPromise = Promise.resolve(call.definition.definition.run(call.args as any, context));
      
      // Attach late handler to observe and discard
      runPromise.catch(() => {}).then(() => {});

      // Race against signal abort
      let onAbort: () => void;
      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => {
          reject(callAbortController.signal.reason);
        };
        if (callAbortController.signal.aborted) {
          onAbort();
        } else {
          callAbortController.signal.addEventListener("abort", onAbort, { once: true });
        }
      });

      let resultValue: TOutput;
      try {
        resultValue = await Promise.race([runPromise, abortPromise]) as TOutput;
      } finally {
        callAbortController.signal.removeEventListener("abort", onAbort!);
      }
      
      const finishedAtTime = this.deps.clock ? this.deps.clock.now().getTime() : Date.now();
      const finishedAt = new Date(finishedAtTime).toISOString();
      const executionDurationMs = finishedAtTime - startedAtTime;
      const totalDurationMs = finishedAtTime - startTime;

      // Validate output
      const validation = call.definition.validateOutput(resultValue);
      if (!validation.ok) {
        const boundedInvalidOutput = redactAndBoundValue(resultValue, { secrets });
        try {
          await artifacts.writeToolInvalidOutput(this.deps.artifactStore, toolCallId, boundedInvalidOutput, validation.errors);
        } catch (writeError: any) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.TOOL_ARTIFACT_WRITE_FAILED,
            `Failed to write invalid output artifact: ${writeError.message}`,
            { cause: writeError }
          );
        }
        const error = serializeError(new OpenDynamicWorkflowError(ErrorCode.TOOL_INVALID_OUTPUT, "Tool output validation failed"));
        return await this.terminalFailure(call, error, "failed", totalDurationMs, { 
          executionDurationMs, 
          queueDurationMs, 
          metadata: serializedMetadata,
          startedAt,
          finishedAt
        });
      }

      let serializedOutput: any;
      try {
        serializedOutput = serializeToolValue(validation.value, "Tool output", secrets);
      } catch (err: any) {
        const serialized = serializeError(err);
        return await this.terminalFailure(call, serialized, "failed", totalDurationMs, { 
          executionDurationMs, 
          queueDurationMs, 
          metadata: serializedMetadata,
          startedAt,
          finishedAt
        });
      }

      try {
        await artifacts.writeToolOutput(this.deps.artifactStore, toolCallId, serializedOutput);
        
        serializedMetadata.status = "succeeded";
        serializedMetadata.finishedAt = finishedAt;
        serializedMetadata.executionDurationMs = executionDurationMs;
        serializedMetadata.durationMs = totalDurationMs;
        
        await artifacts.writeToolMetadata(this.deps.artifactStore, toolCallId, serializedMetadata);
      } catch (writeError: any) {
        const serialized = serializeError(new OpenDynamicWorkflowError(
          ErrorCode.TOOL_ARTIFACT_WRITE_FAILED,
          `Failed to write output artifacts: ${writeError.message}`,
          { cause: writeError }
        ));
        return await this.terminalFailure(call, serialized, "failed", totalDurationMs, { 
          executionDurationMs, 
          queueDurationMs, 
          metadata: serializedMetadata,
          startedAt,
          finishedAt
        });
      }

      const result: ToolExecutionResult<TOutput> = {
        toolCallId,
        definitionId: call.definition.definition.id,
        status: "succeeded",
        ok: true,
        output: validation.value as TOutput,
        startedAt,
        finishedAt,
        queueDurationMs,
        durationMs: totalDurationMs,
        workflowInvocationId: call.workflowInvocationId,
        parentWorkflowInvocationId: call.parentWorkflowInvocationId,
        origin: call.origin,
        artifactPath: call.artifactPath
      };

      // Atomic terminal event and summary
      const existingIndex = this.summaries.findIndex(s => s.toolCallId === toolCallId);
      if (existingIndex === -1) {
        this.summaries.push({
          toolCallId,
          definition: call.definition.definition.id,
          definitionId: call.definition.definition.id,
          label: call.label,
          status: "succeeded",
          ok: true,
          workflowInvocationId: call.workflowInvocationId,
          parentWorkflowInvocationId: call.parentWorkflowInvocationId,
          origin: call.origin,
          queueDurationMs,
          durationMs: totalDurationMs,
          artifactPath: call.artifactPath
        });

        this.emit("tool.completed", this.createEventPayload(call, {
          status: "succeeded",
          executionDurationMs,
          queueDurationMs,
          outputPreview: createPreview(serializedOutput, secrets),
          metadata: serializedMetadata,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt
        }));
      }

      return result;

    } catch (error: any) {
      const finishedAtTime = this.deps.clock ? this.deps.clock.now().getTime() : Date.now();
      const finishedAt = new Date(finishedAtTime).toISOString();
      const totalDurationMs = finishedAtTime - startTime;
      
      const errorCode = error?.code || (error instanceof OpenDynamicWorkflowError ? error.code : undefined);
      if (errorCode === ErrorCode.TOOL_ARTIFACT_WRITE_FAILED || errorCode === ErrorCode.TOOL_SERIALIZATION_FAILED) {
        throw error;
      }

      const isWorkflowTimeout = errorCode === ErrorCode.WORKFLOW_TIMEOUT;
      const isTimeout = isWorkflowTimeout || errorCode === ErrorCode.PROCESS_TIMEOUT;
      const isAbort = callAbortController.signal.aborted || error.name === "AbortError" || errorCode === ErrorCode.USER_CANCELLED;
      
      const status = isTimeout ? "timed_out" : (isAbort ? "cancelled" : "failed");
      const serialized = serializeError(error);

      // Redact error message if it contains secrets
      if (serialized.message) {
        serialized.message = redactText(serialized.message, secrets);
      }

      return await this.terminalFailure(call, serialized, status, totalDurationMs, { 
        metadata: serializedMetadata,
        startedAt: typeof startedAt !== "undefined" ? startedAt : undefined,
        finishedAt
      });
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (release) release();
      this.running.delete(toolCallId);
    }
  }

  cancel(reason: SerializedError): void {
    if (this.cancelReason) return;
    this.cancelReason = reason;
    this.abortController.abort(reason);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(this.runningPromises);
  }

  getSummaries(): readonly ToolSummary[] {
    return this.summaries;
  }

  addSummary(summary: ToolSummary): void {
    const existingIndex = this.summaries.findIndex(s => s.toolCallId === summary.toolCallId);
    if (existingIndex === -1) {
      this.summaries.push(summary);
    }
  }

  private async terminalFailure(
    call: PreparedToolCall,
    error: SerializedError,
    status: "failed" | "cancelled" | "timed_out",
    durationMs: number,
    timings?: { 
      executionDurationMs?: number | undefined; 
      queueDurationMs?: number | undefined; 
      metadata?: Record<string, unknown> | undefined;
      startedAt?: string | undefined;
      finishedAt?: string | undefined;
    }
  ): Promise<ToolExecutionResult<any>> {
    const toolCallId = call.toolCallId;
    const secrets = this.deps.redactedSecrets || [];
    const metadata = timings?.metadata || redactAndBoundValue(call.metadata || {}, { secrets });
    
    // Update metadata for terminal failure
    metadata.status = status;
    metadata.finishedAt = timings?.finishedAt || new Date().toISOString();
    metadata.durationMs = durationMs;
    if (timings?.queueDurationMs !== undefined) metadata.queueDurationMs = timings.queueDurationMs;
    if (timings?.executionDurationMs !== undefined) metadata.executionDurationMs = timings.executionDurationMs;

    // Ensure we don't push duplicate summaries
    const existingIndex = this.summaries.findIndex(s => s.toolCallId === toolCallId);
    if (existingIndex === -1) {
      try {
        await artifacts.writeToolError(this.deps.artifactStore, toolCallId, error);
        await artifacts.writeToolMetadata(this.deps.artifactStore, toolCallId, metadata);
      } catch (writeError: any) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.TOOL_ARTIFACT_WRITE_FAILED,
          `Failed to write failure artifacts for tool '${call.definition.definition.id}': ${writeError.message}`,
          { cause: writeError }
        );
      }

      this.summaries.push({
        toolCallId,
        definition: call.definition.definition.id,
        definitionId: call.definition.definition.id,
        label: call.label,
        status,
        ok: false,
        workflowInvocationId: call.workflowInvocationId,
        parentWorkflowInvocationId: call.parentWorkflowInvocationId,
        origin: call.origin,
        queueDurationMs: timings?.queueDurationMs,
        durationMs,
        artifactPath: call.artifactPath,
        error: {
          code: error.code || "UNKNOWN_ERROR",
          message: error.message
        }
      });

      const eventType = status === "timed_out" ? "tool.timed_out" : (status === "cancelled" ? "tool.cancelled" : "tool.failed");
      this.emit(eventType, this.createEventPayload(call, {
        status,
        error,
        executionDurationMs: timings?.executionDurationMs,
        queueDurationMs: timings?.queueDurationMs,
        metadata,
        startedAt: timings?.startedAt,
        finishedAt: timings?.finishedAt
      }));
    }

    return {
      toolCallId,
      definitionId: call.definition.definition.id,
      status,
      ok: false,
      error: {
        code: error.code || "UNKNOWN_ERROR",
        message: error.message,
        error
      },
      startedAt: timings?.startedAt,
      finishedAt: timings?.finishedAt,
      queueDurationMs: timings?.queueDurationMs,
      durationMs,
      workflowInvocationId: call.workflowInvocationId,
      parentWorkflowInvocationId: call.parentWorkflowInvocationId,
      origin: call.origin,
      artifactPath: call.artifactPath
    };
  }

  private emit(type: string, payload: any): void {
    this.deps.eventSink.emit(type as any, payload);
  }

  private createEventPayload(call: PreparedToolCall, extra: any): any {
    const secrets = this.deps.redactedSecrets || [];
    return {
      toolCallId: call.toolCallId,
      definition: call.definition.definition.id,
      label: call.label,
      workflowInvocationId: call.workflowInvocationId,
      parentWorkflowInvocationId: call.parentWorkflowInvocationId,
      ...(call.origin || {}),
      artifactPath: call.artifactPath,
      metadata: redactAndBoundValue(call.metadata || {}, { secrets }),
      ...extra
    };
  }
}
