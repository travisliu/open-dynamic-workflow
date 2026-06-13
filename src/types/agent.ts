import type { AgentArtifacts } from "./artifacts.js";
import type { JsonSchema, ProviderName } from "./common.js";
import type { SerializedError } from "./errors.js";

export type StructuredOutputTransport = "validate-only" | "prompt" | "native" | "auto";

export interface StructuredOutputConfig {
  transport?: StructuredOutputTransport | undefined;
}

export interface AgentPermissionsInput {
  mode: "dangerously-full-access";
}

export type AgentPermissions =
  | { mode: "default" }
  | { mode: "dangerously-full-access" };

export interface DirectAgentCallInput {
  id?: string | undefined;
  label?: string | undefined;
  provider?: ProviderName | undefined;
  prompt: string;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
  structuredOutput?: StructuredOutputConfig | undefined;
  timeoutMs?: number | undefined;
  cwd?: string | undefined;
  permissions?: AgentPermissionsInput | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface DefinitionAgentCallInput {
  id?: string | undefined;
  definition: string;
  label?: string | undefined;
  provider?: ProviderName | undefined;
  prompt?: string | undefined;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
  structuredOutput?: StructuredOutputConfig | undefined;
  timeoutMs?: number | undefined;
  cwd?: string | undefined;
  permissions?: AgentPermissionsInput | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type AgentCallInput = DirectAgentCallInput | DefinitionAgentCallInput;

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
  permissions: AgentPermissions;
  cache?: AgentResultCacheInfo | undefined;
  metadata?: Record<string, unknown> | undefined;
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
  permissions: AgentPermissions;
  cache?: AgentResultCacheInfo | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AgentResultCacheInfo {
  hit: boolean;
  callId?: string | undefined;
  previousRunId?: string | undefined;
  previousAgentId?: string | undefined;
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
  permissions: AgentPermissions;
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
  env?: Record<string, string> | undefined;
}

export interface ProviderParseInput {
  input: AgentRunInput;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ProviderParsedResult {
  text?: string;
  json?: unknown;
  structuredJson?: unknown;
  raw?: unknown;
  parseWarnings?: string[];
}

export interface AgentAdapter {
  name: ProviderName;
  checkHealth?(): Promise<ProviderHealth>;
  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;
  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}
