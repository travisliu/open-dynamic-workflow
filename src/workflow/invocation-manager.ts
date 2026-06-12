import AjvModule from "ajv";
import type { JsonObject } from "../types/common.js";
import type { WorkflowCallInput, WorkflowSettledResult, WorkflowInvocationSummary, WorkflowSettledStatus } from "../types/workflow.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import { serializeError } from "../errors/serialize.js";
import type { WorkflowDefinition, WorkflowRegistry } from "./registry.js";
import type { 
  WorkflowInvocationContext, 
  WorkflowInvocationManager 
} from "./invocation-types.js";
import { withActiveWorkflowInvocation } from "./invocation-types.js";
import { getDslExecutionScope, withDslExecutionScope, deriveChildWorkflowToolScope } from "./scope.js";
import { normalizeWorkflowCall } from "./workflow-call.js";
import { cloneJsonValue } from "./json.js";
import type { RuntimeState } from "./types.js";
import { createWorkflowInvocationArtifactWriter, WorkflowInvocationArtifactWriter } from "./invocation-artifacts.js";
import { sanitizeMetadata } from "../security/metadata.js";

const Ajv = (AjvModule as any).default || AjvModule;
const ajv = new Ajv({ 
  allErrors: true,
  useDefaults: false,
  coerceTypes: false
});

function getAbortError(reason: any): Error {
  if (reason instanceof OpenFlowError) return reason;
  if (reason instanceof Error) return reason;
  return new OpenFlowError(
    ErrorCode.WORKFLOW_CANCELLED,
    typeof reason === "string" ? reason : (reason?.message || "Workflow cancelled")
  );
}

async function runWithAbort<T>(signal: AbortSignal, run: Promise<T>): Promise<T> {
  if (signal.aborted) {
    throw getAbortError(signal.reason);
  }

  return new Promise<T>((resolve, reject) => {
    let finished = false;
    
    const onAbort = () => {
      if (finished) return;
      finished = true;
      reject(getAbortError(signal.reason));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    run.then(
      (res) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      (err) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

class Semaphore {
  private count = 0;
  private queue: (() => void)[] = [];

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.limit === Infinity) return;
    if (this.count < this.limit) {
      this.count++;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.limit === Infinity) return;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.count--;
    }
  }
}

export interface DefaultWorkflowInvocationManagerDeps {
  runtime: RuntimeState;
  registry: WorkflowRegistry;
  evaluate: (context: WorkflowInvocationContext) => Promise<unknown>;
  now?: () => number;
  createInvocationId?: () => string;
}

export class DefaultWorkflowInvocationManager implements WorkflowInvocationManager {
  private readonly runtime: RuntimeState;
  private readonly registry: WorkflowRegistry;
  private readonly evaluate: (context: WorkflowInvocationContext) => Promise<unknown>;
  private readonly now: () => number;
  private readonly createInvocationId: () => string;
  private readonly artifactWriter: WorkflowInvocationArtifactWriter;

  constructor(deps: DefaultWorkflowInvocationManagerDeps) {
    this.runtime = deps.runtime;
    this.registry = deps.registry;
    this.evaluate = deps.evaluate;
    this.now = deps.now ?? (() => Date.now());
    this.createInvocationId = deps.createInvocationId ?? (() => {
      if (this.runtime.idGenerator) {
        return this.runtime.idGenerator.nextId("workflow");
      }
      return `wf-${Math.random().toString(36).substring(2, 9)}`;
    });
    this.artifactWriter = createWorkflowInvocationArtifactWriter(this.runtime.artifactStore);
  }

  async executeRoot(definition: WorkflowDefinition, args: JsonObject): Promise<unknown> {
    const startedAtTime = this.now();
    const startedAt = new Date(startedAtTime).toISOString();
    const workflowInvocationId = this.runtime.runId; 
    
    const timeoutMs = this.runtime.config.timeoutMs;
    const deadlineAt = timeoutMs ? startedAtTime + timeoutMs : Infinity;

    const context: WorkflowInvocationContext = {
      runId: this.runtime.runId,
      workflowInvocationId,
      workflowName: definition.name,
      definition,
      depth: 0,
      ancestry: [definition.name],
      args: cloneJsonValue(args, "root args") as JsonObject,
      startedAt,
      deadlineAt, 
      signal: this.runtime.abortController.signal,
      abortController: this.runtime.abortController,
      effectiveConcurrency: this.runtime.schedulerConcurrency
    };

    let timeoutTimer: NodeJS.Timeout | undefined;
    if (deadlineAt !== Infinity) {
      const remaining = deadlineAt - this.now();
      if (remaining <= 0) {
        this.runtime.abortController.abort(new OpenFlowError(ErrorCode.WORKFLOW_TIMEOUT, "Workflow timed out before starting."));
      } else {
        timeoutTimer = setTimeout(() => {
          this.runtime.abortController.abort(new OpenFlowError(ErrorCode.WORKFLOW_TIMEOUT, "Workflow timed out."));
        }, remaining);
      }
    }

    const { artifactPath } = await this.artifactWriter.begin({
      workflowInvocationId,
      workflowName: definition.name,
      depth: 0,
      args: context.args,
      metadata: context.metadata,
      startedAt
    });
    context.artifactPath = artifactPath;

    try {
      if (context.signal.aborted) {
        const reason = context.signal.reason;
        if (reason instanceof OpenFlowError) throw reason;
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_CANCELLED, 
          typeof reason === "string" ? reason : (reason?.message || "Workflow cancelled")
        );
      }
      this.emitStarted(context);
      const result = await runWithAbort(context.signal, this.executeInContext(context));
      const finishedAt = new Date(this.now()).toISOString();
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);

      await this.artifactWriter.writeSuccess({
        workflowInvocationId,
        parentWorkflowInvocationId: context.parentWorkflowInvocationId,
        workflowName: context.workflowName,
        depth: 0,
        startedAt,
        finishedAt,
        durationMs,
        result,
        artifactPath
      });

      this.recordSummary(context, finishedAt, "succeeded", undefined, artifactPath);
      this.emitCompleted(context, finishedAt);

      return result;
    } catch (error: any) {
      const finishedAt = new Date(this.now()).toISOString();
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
      const status = this.getErrorStatus(error);

      await this.artifactWriter.writeFailure({
        workflowInvocationId,
        parentWorkflowInvocationId: context.parentWorkflowInvocationId,
        workflowName: context.workflowName,
        depth: 0,
        startedAt,
        finishedAt,
        durationMs,
        status,
        error: serializeError(error),
        artifactPath
      });

      this.recordSummary(context, finishedAt, status, error, artifactPath);
      this.emitTerminal(context, finishedAt, error);
      throw error;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  async invokeChild<T>(
    parent: WorkflowInvocationContext,
    input: WorkflowCallInput
  ): Promise<T | WorkflowSettledResult<T>> {
    if (parent.signal.aborted) {
      const reason = parent.signal.reason;
      if (reason instanceof OpenFlowError) throw reason;
      throw new OpenFlowError(ErrorCode.WORKFLOW_CANCELLED, typeof reason === "string" ? reason : (reason?.message || "Parent workflow already cancelled."));
    }

    const call = normalizeWorkflowCall(input);
    const isSettled = call.failureMode === "settled";

    const startedAtTime = this.now();
    const startedAt = new Date(startedAtTime).toISOString();
    const workflowInvocationId = this.createInvocationId();
    const depth = parent.depth + 1;

    let artifactPath: string | undefined;
    try {
      const beginResult = await this.artifactWriter.begin({
        workflowInvocationId,
        parentWorkflowInvocationId: parent.workflowInvocationId,
        workflowName: call.name,
        depth,
        args: call.args,
        metadata: call.metadata,
        startedAt
      });
      artifactPath = beginResult.artifactPath;
    } catch (err) {
      // Ignore or log
    }

    let definition: WorkflowDefinition;
    try {
      definition = this.registry.require(call.name);
      
      const maxDepth = this.runtime.config.workflow?.maxDepth ?? 8;
      if (depth > maxDepth) {
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_MAX_DEPTH_EXCEEDED,
          `Maximum workflow depth of ${maxDepth} exceeded.`
        );
      }

      if (parent.ancestry.includes(definition.name)) {
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_RECURSION_DETECTED,
          `Active recursion detected: ${parent.ancestry.join(" -> ")} -> ${definition.name}`
        );
      }

      if (definition.inputSchema) {
        const validate = ajv.compile(definition.inputSchema);
        const valid = validate(call.args);
        if (!valid) {
          const errors = validate.errors?.map((e: any) => `${e.instancePath} ${e.message}`).join(", ");
          throw new OpenFlowError(
            ErrorCode.WORKFLOW_INPUT_VALIDATION_FAILED,
            `Input validation failed for workflow '${definition.name}': ${errors}`
          );
        }
      }
    } catch (error: any) {
      const finishedAt = new Date(this.now()).toISOString();
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
      const status = this.getErrorStatus(error);

      if (artifactPath) {
        await this.artifactWriter.writeFailure({
          workflowInvocationId,
          parentWorkflowInvocationId: parent.workflowInvocationId,
          workflowName: call.name,
          depth,
          startedAt,
          finishedAt,
          durationMs,
          status,
          error: serializeError(error),
          artifactPath
        });
      }

      const partialCtx = {
        workflowInvocationId,
        parentWorkflowInvocationId: parent.workflowInvocationId,
        workflowName: call.name,
        depth,
        startedAt,
        artifactPath
      } as WorkflowInvocationContext;

      this.recordSummary(partialCtx, finishedAt, status, error, artifactPath);

      if (isSettled) {
        if (parent.signal.aborted || this.runtime.abortController.signal.aborted) {
          throw error;
        }
        return this.toSettledFailure(partialCtx, serializeError(error), finishedAt, error);
      }
      throw error;
    }

    const abortController = new AbortController();
    const parentSignal = parent.signal;
    
    const onParentAbort = () => {
      abortController.abort(parentSignal.reason);
    };
    parentSignal.addEventListener("abort", onParentAbort);
    if (parentSignal.aborted) {
      abortController.abort(parentSignal.reason);
    }

    let timeoutTimer: NodeJS.Timeout | undefined;
    const parentDeadline = parent.deadlineAt ?? Infinity;
    const callTimeout = call.timeoutMs ? startedAtTime + call.timeoutMs : Infinity;
    const deadlineAt = Math.min(parentDeadline, callTimeout);

    if (deadlineAt !== Infinity) {
      const remaining = deadlineAt - this.now();
      if (remaining <= 0) {
        abortController.abort(new OpenFlowError(ErrorCode.WORKFLOW_TIMEOUT, "Workflow timed out before starting."));
      } else {
        timeoutTimer = setTimeout(() => {
          abortController.abort(new OpenFlowError(ErrorCode.WORKFLOW_TIMEOUT, "Workflow timed out."));
        }, remaining);
      }
    }

    const effectiveConcurrency = call.concurrency 
      ? Math.min(call.concurrency, parent.effectiveConcurrency ?? Infinity)
      : parent.effectiveConcurrency;

    const localLimit = call.concurrency !== undefined ? effectiveConcurrency : undefined;
    const localSemaphore = localLimit !== undefined && localLimit !== Infinity
      ? new Semaphore(localLimit)
      : undefined;

    const concurrencyBudget = {
      acquire: async () => {
        if (parent.concurrencyBudget) {
          await parent.concurrencyBudget.acquire();
        }
        if (localSemaphore) {
          await localSemaphore.acquire();
        }
      },
      release: () => {
        if (localSemaphore) {
          localSemaphore.release();
        }
        if (parent.concurrencyBudget) {
          parent.concurrencyBudget.release();
        }
      }
    };

    const context: WorkflowInvocationContext = {
      runId: parent.runId,
      workflowInvocationId,
      parentWorkflowInvocationId: parent.workflowInvocationId,
      workflowName: definition.name,
      definition,
      depth,
      ancestry: [...parent.ancestry, definition.name],
      args: call.args,
      metadata: call.metadata,
      startedAt,
      deadlineAt,
      signal: abortController.signal,
      abortController,
      effectiveConcurrency,
      concurrencyBudget,
      artifactPath
    };

    try {
      if (context.signal.aborted) {
        const reason = context.signal.reason;
        if (reason instanceof OpenFlowError) throw reason;
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_CANCELLED, 
          typeof reason === "string" ? reason : (reason?.message || "Workflow cancelled")
        );
      }
      this.emitStarted(context);
      const rawOutput = await runWithAbort(context.signal, this.executeInContext(context));
      let output: T;
      try {
        output = cloneJsonValue(rawOutput, "workflow output") as T;
      } catch (err: any) {
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_RESULT_SERIALIZATION_FAILED,
          `Failed to serialize workflow output: ${err.message}`,
          { cause: err }
        );
      }
      const finishedAt = new Date(this.now()).toISOString();
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);

      await this.artifactWriter.writeSuccess({
        workflowInvocationId,
        parentWorkflowInvocationId: parent.workflowInvocationId,
        workflowName: definition.name,
        depth,
        startedAt,
        finishedAt,
        durationMs,
        result: output,
        artifactPath
      });
      
      this.recordSummary(context, finishedAt, "succeeded", undefined, artifactPath);
      this.emitCompleted(context, finishedAt);
      
      if (call.failureMode === "settled") {
        return this.toSettledSuccess(context, output, finishedAt);
      }
      return output;
    } catch (error: any) {
      const finishedAt = new Date(this.now()).toISOString();
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
      const status = this.getErrorStatus(error);

      await this.artifactWriter.writeFailure({
        workflowInvocationId,
        parentWorkflowInvocationId: parent.workflowInvocationId,
        workflowName: definition.name,
        depth,
        startedAt,
        finishedAt,
        durationMs,
        status,
        error: serializeError(error),
        artifactPath
      });
      
      this.recordSummary(context, finishedAt, status, error, artifactPath);
      this.emitTerminal(context, finishedAt, error);

      if (call.failureMode === "settled") {
        if (parent.signal.aborted || this.runtime.abortController.signal.aborted) {
          throw error;
        }
        return this.toSettledFailure(context, serializeError(error), finishedAt, error);
      }
      throw error;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  }

  private executeInContext(context: WorkflowInvocationContext): Promise<unknown> {
    const parentScope = getDslExecutionScope();
    const childScope = deriveChildWorkflowToolScope(parentScope, context);
    return withActiveWorkflowInvocation(context, () => 
      withDslExecutionScope(childScope, () => this.evaluate(context))
    );
  }

  private recordSummary(ctx: WorkflowInvocationContext, finishedAt: string, status: WorkflowSettledStatus, error?: any, artifactPath?: string) {
    const summary: WorkflowInvocationSummary = {
      workflowInvocationId: ctx.workflowInvocationId,
      parentWorkflowInvocationId: ctx.parentWorkflowInvocationId,
      workflowName: ctx.workflowName,
      status,
      depth: ctx.depth,
      startedAt: ctx.startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(ctx.startedAt),
      artifactPath,
      error: error ? serializeError(error) : undefined
    };
    if (!this.runtime.workflowSummaries) {
      this.runtime.workflowSummaries = [];
    }
    this.runtime.workflowSummaries.push(summary);
  }

  private emitStarted(ctx: WorkflowInvocationContext) {
    this.runtime.eventSink.emit("workflow.invocation.started", {
      workflowInvocationId: ctx.workflowInvocationId,
      parentWorkflowInvocationId: ctx.parentWorkflowInvocationId,
      workflowName: ctx.workflowName,
      depth: ctx.depth,
      startedAt: ctx.startedAt,
      metadata: sanitizeMetadata(ctx.metadata),
      artifactPath: ctx.artifactPath
    });
  }

  private emitCompleted(ctx: WorkflowInvocationContext, finishedAt: string) {
    this.runtime.eventSink.emit("workflow.invocation.completed", {
      workflowInvocationId: ctx.workflowInvocationId,
      parentWorkflowInvocationId: ctx.parentWorkflowInvocationId,
      workflowName: ctx.workflowName,
      status: "succeeded",
      depth: ctx.depth,
      startedAt: ctx.startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(ctx.startedAt),
      artifactPath: ctx.artifactPath
    });
  }

  private emitTerminal(ctx: WorkflowInvocationContext, finishedAt: string, error: any) {
    const status = this.getErrorStatus(error);
    this.runtime.eventSink.emit(`workflow.invocation.${status}` as any, {
      workflowInvocationId: ctx.workflowInvocationId,
      parentWorkflowInvocationId: ctx.parentWorkflowInvocationId,
      workflowName: ctx.workflowName,
      status,
      depth: ctx.depth,
      startedAt: ctx.startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(ctx.startedAt),
      artifactPath: ctx.artifactPath,
      error: serializeError(error)
    });
  }

  private getErrorStatus(error: any): "failed" | "timed_out" | "cancelled" {
    if (error instanceof OpenFlowError) {
      if (error.code === ErrorCode.WORKFLOW_TIMEOUT) return "timed_out";
      if (error.code === ErrorCode.WORKFLOW_CANCELLED) return "cancelled";
      if (error.code === ErrorCode.USER_CANCELLED) return "cancelled";
    }
    if (error?.name === "AbortError") return "cancelled";
    if (error?.name === "WorkflowCancelledError") return "cancelled";
    return "failed";
  }

  private toSettledSuccess<T>(ctx: WorkflowInvocationContext, output: T, finishedAt: string): WorkflowSettledResult<T> {
    return {
      status: "succeeded",
      workflowName: ctx.workflowName,
      workflowInvocationId: ctx.workflowInvocationId,
      output,
      startedAt: ctx.startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(ctx.startedAt),
      artifactPath: ctx.artifactPath
    };
  }

  private toSettledFailure<T>(ctx: WorkflowInvocationContext, error: any, finishedAt: string, rawError: any): WorkflowSettledResult<T> {
    const status = this.getErrorStatus(rawError);
    return {
      status,
      workflowName: ctx.workflowName,
      workflowInvocationId: ctx.workflowInvocationId,
      output: null as any,
      error,
      startedAt: ctx.startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(ctx.startedAt),
      artifactPath: ctx.artifactPath
    };
  }
}
