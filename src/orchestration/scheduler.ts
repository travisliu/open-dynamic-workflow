import type { Scheduler, ScheduledTask, ScheduleOptions, AbortReason } from "../types/scheduler.js";
import type { AgentResult, AgentTaskState, AgentPermissions } from "../types/agent.js";
import type { WorkflowEventType } from "../types/events.js";
import { createLinkedAbortController } from "./cancellation.js";
import { sanitizeMetadata } from "../security/metadata.js";

export interface SchedulerConfig {
  concurrency: number;
  failFast?: boolean;
}

export interface RuntimeEventSink {
  emit(type: WorkflowEventType, payload: any): Promise<unknown> | unknown;
}

interface InternalTask<T = any> {
  task: ScheduledTask<T>;
  options?: ScheduleOptions | undefined;
  status: AgentTaskState;
  abortController: AbortController;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

export class DefaultScheduler implements Scheduler {
  private readonly queue: InternalTask[] = [];
  private readonly running = new Map<string, InternalTask>();
  private readonly completed = new Map<string, any>();
  private aborted = false;
  private abortReason?: AbortReason;
  private readonly concurrency: number;
  private readonly failFast: boolean;
  private readonly eventSink?: RuntimeEventSink | undefined;
  private drainResolvers: (() => void)[] = [];

  constructor(config: SchedulerConfig, deps?: { eventSink?: RuntimeEventSink }) {
    this.concurrency = config.concurrency;
    this.failFast = !!config.failFast;
    this.eventSink = deps?.eventSink ?? undefined;
  }

  schedule<T>(task: ScheduledTask<T>, options?: ScheduleOptions): Promise<T> {
    const abortController = createLinkedAbortController();

    let timeoutTimer: NodeJS.Timeout | null = null;
    if (options?.timeoutMs && options.timeoutMs > 0 && options.timeoutMs !== Infinity) {
      timeoutTimer = setTimeout(() => {
        abortController.abort(`Task ${task.id} timed out after ${options.timeoutMs}ms`);
      }, options.timeoutMs);
    }

    let resolveFn!: (value: T) => void;
    let rejectFn!: (reason: any) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveFn = (value: T) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve(value);
      };
      rejectFn = (reason: any) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        reject(reason);
      };
    });

    const internalTask: InternalTask<T> = {
      task,
      options: options !== undefined ? options : undefined,
      status: "queued",
      abortController,
      promise,
      resolve: resolveFn,
      reject: rejectFn
    };

    if (this.aborted) {
      internalTask.status = "skipped";
      const skippedResult = this.createSkippedOrCancelledResult(task, "skipped", this.abortReason);
      resolveFn(skippedResult as any);
      return promise;
    }

    this.queue.push(internalTask);

    if (this.eventSink) {
      this.eventSink.emit("agent.queued", {
        agentId: task.id,
        label: task.label,
        provider: task.provider || options?.provider || "mock",
        model: task.model || options?.model,
        state: "queued",
        permissions: task.permissions || { mode: "default" },
        metadata: sanitizeMetadata(task.metadata)
      });
    }

    process.nextTick(() => this.pump());

    return promise;
  }

  abort(reason?: string | AbortReason): void {
    if (this.aborted) return;
    this.aborted = true;
    
    if (typeof reason === "string") {
      this.abortReason = { type: "other", message: reason };
    } else if (reason) {
      this.abortReason = reason;
    } else {
      this.abortReason = { type: "other", message: "Scheduler aborted" };
    }

    const abortMsg = this.abortReason.message;

    // Abort running tasks
    for (const runningTask of this.running.values()) {
      runningTask.abortController.abort(abortMsg);
    }

    // Skip queued tasks
    while (this.queue.length > 0) {
      const queuedTask = this.queue.shift()!;
      queuedTask.status = "skipped";
      const result = this.createSkippedOrCancelledResult(queuedTask.task, "skipped", this.abortReason);
      
      if (this.eventSink) {
        this.eventSink.emit("agent.cancelled", {
          agentId: queuedTask.task.id,
          label: queuedTask.task.label,
          provider: queuedTask.task.provider || queuedTask.options?.provider || "mock",
          status: "skipped",
          durationMs: 0,
          exitCode: null,
          error: {
            name: "AgentTaskSkipped",
            message: abortMsg,
            code: "TASK_SKIPPED"
          },
          permissions: queuedTask.task.permissions || { mode: "default" },
          metadata: sanitizeMetadata(queuedTask.task.metadata)
        });
      }

      queuedTask.resolve(result as any);
    }

    this.checkDrain();
  }

  async drain(): Promise<void> {
    if (this.running.size === 0 && this.queue.length === 0) {
      return;
    }
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  getSnapshot() {
    return {
      aborted: this.aborted,
      abortReason: this.abortReason,
      runningCount: this.running.size,
      queuedCount: this.queue.length,
      completedCount: this.completed.size
    };
  }

  private pump(): void {
    if (this.aborted) {
      return;
    }

    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const internalTask = this.queue.shift()!;
      this.running.set(internalTask.task.id, internalTask);
      internalTask.status = "running";

      if (this.eventSink) {
        this.eventSink.emit("agent.started", {
          agentId: internalTask.task.id,
          label: internalTask.task.label,
          provider: internalTask.task.provider || internalTask.options?.provider || "mock",
          model: internalTask.task.model || internalTask.options?.model,
          cwd: internalTask.options?.cwd || process.cwd(),
          state: "running",
          permissions: internalTask.task.permissions || { mode: "default" },
          metadata: sanitizeMetadata(internalTask.task.metadata)
        });
      }

      const startTime = Date.now();

      (async () => {
        try {
          const result = await internalTask.task.run(internalTask.abortController.signal);
          
          this.running.delete(internalTask.task.id);
          this.completed.set(internalTask.task.id, result);

          let isSuccess = true;
          let agentStatus = "succeeded";
          let agentResult: any = result;

          if (agentResult && typeof agentResult === "object" && "ok" in agentResult) {
            isSuccess = agentResult.ok;
            agentStatus = agentResult.status || (isSuccess ? "succeeded" : "failed");
          }

          if (isSuccess) {
            if (this.eventSink) {
              this.eventSink.emit("agent.completed", {
                agentId: internalTask.task.id,
                label: internalTask.task.label,
                provider: internalTask.task.provider || internalTask.options?.provider || "mock",
                model: internalTask.task.model || internalTask.options?.model,
                status: "succeeded",
                durationMs: Date.now() - startTime,
                exitCode: agentResult?.exitCode ?? 0,
                artifacts: agentResult?.artifacts ?? { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
                permissions: internalTask.task.permissions || { mode: "default" },
                metadata: sanitizeMetadata(internalTask.task.metadata),
                usage: agentResult?.usage,
                threadId: agentResult?.threadId,
                providerMetadata: agentResult?.providerMetadata
              });
            }
            internalTask.resolve(result);
          } else {
            const durationMs = Date.now() - startTime;
            const exitCode = agentResult?.exitCode ?? null;
            const artifacts = agentResult?.artifacts;
            const error = agentResult?.error || { name: "AgentFailure", message: "Agent failed execution", code: "PROVIDER_PROCESS_FAILED" };

            const eventName = this.getEventNameForStatus(agentStatus);
            if (this.eventSink) {
              this.eventSink.emit(eventName, {
                agentId: internalTask.task.id,
                label: internalTask.task.label,
                provider: internalTask.task.provider || internalTask.options?.provider || "mock",
                model: internalTask.task.model || internalTask.options?.model,
                status: agentStatus,
                durationMs,
                exitCode,
                artifacts,
                error,
                permissions: internalTask.task.permissions || { mode: "default" },
                metadata: sanitizeMetadata(internalTask.task.metadata),
                usage: agentResult?.usage,
                threadId: agentResult?.threadId,
                providerMetadata: agentResult?.providerMetadata
              });
            }

            internalTask.resolve(result);

            if (this.failFast || internalTask.options?.failFast) {
              this.abort({
                type: "fail-fast",
                message: `Fail-fast triggered by step ${internalTask.task.id}`,
                source: internalTask.task.id,
                cause: agentStatus === "timed_out" ? "timeout" : "failure"
              });
            }
          }
        } catch (err: any) {
          this.running.delete(internalTask.task.id);
          
          const durationMs = Date.now() - startTime;
          const isAbort = internalTask.abortController.signal.aborted || err.name === "AbortError";
          const status = isAbort ? "cancelled" : "failed";
          
          let code = isAbort ? "USER_CANCELLED" : "INTERNAL_ERROR";
          if (!isAbort && err && typeof err === "object" && "code" in err) {
            code = err.code;
          }

          const errorPayload = {
            name: err.name || "Error",
            message: err.message || String(err),
            code
          };
          if (err.stack) {
            (errorPayload as any).stack = err.stack;
          }

          const failureResult = {
            ok: false,
            status,
            id: internalTask.task.id,
            label: internalTask.task.label,
            provider: internalTask.task.provider || internalTask.options?.provider || "mock",
            model: internalTask.task.model || internalTask.options?.model,
            stdout: "",
            stderr: err.message || "",
            exitCode: null,
            durationMs,
            artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
            error: errorPayload,
            permissions: internalTask.task.permissions || { mode: "default" }
          };

          this.completed.set(internalTask.task.id, failureResult);

      if (this.eventSink) {
        const eventName = isAbort ? "agent.cancelled" : "agent.failed";
        this.eventSink.emit(eventName, {
          agentId: internalTask.task.id,
          label: internalTask.task.label,
          provider: internalTask.task.provider || internalTask.options?.provider || "mock",
          model: internalTask.task.model || internalTask.options?.model,
          status,
          durationMs,
          exitCode: null,
          error: errorPayload,
          permissions: internalTask.task.permissions || { mode: "default" },
          metadata: sanitizeMetadata(internalTask.task.metadata)
        });
      }

          internalTask.resolve(failureResult as any);

          if (this.failFast || internalTask.options?.failFast) {
            this.abort({
              type: "fail-fast",
              message: `Fail-fast triggered by step ${internalTask.task.id} throwing error`,
              source: internalTask.task.id,
              cause: "error"
            });
          }
        } finally {
          this.pump();
          this.checkDrain();
        }
      })();
    }

    this.checkDrain();
  }

  private getEventNameForStatus(status: string): WorkflowEventType {
    switch (status) {
      case "timed_out":
        return "agent.timed_out";
      case "cancelled":
      case "skipped":
        return "agent.cancelled";
      case "failed":
      default:
        return "agent.failed";
    }
  }

  private checkDrain(): void {
    if (this.running.size === 0 && this.queue.length === 0) {
      const resolvers = this.drainResolvers;
      this.drainResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  private createSkippedOrCancelledResult(task: ScheduledTask<any>, status: "skipped" | "cancelled", reason?: string | AbortReason): AgentResult {
    const reasonMsg = typeof reason === "string" ? reason : reason?.message;
    const res: AgentResult = {
      ok: false,
      status,
      id: task.id,
      provider: task.provider || "mock",
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 0,
      artifacts: {
        dir: "",
        promptPath: "",
        stdoutPath: "",
        stderrPath: ""
      },
      error: {
        name: status === "skipped" ? "AgentTaskSkipped" : "AgentTaskCancelled",
        message: reasonMsg || `Task was ${status}`,
        code: status === "skipped" ? "TASK_SKIPPED" : "USER_CANCELLED"
      },
      permissions: task.permissions || { mode: "default" }
    };
    if (task.label !== undefined) {
      res.label = task.label;
    }
    return res;
  }
}
