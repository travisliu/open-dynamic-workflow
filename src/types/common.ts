export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = JsonObject;

export type ProviderName = "mock" | "codex" | "gemini" | "opencode" | "antigravity" | "pi" | string;

export type ReporterMode = "pretty" | "json" | "jsonl";

export type WorkflowStatus = "succeeded" | "failed" | "cancelled";

export type MaybePromise<T> = T | Promise<T>;

export interface Timestamped {
  timestamp: string;
}
