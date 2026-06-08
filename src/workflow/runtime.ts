import * as path from "node:path";
import * as vm from "node:vm";
import type { ParsedWorkflow, WorkflowRunResult, WorkflowMeta } from "../types/workflow.js";
import type { ResolvedConfig, CliRunOptions } from "../types/config.js";
import type { AgentResult } from "../types/agent.js";
import type { SerializedError } from "../types/errors.js";
import type { ArtifactStore } from "../types/artifacts.js";
import type { AgentExecutor } from "../agents/execution-types.js";
import type { RuntimeEventSink } from "../orchestration/scheduler.js";
import { DefaultScheduler } from "../orchestration/scheduler.js";
import { createDsl } from "./dsl.js";
import { createSandboxContext } from "./sandbox.js";
import type { RuntimeState } from "./types.js";
import { serializeError } from "../errors/serialize.js";
import { createLinkedAbortController } from "../orchestration/cancellation.js";
import { shouldTriggerFailFast } from "../orchestration/fail-fast.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { loadRuntimeCallCache } from "../artifacts/call-cache.js";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  nextId(prefix: string): string;
}

export interface RuntimeRunInput {
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedConfig;
  cli: CliRunOptions;
  signal?: AbortSignal;
}

export interface RuntimeDependencies {
  agentExecutor: AgentExecutor;
  eventSink: RuntimeEventSink;
  artifactStore?: ArtifactStore;
  clock?: Clock;
  idGenerator?: IdGenerator;
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
    const artifactsDir = input.cli.outDir || input.config.outDir || path.resolve(cwd, ".openflow/runs", runId);

    const scheduler = new DefaultScheduler(
      {
        concurrency: input.cli.concurrency ?? input.config.concurrency ?? 1,
        failFast: !!(input.cli.failFast || input.config.failFast)
      },
      { eventSink: deps.eventSink }
    );

    const runtimeAbortController = createLinkedAbortController(input.signal);
    const callCache = await loadRuntimeCallCache({
      resume: input.cli.resume,
      noCache: input.cli.noCache,
      config: input.config,
      workflowHash: input.parsedWorkflow.sourceHash
    });

    const runtime: RuntimeState = {
      artifactStore: deps.artifactStore,
      runId,
      parsedWorkflow: input.parsedWorkflow,
      config: input.config,
      cli: input.cli,
      args: (input.cli.args as any) || {},
      cwd,
      artifactsDir,
      agentResults: [],
      scheduler,
      agentExecutor: deps.agentExecutor,
      eventSink: deps.eventSink,
      abortController: runtimeAbortController,
      agentCounter: 0,
      pipelineCounter: 0,
      pipelineSummaries: [],
      startedAt: startTime.toISOString(),
      idGenerator: deps.idGenerator !== undefined ? deps.idGenerator : undefined,
      failFast: input.cli.failFast,
      callCache
    };

    if (deps.artifactStore && !deps.artifactStore.isRunCreated()) {
      await deps.artifactStore.createRun({
        runId,
        outDir: artifactsDir,
        workflowPath: input.parsedWorkflow.sourcePath,
        workflowSource: input.parsedWorkflow.sourceText || "",
        workflowHash: input.parsedWorkflow.sourceHash,
        resolvedConfig: input.config,
        openflowVersion: input.parsedWorkflow.meta.version || "0.0.0",
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
        throw new Error(String(runtimeAbortController.signal.reason || "Workflow cancelled before execution started."));
      }

      const workflowResult = await executeWorkflowModule(runtime);

      // Wait for scheduler to drain all pending tasks
      await scheduler.drain();

      const finishTime = deps.clock ? deps.clock.now() : new Date();
      const durationMs = finishTime.getTime() - startTime.getTime();

      // Check if scheduler is aborted
      const schedulerSnapshot = (scheduler as any).getSnapshot();
      if (schedulerSnapshot.aborted) {
        const abortReason = schedulerSnapshot.abortReason;
        const isFailFast = abortReason?.type === "fail-fast";
        const reasonMsg = typeof abortReason === "string" ? abortReason : abortReason?.message;

        if (isFailFast) {
          // Build failed run result for fail-fast
          const result = buildFailedRunResult(runtime, new Error(reasonMsg), durationMs, finishTime.toISOString(), deps.artifactStore);
          if (deps.eventSink) {
            deps.eventSink.emit("workflow.failed", {
              status: "failed",
              durationMs,
              error: result.error!
            });
          }
          if (deps.artifactStore) {
            await deps.artifactStore.updateManifest("failed", result.error);
          }
          return result;
        } else {
          // Build cancelled run result
          const result = buildCancelledRunResult(runtime, durationMs, finishTime.toISOString(), reasonMsg, deps.artifactStore);
          if (deps.eventSink) {
            deps.eventSink.emit("workflow.cancelled", {
              status: "cancelled",
              durationMs,
              reason: reasonMsg || "Workflow cancelled"
            });
          }
          if (deps.artifactStore) {
            await deps.artifactStore.updateManifest("cancelled", result.error);
          }
          return result;
        }
        }

        // Build succeeded run result
        const result = buildSucceededRunResult(runtime, workflowResult, durationMs, finishTime.toISOString(), deps.artifactStore);
        if (deps.eventSink) {
        deps.eventSink.emit("workflow.completed", {
          status: "succeeded",
          durationMs,
          result: workflowResult
        });
        }
        if (deps.artifactStore) {
        await deps.artifactStore.updateManifest("succeeded");
        }
        return result;
        } catch (err: any) {
        // Scheduler drain to ensure everything settles
        try {
        await scheduler.drain();
        } catch {
        // Ignore errors during final drain
        }

        const finishTime = deps.clock ? deps.clock.now() : new Date();
        const durationMs = finishTime.getTime() - startTime.getTime();

        const isCancelled = runtimeAbortController.signal.aborted || err.name === "WorkflowCancelledError";

        if (isCancelled) {
        const result = buildCancelledRunResult(runtime, durationMs, finishTime.toISOString(), err.message, deps.artifactStore);
        if (deps.eventSink) {
          deps.eventSink.emit("workflow.cancelled", {
            status: "cancelled",
            durationMs,
            reason: err.message || "Workflow cancelled"
          });
        }
        if (deps.artifactStore) {
          await deps.artifactStore.updateManifest("cancelled", result.error);
        }
        return result;
        } else {
        const result = buildFailedRunResult(runtime, err, durationMs, finishTime.toISOString(), deps.artifactStore);
        if (deps.eventSink) {
          deps.eventSink.emit("workflow.failed", {
            status: "failed",
            durationMs,
            error: result.error!
          });
        }
        if (deps.artifactStore) {
          await deps.artifactStore.updateManifest("failed", result.error);
        }
        return result;
        }
        }
  }
}

export async function executeWorkflowModule(runtime: RuntimeState): Promise<unknown> {
  let context: vm.Context;
  try {
    context = createSandboxContext(runtime);
  } catch (err: any) {
    throw new OpenFlowError(
      ErrorCode.SECURITY_POLICY_VIOLATION,
      `Failed to create secure sandbox context: ${err.message}`,
      { cause: err }
    );
  }

  const body = runtime.parsedWorkflow.body;
  const transformedBody = body.replace(/export\s+default\s+/, "__default = ");
  const wrappedBody = `(async () => {\n${transformedBody}\n})()`;

  try {
    const promise = vm.runInContext(wrappedBody, context, {
      filename: runtime.parsedWorkflow.sourcePath,
      lineOffset: -1
    });

    await promise;
    return (context as any).__default;
  } catch (err: any) {
    // Check if it's already an OpenFlowError (e.g. from DSL)
    // We check both instanceof and the presence of the 'code' property 
    // to handle errors coming from the VM context.
    if (err instanceof OpenFlowError || (err && typeof err === "object" && "code" in err && "name" in err && err.name === "OpenFlowError")) {
      throw err;
    }

    // Map potential sandbox escapes or violations to SECURITY_POLICY_VIOLATION
    const isSecurityViolation = err.name === "SecurityError";

    if (isSecurityViolation) {
      throw new OpenFlowError(
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
    schemaVersion: "openflow.report.v1",
    runId: runtime.runId,
    status: "succeeded",
    meta: runtime.parsedWorkflow.meta,
    agents: runtime.agentResults,
    pipelines: runtime.pipelineSummaries,
    startedAt: runtime.startedAt,
    finishedAt,
    durationMs,
    artifactsDir: runtime.artifactsDir,
    reportPath,
    eventsPath
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
    schemaVersion: "openflow.report.v1",
    runId: runtime.runId,
    status: "failed",
    meta: runtime.parsedWorkflow.meta,
    agents: runtime.agentResults,
    pipelines: runtime.pipelineSummaries,
    startedAt: runtime.startedAt,
    finishedAt,
    durationMs,
    artifactsDir: runtime.artifactsDir,
    reportPath,
    eventsPath,
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
    schemaVersion: "openflow.report.v1",
    runId: runtime.runId,
    status: "cancelled",
    meta: runtime.parsedWorkflow.meta,
    agents: runtime.agentResults,
    pipelines: runtime.pipelineSummaries,
    startedAt: runtime.startedAt,
    finishedAt,
    durationMs,
    artifactsDir: runtime.artifactsDir,
    reportPath,
    eventsPath,
    error: errorPayload
  };

  return result;
}
