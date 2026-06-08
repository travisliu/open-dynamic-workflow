import type { AgentResult, AgentRuntimeFunction, AgentUsage } from "./agent.js";
import type { JsonObject, WorkflowStatus } from "./common.js";
import type { SerializedError } from "./errors.js";
import type { PipelineStage, PipelineOptions, PipelineResult, PipelineSummary } from "../pipeline/types.js";

export interface WorkflowMeta {
  name: string;
  description: string;
  phases?: string[];
  version?: string;
  tags?: string[];
}

export interface ParsedWorkflow {
  meta: WorkflowMeta;
  body: string;
  sourcePath: string;
  sourceText: string;
  sourceHash: string;
}

export type ParallelTasks<T> = Array<() => Promise<T>> | Record<string, () => Promise<T>>;

export type ParallelResult<TTasks> = TTasks extends Array<() => Promise<infer TValue>>
  ? TValue[]
  : TTasks extends Record<string, () => Promise<infer TValue>>
    ? Record<keyof TTasks, TValue>
    : never;

export interface WorkflowRuntimeContext {
  args: JsonObject;
  cwd: string;
  runId: string;
  artifactsDir: string;
  agent: AgentRuntimeFunction;
  parallel<TTasks extends ParallelTasks<unknown>>(tasks: TTasks): Promise<ParallelResult<TTasks>>;
  phase(name: string): void;
  log(message: string, data?: unknown): void;
  pipeline<I, O>(
    items: I[],
    stages: PipelineStage<any, any>[],
    options?: PipelineOptions
  ): Promise<PipelineResult<O>>;
}

export interface WorkflowRunResult {
  schemaVersion: "openflow.report.v1";
  runId: string;
  status: WorkflowStatus;
  meta: WorkflowMeta;
  result?: unknown;
  agents: AgentResult[];
  pipelines?: PipelineSummary[] | undefined;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  artifactsDir: string;
  reportPath: string;
  eventsPath: string;
  usageSummary?: AgentUsage & { agentCount: number } | undefined;
  error?: SerializedError;
}
