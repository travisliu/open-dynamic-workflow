import type { AgentArtifacts } from "./artifacts.js";
import type { JsonSchema, ProviderName } from "./common.js";
import type { SerializedError } from "./errors.js";

export interface AgentCallInput {
  id?: string | undefined;
  label?: string | undefined;
  provider?: ProviderName | undefined;
  prompt: string;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
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
  text?: string | undefined;
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
  label?: string | undefined;
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
  label?: string | undefined;
  provider: ProviderName;
  prompt: string;
  model?: string | undefined;
  schema?: JsonSchema | undefined;
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
