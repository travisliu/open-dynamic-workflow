import type { AgentArtifacts } from "./artifacts.js";
import type { AgentResultStatus, AgentTaskState } from "./agent.js";
import type { ProviderName } from "./common.js";
import type { SerializedError } from "./errors.js";
import type { WorkflowMeta } from "./workflow.js";

export type WorkflowEventType =
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
  | "agent.cancelled";

export interface EventEnvelope<TPayload = unknown> {
  schemaVersion: "execflow.event.v1";
  runId: string;
  sequence: number;
  timestamp: string;
  type: WorkflowEventType;
  payload: TPayload;
}

export interface WorkflowStartedPayload {
  meta: WorkflowMeta;
  cwd: string;
  artifactsDir: string;
}

export interface WorkflowCompletedPayload {
  status: "succeeded";
  durationMs: number;
  result?: unknown;
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

export interface PhasePayload {
  name: string;
}

export interface WorkflowLogPayload {
  message: string;
  data?: unknown;
}

export interface AgentQueuedPayload {
  agentId: string;
  label?: string;
  provider: ProviderName;
  state: Extract<AgentTaskState, "queued">;
}

export interface AgentStartedPayload {
  agentId: string;
  label?: string;
  provider: ProviderName;
  cwd: string;
  state: Extract<AgentTaskState, "running">;
}

export interface AgentOutputPayload {
  agentId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface AgentCompletedPayload {
  agentId: string;
  label?: string;
  provider: ProviderName;
  status: Extract<AgentResultStatus, "succeeded">;
  durationMs: number;
  exitCode: number;
  artifacts: AgentArtifacts;
}

export interface AgentFailedPayload {
  agentId: string;
  label?: string;
  provider: ProviderName;
  status: Exclude<AgentResultStatus, "succeeded">;
  durationMs: number;
  exitCode: number | null;
  artifacts?: AgentArtifacts;
  error: SerializedError;
}

export type WorkflowEvent = EventEnvelope<
  | WorkflowStartedPayload
  | WorkflowCompletedPayload
  | WorkflowFailedPayload
  | WorkflowCancelledPayload
  | PhasePayload
  | WorkflowLogPayload
  | AgentQueuedPayload
  | AgentStartedPayload
  | AgentOutputPayload
  | AgentCompletedPayload
  | AgentFailedPayload
>;
