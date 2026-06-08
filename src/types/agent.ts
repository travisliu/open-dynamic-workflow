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
  optional?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type AgentStringOptions = Omit<AgentCallInput, "prompt"> & {
  optional?: boolean | undefined;
};

export type AgentReviewOptions = AgentStringOptions & {
  uncommitted?: boolean | undefined;
  base?: string | undefined;
  commit?: string | undefined;
  title?: string | undefined;
};

export interface AgentRuntimeFunction {
  (input: AgentCallInput): Promise<AgentResult>;
  (prompt: string, options?: AgentStringOptions): Promise<string | unknown | null>;
  review(prompt: string, options?: AgentReviewOptions): Promise<string | unknown | null>;
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
  schemaPath?: string | undefined;
  lastMessagePath?: string | undefined;
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
  lastMessage?: string | undefined;
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
