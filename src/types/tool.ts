import { SerializedError } from "./errors.js";

export type ToolFailureMode = "throw" | "settled";

export interface ToolCallInput {
  definition: string;
  args: unknown;
  id?: string;
  label?: string;
  timeoutMs?: number;
  failureMode?: ToolFailureMode;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  runId: string;
  toolCallId: string;
  definitionId: string;
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  artifactsDir: string;
  signal: AbortSignal;
  log(message: string, data?: unknown): void;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  defaultTimeoutMs?: number;
  cacheable?: boolean;
  metadata?: Record<string, unknown>;
  run(input: TInput, context: ToolExecutionContext): Promise<TOutput> | TOutput;
}

export const TOOL_DEFINITION_MARKER = Symbol.for("open-dynamic-workflow.toolDefinition");

export interface BrandedToolDefinition<TInput = unknown, TOutput = unknown>
  extends ToolDefinition<TInput, TOutput> {
  readonly [TOOL_DEFINITION_MARKER]: true;
}

export type ToolValidationResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; errors: Array<{ path: string; keyword?: string; message: string }> };

export interface RegisteredToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly definition: BrandedToolDefinition<TInput, TOutput>;
  readonly sourcePath: string;
  readonly validateInput: (data: unknown) => ToolValidationResult<TInput>;
  readonly validateOutput: (data: unknown) => ToolValidationResult<TOutput>;
}

export interface ToolRegistry {
  get(id: string): RegisteredToolDefinition | undefined;
  require(id: string): RegisteredToolDefinition;
  has(id: string): boolean;
  list(): RegisteredToolDefinition[];
}

export interface ToolErrorDetails {
  code: string;
  message: string;
  error?: SerializedError;
}

export type ToolExecutionStatus = "succeeded" | "failed" | "cancelled" | "timed_out";

export interface ToolExecutionResult<TOutput = unknown> {
  toolCallId: string;
  definitionId: string;
  status: ToolExecutionStatus;
  ok: boolean;
  output?: TOutput;
  error?: ToolErrorDetails;
  artifactPath?: string;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  queueDurationMs?: number | undefined;
  durationMs: number;
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  origin?: {
    kind: "loop-round";
    loopId: string;
    loopLabel: string;
    roundIndex: number;
    roundNumber: number;
    roundId: string;
  } | undefined;
  cache?: {
    hit: boolean;
    callId?: string | undefined;
    previousRunId?: string | undefined;
    previousToolCallId?: string | undefined;
  } | undefined;
}

export type ToolSettledResult<TOutput = unknown> =
  | {
      status: "succeeded";
      ok: true;
      toolCallId: string;
      definition: string;
      value: TOutput;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      artifactPath: string;
    }
  | {
      status: "failed" | "cancelled" | "timed_out";
      ok: false;
      toolCallId: string;
      definition: string;
      error: SerializedError;
      startedAt?: string;
      finishedAt: string;
      durationMs: number;
      artifactPath: string;
    };

export interface ToolSummary {
  toolCallId: string;
  definition: string;
  definitionId?: string; // Transitional alias
  label?: string | undefined;
  status: ToolExecutionStatus;
  ok: boolean;
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  origin?: {
    kind: "loop-round";
    loopId: string;
    loopLabel: string;
    roundIndex: number;
    roundNumber: number;
    roundId: string;
  } | undefined;
  queueDurationMs?: number | undefined;
  durationMs: number;
  artifactPath: string;
  cache?: {
    hit: boolean;
    callId?: string | undefined;
    previousRunId?: string | undefined;
    previousToolCallId?: string | undefined;
  } | undefined;
  error?: {
    code: string;
    message: string;
  } | undefined;
}
