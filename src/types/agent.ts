import type { AgentArtifacts } from "./artifacts.js";
import type { JsonSchema, ProviderName } from "./common.js";
import type { SerializedError } from "./errors.js";

export interface AgentCallInput {
  id?: string;
  label?: string;
  provider?: ProviderName;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs?: number;
  cwd?: string;
  metadata?: Record<string, unknown>;
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
  label?: string;
  provider: ProviderName;
  text?: string;
  json?: unknown;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  artifacts: AgentArtifacts;
}

export interface AgentFailureResult {
  ok: false;
  status: "failed" | "timed_out" | "cancelled" | "skipped";
  id: string;
  label?: string;
  provider: ProviderName;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  artifacts: AgentArtifacts;
  error: SerializedError;
}

export interface AgentRunInput {
  id: string;
  label?: string;
  provider: ProviderName;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs: number;
  cwd: string;
  env: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ProviderHealth {
  provider: ProviderName;
  available: boolean;
  command?: string;
  version?: string;
  error?: SerializedError;
}

export interface ProviderCommand {
  command: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env: Record<string, string>;
}

export interface ProviderParseInput {
  agentId: string;
  provider: ProviderName;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

export interface ProviderParsedResult {
  text?: string;
  json?: unknown;
  raw?: unknown;
  parseWarnings?: string[];
}

export interface AgentAdapter {
  name: ProviderName;
  checkHealth?(): Promise<ProviderHealth>;
  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;
  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}
