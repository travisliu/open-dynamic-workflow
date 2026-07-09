import type { AgentCallInput, AgentResult } from "../types/agent.js";
import type { SerializedError } from "../types/errors.js";
import type { WorkflowContext } from "../types/context.js";
import type { ContextMergeStrategy } from "../context/index.js";

export interface PipelineContextOptions {
  merge?: Record<string, ContextMergeStrategy>;
}

export type PipelineStrategy = "item-streaming" | "stage-barrier";

export interface PipelineOptions {
  label?: string;
  strategy?: PipelineStrategy;
  concurrency?: number;
  stageConcurrency?: Record<string, number>;
  preserveOrder?: boolean;
  failFast?: boolean;
  context?: PipelineContextOptions;
}

export interface NormalizedPipelineOptions {
  label?: string;
  strategy: PipelineStrategy;
  concurrency?: number;
  stageConcurrency: Record<string, number>;
  preserveOrder: boolean;
  failFast: boolean;
  context?: PipelineContextOptions;
}

export interface PipelineStageContext {
  pipelineId: string;
  runId: string;
  artifactsDir: string;
  itemIndex: number;
  stageIndex: number;
  stageName: string;
  context: WorkflowContext;
  agent(input: AgentCallInput): Promise<AgentResult>;
  log(message: string, data?: unknown): void;
  agentId(suffix?: string): string;
  signal: AbortSignal;
  sleep(ms: number): Promise<void>;
}

export interface PipelineStage<I = unknown, O = unknown> {
  name: string;
  run: (input: I, context: PipelineStageContext) => Promise<O> | O;
  concurrency?: number;
  timeoutMs?: number;
}

export interface PipelineStageResult<O = unknown> {
  stageName: string;
  stageIndex: number;
  status: "succeeded" | "failed" | "skipped" | "timed_out" | "cancelled";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  value?: O;
  error?: SerializedError;
  childAgentIds: string[];
}

export interface PipelineItemSuccess<O = unknown> {
  itemIndex: number;
  status: "succeeded";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  value: O;
  stages: PipelineStageResult[];
}

export interface PipelineItemFailure {
  itemIndex: number;
  status: "failed" | "cancelled" | "timed_out";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  failedStage?: string;
  error?: SerializedError;
  stages: PipelineStageResult[];
}

export type PipelineItemResult<O = unknown> = PipelineItemSuccess<O> | PipelineItemFailure;

export type PipelineResult<O = unknown> = PipelineItemResult<O>[];

export interface PipelineStageArtifacts {
  stageName: string;
  stageIndex: number;
  status: string;
  value?: unknown;
  error?: SerializedError;
  childAgentIds: string[];
}

export interface PipelineSummary {
  pipelineId: string;
  label?: string | undefined;
  strategy: PipelineStrategy;
  status: "succeeded" | "failed" | "cancelled";
  itemCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  skippedCount: number;
  stageNames: string[];
  durationMs: number;
  artifactPath: string;
}
