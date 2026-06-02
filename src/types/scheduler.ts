import type { MaybePromise, ProviderName } from "./common.js";

export interface ScheduledTask<T> {
  id: string;
  label?: string | undefined;
  provider?: ProviderName | undefined;
  run: (signal: AbortSignal) => MaybePromise<T>;
}

export interface ScheduleOptions {
  provider?: ProviderName | undefined;
  priority?: number | undefined;
  timeoutMs?: number | undefined;
  failFast?: boolean | undefined;
  cwd?: string | undefined;
}

export interface Scheduler {
  schedule<T>(task: ScheduledTask<T>, options?: ScheduleOptions): Promise<T>;
  drain(): Promise<void>;
  abort(reason?: string): void;
}
