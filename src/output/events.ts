import type { AgentArtifacts } from "../types/artifacts.js";
import type { SerializedError } from "../types/errors.js";
import type { AgentPermissions } from "../types/agent.js";

export type EventType =
  | "workflow.started"
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
  | "agent.failed"
  | "agent.timed_out"
  | "agent.cancelled"
  | "pipeline.started"
  | "pipeline.completed"
  | "pipeline.failed"
  | "pipeline.cancelled"
  | "pipeline.item.started"
  | "pipeline.item.completed"
  | "pipeline.item.failed"
  | "pipeline.stage.started"
  | "pipeline.stage.completed"
  | "pipeline.stage.failed";

export interface EventEnvelope<TPayload = unknown> {
  schemaVersion: "openflow.event.v1";
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

export interface WorkflowCompletedPayload {
  status: "succeeded";
  durationMs: number;
}

export interface WorkflowFailedPayload {
  status: "failed";
  durationMs: number;
  error: SerializedError;
}

export interface WorkflowCancelledPayload {
  status: "cancelled";
  durationMs: number;
  reason?: string;
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
}

export interface AgentQueuedPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  permissions: AgentPermissions;
}

export interface AgentStartedPayload {
  agentId: string;
  label?: string;
  provider: string;
  model?: string;
  cwd: string;
  permissions: AgentPermissions;
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

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as EventEnvelope).schemaVersion === "openflow.event.v1" &&
      typeof (value as EventEnvelope).runId === "string" &&
      typeof (value as EventEnvelope).sequence === "number" &&
      typeof (value as EventEnvelope).timestamp === "string" &&
      typeof (value as EventEnvelope).type === "string"
  );
}
