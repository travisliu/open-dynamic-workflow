import type { AgentArtifacts } from "./artifacts.js";
import type { JsonSchema, ProviderName } from "./common.js";
import type { SerializedError } from "./errors.js";

export type StructuredOutputTransport = "validate-only" | "prompt" | "native" | "auto";

export interface StructuredOutputConfig {
  transport?: StructuredOutputTransport | undefined;
}

export interface AgentCallInput {
  id?: string | undefined;
  label?: string | undefined;
  provider?: ProviderName | undefined;
  prompt: string;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
  structuredOutput?: StructuredOutputConfig | undefined;
  timeoutMs?: number | undefined;
  cwd?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type AgentTaskState =
  | "queued"
  | "preparing"
  | "running"
  | "validating"
  | "collecting_artifacts"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "skipped";

export type AgentResultStatus = "succeeded" | "failed" | "timed_out" | "cancelled" | "skipped";

export type AgentResult = AgentSuccessResult | AgentFailureResult;

export interface AgentSuccessResult {
  ok: true;
  status: "succeeded";
  id: string;
  label?: string | undefined;
  provider: ProviderName;
  model?: string | undefined;
  text?: string | undefined;
  json?: unknown;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  artifacts: AgentArtifacts;
  usage?: AgentUsage | undefined;
  threadId?: string | undefined;
  providerMetadata?: Record<string, unknown> | undefined;
}

export interface AgentFailureResult {
  ok: false;
  status: "failed" | "timed_out" | "cancelled" | "skipped";
  id: string;
  label?: string | undefined;
  provider: ProviderName;
  model?: string | undefined;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  artifacts: AgentArtifacts;
  error: SerializedError;
  usage?: AgentUsage | undefined;
  threadId?: string | undefined;
  providerMetadata?: Record<string, unknown> | undefined;
}

export interface AgentRunInput {
  id: string;
  label?: string | undefined;
  provider: ProviderName;
  prompt: string;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
  structuredOutput?: StructuredOutputConfig | undefined;
  timeoutMs: number;
  cwd: string;
  env: Record<string, string>;
  metadata?: Record<string, unknown> | undefined;
}

export interface ProviderHealth {
  provider: ProviderName;
  available: boolean;
  command?: string;
  version?: string;
  message?: string;
  error?: SerializedError;
  supportsModelSelection?: boolean;
}

export interface ProviderCommand {
  command: string;
  args: string[];
  stdin?: string | undefined;
  cwd: string;
  env: Record<string, string>;
}

export interface ProviderParseInput {
  input: AgentRunInput;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface AgentCliCapabilities {
  prompt: {
    transports: Array<"stdin" | "argv" | "file">;
  };
  output: {
    formats: Array<"text" | "json" | "jsonl" | "last-message-file" | "session-export">;
    terminalErrorEvents?: boolean | undefined;
  };
  structuredOutput: {
    modes: Array<"prompt" | "validate-only" | "native-json-schema">;
  };
  usage: {
    source: "none" | "final-event" | "session-export" | "telemetry";
    hasCost?: boolean | undefined;
  };
  sessions: {
    modes: Array<"none" | "ephemeral" | "resume" | "fork">;
  };
  permissions: {
    modes: Array<"none" | "sandbox" | "approval" | "tool-allowlist" | "profile">;
  };
}

export interface AgentUsage {
  inputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  outputTokens?: number | undefined;
  reasoningOutputTokens?: number | undefined;
  totalTokens?: number | undefined;
  costUsd?: number | undefined;
}

export interface ProviderFailure {
  name: string;
  message: string;
  code: "PROVIDER_PROCESS_FAILED" | "PROVIDER_REPORTED_FAILURE" | "PROVIDER_PARSE_FAILED";
  retryable?: boolean | undefined;
  raw?: unknown;
}

export interface ProviderParsedResult {
  text?: string;
  json?: unknown;
  structuredJson?: unknown;
  raw?: unknown;
  parseWarnings?: string[];
  usage?: AgentUsage | undefined;
  providerSessionId?: string | undefined;
  providerThreadId?: string | undefined;
  providerMetadata?: Record<string, unknown> | undefined;
  failure?: ProviderFailure | undefined;
}

export interface AgentAdapter {
  name: ProviderName;
  capabilities?(): AgentCliCapabilities;
  checkHealth?(): Promise<ProviderHealth>;
  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;
  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}
