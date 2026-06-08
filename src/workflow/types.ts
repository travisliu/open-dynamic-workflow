import type { ParsedWorkflow, WorkflowMeta } from "../types/workflow.js";
import type { ArtifactStore } from "../types/artifacts.js";
import type { ResolvedConfig, CliRunOptions } from "../types/config.js";
import type { AgentResult } from "../types/agent.js";
import type { Scheduler } from "../types/scheduler.js";
import type { AgentExecutor } from "../agents/execution-types.js";
import type { RuntimeEventSink } from "../orchestration/scheduler.js";
import type { PipelineSummary } from "../pipeline/types.js";
import type { RuntimeCallCache } from "../artifacts/call-cache.js";

export type { ParsedWorkflow, WorkflowMeta };

export interface LoadedWorkflow {
  sourcePath: string;
  sourceText: string;
}

export interface WorkflowValidationIssue {
  code: string;
  message: string;
  line?: number;
  column?: number;
}


export interface RuntimeState {
  artifactStore?: ArtifactStore | undefined;
  runId: string;
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedConfig;
  cli: CliRunOptions;
  args: Record<string, unknown>;
  cwd: string;
  artifactsDir: string;
  currentPhase?: string | undefined;
  startedAt: string;
  agentResults: AgentResult[];
  scheduler: Scheduler;
  agentExecutor: AgentExecutor;
  eventSink: RuntimeEventSink;
  abortController: AbortController;
  agentCounter: number;
  pipelineCounter?: number | undefined;
  pipelineSummaries?: PipelineSummary[] | undefined;
  idGenerator?: IdGenerator | undefined;
  failFast?: boolean | undefined;
  callCache?: RuntimeCallCache | undefined;
}

export interface IdGenerator {
  nextId(prefix: string): string;
}
