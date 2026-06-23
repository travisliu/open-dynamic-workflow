import * as path from "node:path";
import * as vm from "node:vm";
import type { ParsedWorkflow, WorkflowRunResult, ResolvedWorkflowIdentity } from "../types/workflow.js";
import type { ResolvedConfig, CliRunOptions } from "../types/config.js";

import type { ArtifactStore } from "../types/artifacts.js";
import type { AgentExecutor } from "../agents/execution-types.js";
import type { RuntimeEventSink } from "../orchestration/scheduler.js";
import { DefaultScheduler } from "../orchestration/scheduler.js";
import { createDsl } from "./dsl.js";
import { createSandboxContext } from "./sandbox.js";
import type { RuntimeState } from "./types.js";
import { type WorkflowRegistry, createRootWorkflowRegistry } from "./registry.js";
import { serializeError } from "../errors/serialize.js";
import { createLinkedAbortController } from "../orchestration/cancellation.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { loadRuntimeCallCache } from "../artifacts/call-cache.js";
import type { SharedAgentRegistry } from "../shared-agents/registry.js";

import { DefaultWorkflowInvocationManager } from "./invocation-manager.js";
import type { WorkflowInvocationContext } from "./invocation-types.js";
import { getActiveWorkflowInvocation } from "./invocation-types.js";
import { cloneJsonValue, cloneJsonObject } from "./json.js";
import { withDslExecutionScope, withToolTopLevelWindow } from "./scope.js";
import type { ToolRegistry } from "../types/tool.js";
import type { ToolExecutor } from "../tools/executor-types.js";
import { RunLimitTracker } from "./run-limits.js";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  nextId(prefix: string): string;
}

export interface RuntimeRunInput {
  parsedWorkflow: ParsedWorkflow;
  workflowRegistry?: WorkflowRegistry;
  workflowIdentity?: ResolvedWorkflowIdentity;
  config: ResolvedConfig;
  cli: CliRunOptions;
  signal?: AbortSignal;
  sharedAgentRegistry?: SharedAgentRegistry;
  toolRegistry?: ToolRegistry;
}

export interface RuntimeDependencies {
  agentExecutor: AgentExecutor;
  eventSink: RuntimeEventSink;
  artifactStore?: ArtifactStore;
  clock?: Clock;
  idGenerator?: IdGenerator;
  sharedAgentRegistry?: SharedAgentRegistry;
  toolExecutor?: ToolExecutor;
}

export interface RuntimeRunner {
  run(input: RuntimeRunInput, deps: RuntimeDependencies): Promise<WorkflowRunResult>;
}

export class DefaultRuntimeRunner implements RuntimeRunner {
  async run(
    input: RuntimeRunInput,
    deps: RuntimeDependencies
  ): Promise<WorkflowRunResult> {
    const startTime = deps.clock ? deps.clock.now() : new Date();
    const runId = deps.idGenerator ? deps.idGenerator.nextId("run") : crypto.randomUUID();

    const cwd = input.cli.cwd || input.config.cwd || process.cwd();
    const artifactsDir = input.cli.outDir || input.config.outDir || path.resolve(cwd, ".open-dynamic-workflow/runs", runId);

    const schedulerConcurrency = input.cli.concurrency ?? input.config.concurrency ?? 1;

    const scheduler = new DefaultScheduler(
      {
        concurrency: schedulerConcurrency,
        failFast: !!(input.cli.failFast || input.config.failFast)
      },
      { eventSink: deps.eventSink }
    );

    const runtimeAbortController = createLinkedAbortController(input.signal);
    const callCache = await loadRuntimeCallCache({
      resume: input.cli.resume,
      noCache: input.cli.noCache,
      outDir: input.config.outDir
    });

    const registry = input.workflowRegistry || createRootWorkflowRegistry(input.parsedWorkflow);
    const runLimitTracker = new RunLimitTracker({
      maxAgentCalls: input.cli.maxAgentCalls ?? input.config.maxAgentCalls
    });

    const runtime: RuntimeState = {
      artifactStore: deps.artifactStore,
      workflowRegistry: registry,
      runId,
      parsedWorkflow: input.parsedWorkflow,
      config: input.config,
      cli: input.cli,
      args: (input.cli.args as any) || {},
      cwd,
      artifactsDir,
      agentResults: [],
      toolResults: [],
      scheduler,
      agentExecutor: deps.agentExecutor,
      eventSink: deps.eventSink,
      abortController: runtimeAbortController,
      agentCounter: 0,
      callSequence: 0,
      callCache,
      pipelineCounter: 0,
      pipelineSummaries: [],
      workflowSummaries: [],
      startedAt: startTime.toISOString(),
      idGenerator: deps.idGenerator !== undefined ? deps.idGenerator : undefined,
      failFast: input.cli.failFast,
      sharedAgentRegistry: input.sharedAgentRegistry || deps.sharedAgentRegistry,
      schedulerConcurrency,
      toolRegistry: input.toolRegistry,
      toolExecutor: deps.toolExecutor,
      toolCallIds: new Set(),
      toolCounter: 0,
      loopCounter: 0,
      loopSummaries: [],
      runLimitTracker
    };

    const invocationManager = new DefaultWorkflowInvocationManager({
      runtime,
      registry,
      evaluate: (ctx) => executeWorkflowModule(runtime, ctx)
    });
    runtime.invocationManager = invocationManager;

    if (deps.artifactStore && !deps.artifactStore.isRunCreated()) {
      await deps.artifactStore.createRun({
        runId,
        outDir: artifactsDir,
        workflowPath: input.parsedWorkflow.sourcePath,
        workflowSource: input.parsedWorkflow.sourceText || "",
        workflowHash: input.parsedWorkflow.sourceHash,
        resolvedConfig: input.config,
        openDynamicWorkflowVersion: input.parsedWorkflow.meta.version || "0.0.0",
        cwd,
        configPath: input.config.configPath
      });
    }

    // Listen to external signals / cancellation
    if (input.signal) {
      if (input.signal.aborted) {
        scheduler.abort({ type: "user", message: input.signal.reason || "External cancellation" });
        runtimeAbortController.abort(input.signal.reason || "External cancellation");
      } else {
        input.signal.addEventListener("abort", () => {
          scheduler.abort({ type: "user", message: input.signal?.reason || "External cancellation" });
          runtimeAbortController.abort(input.signal?.reason || "External cancellation");
        });
      }
    }

    // Emit workflow.resolved if present
    if (deps.eventSink && input.workflowIdentity) {
      deps.eventSink.emit("workflow.resolved", {
        requestedTarget: input.workflowIdentity.requestedTarget,
        targetKind: input.workflowIdentity.targetKind,
        workflowName: input.workflowIdentity.name,
        workflowFile: input.workflowIdentity.workflowFile,
        workflowFileRelative: input.workflowIdentity.workflowFileRelative,
        discoverySource: input.workflowIdentity.discoverySource
      });
    }

    // Emit workflow.started
    if (deps.eventSink) {
      deps.eventSink.emit("workflow.started", {
        meta: input.parsedWorkflow.meta,
        cwd,
        artifactsDir
      });
    }

    try {
      if (runtimeAbortController.signal.aborted) {
        throw new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_CANCELLED, String(runtimeAbortController.signal.reason || "Workflow cancelled before execution started."));
      }

      const workflowResult = await withDslExecutionScope({
        runId: runtime.runId,
        workflowInvocationId: runtime.runId,
        location: "workflow-top-level",
        toolAllowed: true,
        topLevelWindow: false
      }, () => invocationManager.executeRoot(
        registry.require(input.parsedWorkflow.meta.name),
        runtime.args
      ));

      // Wait for scheduler to drain all pending tasks
      await scheduler.drain();

      // Check if scheduler is aborted
      const schedulerSnapshot = (scheduler as any).getSnapshot();
      if (schedulerSnapshot.aborted) {
        const abortReason = schedulerSnapshot.abortReason;
        const isFailFast = abortReason?.type === "fail-fast";
        const reasonMsg = typeof abortReason === "string" ? abortReason : abortReason?.message;

        if (isFailFast) {
          if (runtime.toolExecutor) {
            runtime.toolExecutor.cancel({ name: "FailFastError", message: reasonMsg || "Fail-fast triggered", code: "FAIL_FAST" });
            await runtime.toolExecutor.close().catch(() => {});
          }
          const finishTime = deps.clock ? deps.clock.now() : new Date();
          const durationMs = finishTime.getTime() - startTime.getTime();
          // Build failed run result for fail-fast
          const result = buildFailedRunResult(runtime, new Error(reasonMsg), durationMs, finishTime.toISOString(), deps.artifactStore);
          if (deps.eventSink) {
            deps.eventSink.emit("workflow.failed", {
              status: "failed",
              durationMs,
              error: result.error!,
              limitSummary: result.limitSummary
            });
          }
          if (deps.artifactStore) {
            await deps.artifactStore.updateManifest("failed", result.error);
          }
          return result;
        } else {
          if (runtime.toolExecutor) {
            runtime.toolExecutor.cancel({ name: "WorkflowCancelledError", message: reasonMsg || "Workflow cancelled", code: "USER_CANCELLED" });
            await runtime.toolExecutor.close().catch(() => {});
          }
          const finishTime = deps.clock ? deps.clock.now() : new Date();
          const durationMs = finishTime.getTime() - startTime.getTime();
          // Build cancelled run result
          const result = buildCancelledRunResult(runtime, durationMs, finishTime.toISOString(), reasonMsg, deps.artifactStore);
          if (deps.eventSink) {
            deps.eventSink.emit("workflow.cancelled", {
              status: "cancelled",
              durationMs,
              reason: reasonMsg || "Workflow cancelled",
              limitSummary: result.limitSummary
            });
          }
          if (deps.artifactStore) {
            await deps.artifactStore.updateManifest("cancelled", result.error);
          }
          return result;
        }
      }

      if (runtime.toolExecutor) {
        await runtime.toolExecutor.close();
      }

      const finishTime = deps.clock ? deps.clock.now() : new Date();
      const durationMs = finishTime.getTime() - startTime.getTime();

      // Build succeeded run result
      const result = buildSucceededRunResult(runtime, workflowResult, durationMs, finishTime.toISOString(), deps.artifactStore);
      if (deps.eventSink) {
        deps.eventSink.emit("workflow.completed", {
          status: "succeeded",
          durationMs,
          result: workflowResult,
          limitSummary: result.limitSummary
        });
      }
      if (deps.artifactStore) {
        await deps.artifactStore.updateManifest("succeeded");
      }
      return result;

    } catch (err: any) {
      let abortType: "user" | "timeout" | "other" = "other";
      if (err?.code === ErrorCode.WORKFLOW_TIMEOUT) {
        abortType = "timeout";
      } else if (
        err?.code === ErrorCode.WORKFLOW_CANCELLED ||
        err?.code === ErrorCode.USER_CANCELLED ||
        err?.name === "AbortError" ||
        err?.name === "WorkflowCancelledError" ||
        (err?.name === "OpenDynamicWorkflowError" && (err?.code === ErrorCode.WORKFLOW_CANCELLED || err?.code === ErrorCode.USER_CANCELLED))
      ) {
        abortType = "user";
      }

      scheduler.abort({
        type: abortType,
        message: err.message || "Workflow error"
      });
      await scheduler.drain().catch(() => {});

      if (runtime.toolExecutor) {
        runtime.toolExecutor.cancel(serializeError(err));
        await runtime.toolExecutor.close().catch(() => {});
      }
      const finishTime = deps.clock ? deps.clock.now() : new Date();
      const durationMs = finishTime.getTime() - startTime.getTime();

      const isCancellation = err?.code === ErrorCode.WORKFLOW_CANCELLED || 
                             err?.code === ErrorCode.USER_CANCELLED ||
                             err?.name === "AbortError" || 
                             err?.name === "WorkflowCancelledError" ||
                             (err?.name === "OpenDynamicWorkflowError" && (err?.code === ErrorCode.WORKFLOW_CANCELLED || err?.code === ErrorCode.USER_CANCELLED));

      if (isCancellation) {
        const result = buildCancelledRunResult(runtime, durationMs, finishTime.toISOString(), err.message, deps.artifactStore);
        if (deps.eventSink) {
          deps.eventSink.emit("workflow.cancelled", {
            status: "cancelled",
            durationMs,
            reason: err.message || "Workflow cancelled",
            limitSummary: result.limitSummary
          });
        }
        if (deps.artifactStore) {
          await deps.artifactStore.updateManifest("cancelled", result.error);
        }
        return result;
      }

      // Build failed run result
      const result = buildFailedRunResult(runtime, err, durationMs, finishTime.toISOString(), deps.artifactStore);
      if (deps.eventSink) {
        deps.eventSink.emit("workflow.failed", {
          status: "failed",
          durationMs,
          error: result.error!,
          limitSummary: result.limitSummary
        });
      }
      if (deps.artifactStore) {
        await deps.artifactStore.updateManifest("failed", result.error);
      }
      return result;
    }
  }
}

export async function executeWorkflowModule(runtime: RuntimeState, invocationContext?: WorkflowInvocationContext): Promise<unknown> {
  let context: vm.Context;
  try {
    context = createSandboxContext(runtime);
  } catch (err: any) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.SECURITY_POLICY_VIOLATION,
      `Failed to create secure sandbox context: ${err.message}`,
      { cause: err }
    );
  }

  const parsedWorkflow = invocationContext ? invocationContext.definition.parsedWorkflow : runtime.parsedWorkflow;
  const body = parsedWorkflow.body;
  const transformedBody = body.replace(/export\s+default\s+/, "__default = ");
  const wrappedBody = `(async () => {\n${transformedBody}\n})()`;

  try {
    const promise = withToolTopLevelWindow(parsedWorkflow.sourcePath, () => vm.runInContext(wrappedBody, context, {
      filename: parsedWorkflow.sourcePath,
      lineOffset: -1
    }));

    await withToolTopLevelWindow(parsedWorkflow.sourcePath, async () => {
      await promise;
    });
    const workflowFn = (context as any).__default;
    let result: unknown;
    if (typeof workflowFn === "function") {
      const dsl = createDsl(runtime);
      const activeInvocation = getActiveWorkflowInvocation();
      const args = activeInvocation ? activeInvocation.args : runtime.args;
      
      const dslContext = {
        ...dsl,
        args: Object.freeze(cloneJsonObject(args, "workflow args")),
        cwd: runtime.cwd,
        runId: runtime.runId,
        artifactsDir: runtime.artifactsDir,
        signal: activeInvocation?.signal || runtime.abortController.signal
      };
      result = await withToolTopLevelWindow(parsedWorkflow.sourcePath, () => workflowFn(dslContext));
    } else {
      result = workflowFn;
    }

    if (result === undefined) return undefined;
    if (result === null) return null;
    try {
      return cloneJsonValue(result, "workflow result");
    } catch (err: any) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.WORKFLOW_RESULT_SERIALIZATION_FAILED,
        `Failed to serialize workflow result: ${err.message}`,
        { cause: err }
      );
    }
  } catch (err: any) {
    // Check if it's already an OpenDynamicWorkflowError (e.g. from DSL)
    // We check both instanceof and the presence of the 'code' property 
    // to handle errors coming from the VM context.
    if (err instanceof OpenDynamicWorkflowError || (err && typeof err === "object" && "code" in err && "name" in err && err.name === "OpenDynamicWorkflowError")) {
      throw err;
    }

    // Map potential sandbox escapes or violations to SECURITY_POLICY_VIOLATION
    const isSecurityViolation = err.name === "SecurityError";

    if (isSecurityViolation) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.SECURITY_POLICY_VIOLATION,
        `Workflow execution violated security policy: ${err.message}`,
        { cause: err }
      );
    }
    
    throw err;
  }
}

export function buildSucceededRunResult(
  runtime: RuntimeState,
  workflowResult: unknown,
  durationMs: number,
  finishedAt: string,
  artifactStore?: ArtifactStore
): WorkflowRunResult {
  const runArtifacts = artifactStore ? artifactStore.getRunArtifacts() : undefined;
  const reportPath = runArtifacts?.reportPath || path.join(runtime.artifactsDir, "report.json");
  const eventsPath = runArtifacts?.eventsPath || path.join(runtime.artifactsDir, "events.jsonl");

  const result: WorkflowRunResult = {
    schemaVersion: "open-dynamic-workflow.report.v1",
    runId: runtime.runId,
    status: "succeeded",
    meta: runtime.parsedWorkflow.meta,
    agents: runtime.agentResults,
    pipelines: runtime.pipelineSummaries,
    workflows: runtime.workflowSummaries,
    tools: runtime.toolExecutor && runtime.toolExecutor.getSummaries().length > 0 ? [...runtime.toolExecutor.getSummaries()] : undefined,
    loops: runtime.loopSummaries,
    startedAt: runtime.startedAt,
    finishedAt,
    durationMs,
    artifactsDir: runtime.artifactsDir,
    reportPath,
    eventsPath,
    limitSummary: runtime.runLimitTracker?.summary()
  };

  if (workflowResult !== undefined) {
    result.result = workflowResult;
  }

  return result;
}

export function buildFailedRunResult(
  runtime: RuntimeState,
  error: unknown,
  durationMs: number,
  finishedAt: string,
  artifactStore?: ArtifactStore
): WorkflowRunResult {
  const runArtifacts = artifactStore ? artifactStore.getRunArtifacts() : undefined;
  const reportPath = runArtifacts?.reportPath || path.join(runtime.artifactsDir, "report.json");
  const eventsPath = runArtifacts?.eventsPath || path.join(runtime.artifactsDir, "events.jsonl");

  const serialized = serializeError(error);

  const result: WorkflowRunResult = {
    schemaVersion: "open-dynamic-workflow.report.v1",
    runId: runtime.runId,
    status: "failed",
    meta: runtime.parsedWorkflow.meta,
    agents: runtime.agentResults,
    pipelines: runtime.pipelineSummaries,
    workflows: runtime.workflowSummaries,
    tools: runtime.toolExecutor && runtime.toolExecutor.getSummaries().length > 0 ? [...runtime.toolExecutor.getSummaries()] : undefined,
    loops: runtime.loopSummaries,
    startedAt: runtime.startedAt,
    finishedAt,
    durationMs,
    artifactsDir: runtime.artifactsDir,
    reportPath,
    eventsPath,
    limitSummary: runtime.runLimitTracker?.summary(),
    error: serialized
  };

  return result;
}

export function buildCancelledRunResult(
  runtime: RuntimeState,
  durationMs: number,
  finishedAt: string,
  reason?: string,
  artifactStore?: ArtifactStore
): WorkflowRunResult {
  const runArtifacts = artifactStore ? artifactStore.getRunArtifacts() : undefined;
  const reportPath = runArtifacts?.reportPath || path.join(runtime.artifactsDir, "report.json");
  const eventsPath = runArtifacts?.eventsPath || path.join(runtime.artifactsDir, "events.jsonl");

  const errorPayload = {
    name: "WorkflowCancelledError",
    message: reason || "Workflow was cancelled",
    code: "USER_CANCELLED"
  };

  const result: WorkflowRunResult = {
    schemaVersion: "open-dynamic-workflow.report.v1",
    runId: runtime.runId,
    status: "cancelled",
    meta: runtime.parsedWorkflow.meta,
    agents: runtime.agentResults,
    pipelines: runtime.pipelineSummaries,
    workflows: runtime.workflowSummaries,
    tools: runtime.toolExecutor && runtime.toolExecutor.getSummaries().length > 0 ? [...runtime.toolExecutor.getSummaries()] : undefined,
    loops: runtime.loopSummaries,
    startedAt: runtime.startedAt,
    finishedAt,
    durationMs,
    artifactsDir: runtime.artifactsDir,
    reportPath,
    eventsPath,
    limitSummary: runtime.runLimitTracker?.summary(),
    error: errorPayload
  };

  return result;
}
