import type { AgentArtifacts } from "../types/artifacts.js";
import type { SerializedError } from "../types/errors.js";

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
  | "agent.cancelled";

export interface EventEnvelope<TPayload = unknown> {
  schemaVersion: "execflow.event.v1";
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
}

export interface AgentStartedPayload {
  agentId: string;
  label?: string;
  provider: string;
  cwd: string;
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
  status: "succeeded";
  durationMs: number;
  exitCode: number;
  artifacts: AgentArtifacts;
}

export interface AgentFailedPayload {
  agentId: string;
  label?: string;
  provider: string;
  status: "failed";
  durationMs: number;
  exitCode: number | null;
  error: SerializedError;
  artifacts: AgentArtifacts;
}

export interface AgentTimedOutPayload {
  agentId: string;
  label?: string;
  provider: string;
  status: "timed_out";
  durationMs: number;
  error: SerializedError;
  artifacts: AgentArtifacts;
}

export interface AgentCancelledPayload {
  agentId: string;
  label?: string;
  provider: string;
  status: "cancelled";
  durationMs: number;
  error?: SerializedError;
  artifacts?: AgentArtifacts;
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as EventEnvelope).schemaVersion === "execflow.event.v1" &&
      typeof (value as EventEnvelope).runId === "string" &&
      typeof (value as EventEnvelope).sequence === "number" &&
      typeof (value as EventEnvelope).timestamp === "string" &&
      typeof (value as EventEnvelope).type === "string"
  );
}
