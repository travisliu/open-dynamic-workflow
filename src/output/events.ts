import type { AgentArtifacts } from "../types/artifacts.js";
import type { SerializedError } from "../types/errors.js";
import type { AgentPermissions } from "../types/agent.js";
import type { WorkflowRunLimitSummary } from "../types/workflow.js";

export type EventType =
  | "workflow.started"
  | "workflow.resolved"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.cancelled"
  | "phase.started"
  | "phase.completed"
  | "workflow.log"
  | "agent.queued"
  | "agent.started"
  | "agent.output"
  | "agent.completed"
  | "agent.cache_hit"
  | "agent.failed"
  | "agent.timed_out"
  | "agent.cancelled"
  | "agent.verbose.command"
  | "agent.verbose.result"
  | "pipeline.started"
  | "pipeline.completed"
  | "pipeline.failed"
  | "pipeline.cancelled"
  | "pipeline.item.started"
  | "pipeline.item.completed"
  | "pipeline.item.failed"
  | "pipeline.stage.started"
  | "pipeline.stage.completed"
  | "pipeline.stage.failed"
  | "workflow.invocation.started"
  | "workflow.invocation.completed"
  | "workflow.invocation.failed"
  | "workflow.invocation.timed_out"
  | "workflow.invocation.cancelled"
  | "tool.queued"
  | "tool.started"
  | "tool.completed"
  | "tool.cache_hit"
  | "tool.failed"
  | "tool.timed_out"
  | "tool.cancelled"
  | "loop.started"
  | "loop.round.started"
  | "loop.round.completed"
  | "loop.round.failed"
  | "loop.round.cancelled"
  | "loop.round.timed_out"
  | "loop.completed"
  | "loop.failed"
  | "loop.cancelled"
  | "loop.timed_out"
  | "loop.max_rounds";

export interface EventEnvelope<TPayload = unknown> {
  schemaVersion: "open-dynamic-workflow.event.v1";
  runId: string;
  sequence: number;
  timestamp: string;
  type: EventType;
  payload: TPayload;
}

export interface WorkflowStartedPayload {
  meta: {
    name: string;
    description: string;
    phases?: string[];
  };
  workflowPath: string;
  artifactsDir: string;
}

export interface WorkflowResolvedPayload {
  requestedTarget: string;
  targetKind: "workflow-name" | "workflow-file";
  workflowName: string;
  workflowFile: string;
  workflowFileRelative: string;
  discoverySource: string;
}

export interface WorkflowCompletedPayload {
  status: "succeeded";
  durationMs: number;
  limitSummary?: WorkflowRunLimitSummary | undefined;
}

export interface WorkflowFailedPayload {
  status: "failed";
  durationMs: number;
  error: SerializedError;
  limitSummary?: WorkflowRunLimitSummary | undefined;
}

export interface WorkflowCancelledPayload {
  status: "cancelled";
  durationMs: number;
  reason?: string;
  limitSummary?: WorkflowRunLimitSummary | undefined;
}

export interface PhaseStartedPayload {
  name: string;
}

export interface PhaseCompletedPayload {
  name: string;
  durationMs?: number;
}

export interface WorkflowLogPayload {
  message: string;
  data?: unknown;
  workflowInvocationId?: string;
}

export interface AgentQueuedPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
}

export interface AgentStartedPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  cwd: string;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
}

export interface AgentOutputPayload {
  agentId: string;
  stream: "stdout" | "stderr";
  data: string;
}

export interface AgentCompletedPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  status: "succeeded";
  durationMs: number;
  exitCode: number;
  artifacts: AgentArtifacts;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
}

export interface AgentCacheHitPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  sequence: number;
  callId?: string;
  previousRunId?: string;
  previousAgentId: string;
  artifacts: AgentArtifacts;
}

export interface AgentFailedPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  status: "failed";
  durationMs: number;
  exitCode: number | null;
  error: SerializedError;
  artifacts: AgentArtifacts;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
}

export interface AgentTimedOutPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  status: "timed_out";
  durationMs: number;
  error: SerializedError;
  artifacts: AgentArtifacts;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
}

export interface AgentCancelledPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  status: "cancelled";
  durationMs: number;
  error?: SerializedError;
  artifacts?: AgentArtifacts;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
}

export interface PipelineStartedPayload {
  pipelineId: string;
  label?: string | undefined;
  strategy: string;
  itemCount: number;
  stages: string[];
}

export interface CompactPipelineStageResult {
  stageName: string;
  stageIndex: number;
  status: "succeeded" | "failed" | "skipped" | "timed_out" | "cancelled";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  childAgentIds: string[];
  error?: SerializedError | undefined;
}

export interface CompactPipelineItemResult {
  itemIndex: number;
  status: "succeeded" | "failed" | "cancelled" | "timed_out";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  failedStage?: string | undefined;
  error?: SerializedError | undefined;
  stages: CompactPipelineStageResult[];
}

export interface PipelineTerminalPayload {
  pipelineId: string;
  status: "succeeded" | "failed" | "cancelled";
  durationMs: number;
  results: CompactPipelineItemResult[];
  artifactPath?: string | undefined;
}

export interface PipelineItemStartedPayload {
  pipelineId: string;
  itemIndex: number;
  startedAt: string;
}

export interface PipelineItemTerminalPayload {
  pipelineId: string;
  itemIndex: number;
  status: "succeeded" | "failed" | "cancelled" | "timed_out";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  failedStage?: string | undefined;
  error?: SerializedError | undefined;
  stages: CompactPipelineStageResult[];
}

export interface PipelineStageStartedPayload {
  pipelineId: string;
  itemIndex: number;
  stageName: string;
  stageIndex: number;
  startedAt: string;
}

export interface PipelineStageTerminalPayload {
  pipelineId: string;
  itemIndex: number;
  stageName: string;
  stageIndex: number;
  status: "succeeded" | "failed" | "skipped" | "timed_out" | "cancelled";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  childAgentIds: string[];
  error?: SerializedError | undefined;
}

export interface WorkflowInvocationStartedPayload {
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string;
  workflowName: string;
  depth: number;
  startedAt: string;
  metadata?: Record<string, unknown>;
  artifactPath?: string;
}

export interface WorkflowInvocationTerminalPayload {
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string;
  workflowName: string;
  status: "succeeded" | "failed" | "timed_out" | "cancelled";
  depth: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  artifactPath?: string;
  error?: SerializedError;
}

export interface ToolEventPayload {
  toolCallId: string;
  definition: string;
  label?: string;
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string;
  queueDurationMs?: number;
  executionDurationMs?: number;
  status?: "succeeded" | "failed" | "cancelled" | "timed_out";
  error?: SerializedError;
  metadata?: Record<string, unknown>;
  artifactPath: string;
  inputPreview?: unknown;
  outputPreview?: unknown;
}

export interface ToolCacheHitPayload {
  toolCallId: string;
  definition: string;
  label?: string;
  sequence: number;
  callId?: string;
  previousRunId?: string;
  previousToolCallId: string;
  artifactPath: string;
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as EventEnvelope).schemaVersion === "open-dynamic-workflow.event.v1" &&
      typeof (value as EventEnvelope).runId === "string" &&
      typeof (value as EventEnvelope).sequence === "number" &&
      typeof (value as EventEnvelope).timestamp === "string" &&
      typeof (value as EventEnvelope).type === "string"
  );
}

export interface RedactedProviderCommand {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string | undefined;
  env?: Record<string, string> | undefined;
}

export interface AgentVerboseCommandPayload {
  agentId: string;
  label?: string | undefined;
  provider: string;
  model?: string | undefined;
  cwd: string;
  command?: RedactedProviderCommand | undefined;
  prompt: string;
  artifacts: AgentArtifacts;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown> | undefined;
  note?: string | undefined;
}

export interface AgentVerboseResultPayload {
  agentId: string;
  label?: string | undefined;
  provider: string;
  model?: string | undefined;
  status: "succeeded" | "failed" | "timed_out" | "cancelled" | "skipped";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  normalized?: unknown;
  error?: SerializedError | undefined;
  parseWarnings?: string[] | undefined;
  artifacts: AgentArtifacts;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown> | undefined;
}

export interface LoopStartedPayload {
  loopId: string;
  workflowInvocationId: string;
  label?: string;
  parentLoopId?: string;
  maxRounds: number;
  timeoutMs?: number;
  artifactPath?: string;
  metadata?: Record<string, unknown>;
}

export interface LoopRoundStartedPayload {
  loopId: string;
  workflowInvocationId: string;
  label?: string;
  roundIndex: number;
  roundNumber: number;
  roundId: string;
  startedAt: string;
  artifactPath?: string;
}

export interface LoopRoundTerminalPayload {
  loopId: string;
  workflowInvocationId: string;
  label?: string;
  roundIndex: number;
  roundNumber: number;
  roundId: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  durationMs: number;
  statePreview?: unknown;
  reason?: string;
  artifactPath?: string;
  error?: SerializedError;
}

export interface LoopTerminalPayload {
  loopId: string;
  workflowInvocationId: string;
  label?: string;
  status: "succeeded" | "max_rounds" | "failed" | "cancelled" | "timed_out";
  roundsCompleted: number;
  roundCount: number;
  maxRounds: number;
  durationMs: number;
  reason?: string;
  artifactPath?: string;
  error?: SerializedError;
  statePreview?: unknown;
}
