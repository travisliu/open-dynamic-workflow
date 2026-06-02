export type JsonObject = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;

export type ProviderName = "mock" | "codex" | "gemini" | string;

export type ReporterMode = "pretty" | "json" | "jsonl";

export type WorkflowStatus = "succeeded" | "failed" | "cancelled";

export type MaybePromise<T> = T | Promise<T>;

export interface Timestamped {
  timestamp: string;
}
