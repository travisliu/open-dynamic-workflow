import type { RegisteredToolDefinition, ToolExecutionResult, ToolSummary, ToolFailureMode } from "../types/tool.js";
import type { SerializedError } from "../types/errors.js";
import type { ArtifactStore, RunArtifacts } from "../types/artifacts.js";
import type { RuntimeEventSink } from "../orchestration/scheduler.js";

export interface PreparedToolCall {
  toolCallId: string;
  definition: RegisteredToolDefinition;
  args: unknown;
  label?: string | undefined;
  failureMode: ToolFailureMode;
  metadata?: Record<string, unknown> | undefined;
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  queuedAt: string;
  deadline?: number | undefined;
  timeoutMs?: number | undefined;
  artifactPath: string;
  invocationSignal: AbortSignal;
  origin?: {
    kind: "loop-round";
    loopId: string;
    loopLabel: string;
    roundIndex: number;
    roundNumber: number;
    roundId: string;
  } | undefined;
}

export interface Clock {
  now(): Date;
}

export interface ToolExecutorDependencies {
  concurrency: number;
  eventSink: RuntimeEventSink;
  artifactStore: ArtifactStore;
  runArtifacts: RunArtifacts;
  runId: string;
  cwd: string;
  clock?: Clock;
  rootSignal: AbortSignal;
  redactedSecrets?: string[];
}

export interface ToolExecutor {
  execute<TOutput>(call: PreparedToolCall): Promise<ToolExecutionResult<TOutput>>;
  cancel(reason: SerializedError): void;
  close(): Promise<void>;
  getSummaries(): readonly ToolSummary[];
  addSummary(summary: ToolSummary): void;
}
