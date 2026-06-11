import type { MaybePromise, ProviderName } from "./common.js";
import type { AgentPermissions } from "./agent.js";

export interface AbortReason {
  type: "fail-fast" | "user" | "timeout" | "other";
  message: string;
  source?: string;
  cause?: "failure" | "timeout" | "error";
}

export interface ScheduledTask<T> {
  id: string;
  label?: string | undefined;
  provider?: ProviderName | undefined;
  model?: string | undefined;
  permissions?: AgentPermissions | undefined;
  metadata?: Record<string, unknown> | undefined;
  run: (signal: AbortSignal) => MaybePromise<T>;
}

export interface ScheduleOptions {
  provider?: ProviderName | undefined;
  model?: string | undefined;
  priority?: number | undefined;
  timeoutMs?: number | undefined;
  failFast?: boolean | undefined;
  cwd?: string | undefined;
}

export interface Scheduler {
  schedule<T>(task: ScheduledTask<T>, options?: ScheduleOptions): Promise<T>;
  drain(): Promise<void>;
  abort(reason?: string | AbortReason): void;
}
