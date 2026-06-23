import type { AgentCallInput, AgentResult } from "./agent.js";
import type { JsonObject, JsonValue, WorkflowStatus } from "./common.js";
import type { SerializedError } from "./errors.js";
import type { PipelineStage, PipelineOptions, PipelineResult, PipelineSummary } from "../pipeline/types.js";
import type { ToolSummary, ToolCallInput, ToolSettledResult } from "./tool.js";
import type { LoopInput, LoopSettledResult, LoopSummary } from "../loop/types.js";

export type { PipelineStage, PipelineOptions, PipelineResult, PipelineSummary };

export interface WorkflowMeta {
  name: string;
  description: string;
  phases?: string[];
  version?: string;
  tags?: string[];
  inputSchema?: JsonObject;
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

export type WorkflowFailureMode = "throw" | "settled";

export interface WorkflowCallInput {
  name: string;
  args?: JsonObject;
  failureMode?: WorkflowFailureMode;
  timeoutMs?: number;
  concurrency?: number;
  metadata?: JsonObject;
}

export type WorkflowThrowCallInput = Omit<WorkflowCallInput, "failureMode"> & {
  failureMode?: "throw";
};

export type WorkflowSettledCallInput = Omit<WorkflowCallInput, "failureMode"> & {
  failureMode: "settled";
};

export type WorkflowSettledStatus = "succeeded" | "failed" | "timed_out" | "cancelled";

export type WorkflowSettledResult<T = unknown> =
  | {
      status: "succeeded";
      workflowName: string;
      workflowInvocationId: string;
      output: T;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      artifactPath?: string | undefined;
    }
  | {
      status: Exclude<WorkflowSettledStatus, "succeeded">;
      workflowName: string;
      workflowInvocationId: string;
      output: null;
      error: SerializedError;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      artifactPath?: string | undefined;
    };

export interface WorkflowInvocationSummary {
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  workflowName: string;
  status: WorkflowSettledStatus;
  depth: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  artifactPath?: string | undefined;
  error?: SerializedError | undefined;
}

export interface WorkflowRunLimitSummary {
  limits: {
    maxAgentCalls?: number | undefined;
  };
  agentCalls: number;
  exceeded: boolean;
  exceededBy?: "maxAgentCalls" | undefined;
  message?: string | undefined;
}

export interface WorkflowRuntimeContext {
  args: JsonObject;
  cwd: string;
  runId: string;
  workflowInvocationId?: string | undefined;
  artifactsDir: string;
  agent(input: AgentCallInput): Promise<AgentResult>;
  parallel<TTasks extends ParallelTasks<unknown>>(tasks: TTasks): Promise<ParallelResult<TTasks>>;
  phase(name: string): void;
  log(message: string, data?: unknown): void;
  pipeline<I, O>(
    items: I[],
    stages: PipelineStage<any, any>[],
    options?: PipelineOptions
  ): Promise<PipelineResult<O>>;
  tool<T = unknown>(input: ToolCallInput & { failureMode?: "throw" }): Promise<T>;
  tool<T = unknown>(input: ToolCallInput & { failureMode: "settled" }): Promise<ToolSettledResult<T>>;
  tool<T = unknown>(input: ToolCallInput): Promise<T | ToolSettledResult<T>>;
  workflow<T = JsonValue>(input: WorkflowThrowCallInput): Promise<T>;
  workflow<T = JsonValue>(input: WorkflowSettledCallInput): Promise<WorkflowSettledResult<T>>;
  workflow<T = JsonValue>(input: WorkflowCallInput): Promise<T | WorkflowSettledResult<T>>;
  loop<TState>(
    input: LoopInput<TState> & { options: { failureMode?: "throw" } }
  ): Promise<TState>;
  loop<TState>(
    input: LoopInput<TState> & { options: { failureMode: "settled" } }
  ): Promise<LoopSettledResult<TState>>;
  loop<TState>(
    input: LoopInput<TState>
  ): Promise<TState | LoopSettledResult<TState>>;
}

export interface WorkflowIdentity {
  name: string;
  file: string;
  requestedTarget: string;
  targetKind: "workflow-name" | "workflow-file";
}

export interface ResolvedWorkflowIdentity {
  name: string;
  file: string;
  requestedTarget: string;
  targetKind: "workflow-name" | "workflow-file";
  workflowFile: string;
  workflowFileRelative: string;
  discoverySource: string;
}

export interface WorkflowRunResult {
  schemaVersion: "open-dynamic-workflow.report.v1";
  runId: string;
  status: WorkflowStatus;
  meta: WorkflowMeta;
  workflow?: WorkflowIdentity;
  result?: unknown | undefined;
  agents: AgentResult[];
  pipelines?: PipelineSummary[] | undefined;
  workflows?: WorkflowInvocationSummary[] | undefined;
  tools?: ToolSummary[] | undefined;
  loops?: LoopSummary[] | undefined;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  artifactsDir: string;
  reportPath: string;
  eventsPath: string;
  limitSummary?: WorkflowRunLimitSummary | undefined;
  error?: SerializedError | undefined;
}
