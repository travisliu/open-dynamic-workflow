import type { ParsedWorkflow, WorkflowMeta } from "../types/workflow.js";
import type { ArtifactStore } from "../types/artifacts.js";
import type { ResolvedConfig, CliRunOptions } from "../types/config.js";
import type { AgentResult } from "../types/agent.js";
import type { Scheduler } from "../types/scheduler.js";
import type { AgentExecutor } from "../agents/execution-types.js";
import type { RuntimeEventSink } from "../orchestration/scheduler.js";
import type { PipelineSummary } from "../pipeline/types.js";
import type { RuntimeCallCache } from "../artifacts/call-cache.js";
import type { SharedAgentRegistry } from "../shared-agents/registry.js";

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
  callSequence?: number | undefined;
  callCache?: RuntimeCallCache | undefined;
  pipelineCounter?: number | undefined;
  pipelineSummaries?: PipelineSummary[] | undefined;
  idGenerator?: IdGenerator | undefined;
  failFast?: boolean | undefined;
  sharedAgentRegistry?: SharedAgentRegistry | undefined;
}

export interface IdGenerator {
  nextId(prefix: string): string;
}
