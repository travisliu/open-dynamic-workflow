import type { MaybePromise, ProviderName } from "./common.js";

export interface ScheduledTask<T> {
  id: string;
  label?: string;
  provider?: ProviderName;
  run: () => MaybePromise<T>;
}

export interface ScheduleOptions {
  provider?: ProviderName;
  priority?: number;
  timeoutMs?: number;
  failFast?: boolean;
}

export interface Scheduler {
  schedule<T>(task: ScheduledTask<T>, options?: ScheduleOptions): Promise<T>;
  drain(): Promise<void>;
  abort(reason?: string): void;
}
