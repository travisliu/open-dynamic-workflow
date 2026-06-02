import type { ParsedWorkflow, WorkflowMeta } from "../types/workflow.js";
import type { ResolvedConfig } from "../types/config.js";
import type { AgentResult } from "../types/agent.js";
import type { Scheduler } from "../types/scheduler.js";
import type { AgentExecutor } from "../agents/execution-types.js";
import type { RuntimeEventSink } from "../orchestration/scheduler.js";

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
  runId: string;
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedConfig;
  args: Record<string, unknown>;
  cwd: string;
  artifactsDir: string;
  currentPhase?: string;
  startedAt: string;
  agentResults: AgentResult[];
  scheduler: Scheduler;
  agentExecutor: AgentExecutor;
  eventSink: RuntimeEventSink;
  abortController: AbortController;
  agentCounter: number;
  idGenerator?: IdGenerator | undefined;
  failFast?: boolean | undefined;
}

export interface IdGenerator {
  nextId(prefix: string): string;
}
