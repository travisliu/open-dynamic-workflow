import type { ParsedWorkflow, WorkflowMeta, WorkflowInvocationSummary } from "../types/workflow.js";
import type { ArtifactStore } from "../types/artifacts.js";
import type { ResolvedConfig, CliRunOptions } from "../types/config.js";
import type { AgentResult } from "../types/agent.js";
import type { Scheduler } from "../types/scheduler.js";
import type { AgentExecutor } from "../agents/execution-types.js";
import type { RuntimeEventSink } from "../orchestration/scheduler.js";
import type { PipelineSummary } from "../pipeline/types.js";
import type { RuntimeCallCache } from "../artifacts/call-cache.js";
import type { SharedAgentRegistry } from "../shared-agents/registry.js";
import type { WorkflowRegistry } from "./registry.js";
import type { WorkflowInvocationManager, WorkflowInvocationContext } from "./invocation-types.js";
import type { JsonObject } from "../types/common.js";
import type { ToolRegistry, ToolExecutionResult } from "../types/tool.js";
import type { ToolExecutor } from "../tools/executor-types.js";
import type { LoopSummary } from "../loop/types.js";
import type { RunLimitTracker } from "./run-limits.js";

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
  severity?: "error" | "warning" | undefined;
}


export interface RuntimeState {
  artifactStore?: ArtifactStore | undefined;
  workflowRegistry?: WorkflowRegistry | undefined;
  invocationManager?: WorkflowInvocationManager | undefined;
  currentInvocation?: WorkflowInvocationContext | undefined;
  runId: string;
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedConfig;
  cli: CliRunOptions;
  args: JsonObject;
  cwd: string;
  artifactsDir: string;
  currentPhase?: string | undefined;
  startedAt: string;
  agentResults: AgentResult[];
  toolResults: ToolExecutionResult[];
  scheduler: Scheduler;
  agentExecutor: AgentExecutor;
  eventSink: RuntimeEventSink;
  abortController: AbortController;
  agentCounter: number;
  callSequence?: number | undefined;
  callCache?: RuntimeCallCache | undefined;
  pipelineCounter?: number | undefined;
  pipelineSummaries?: PipelineSummary[] | undefined;
  workflowSummaries?: WorkflowInvocationSummary[] | undefined;
  idGenerator?: IdGenerator | undefined;
  failFast?: boolean | undefined;
  sharedAgentRegistry?: SharedAgentRegistry | undefined;
  schedulerConcurrency: number;
  toolRegistry?: ToolRegistry | undefined;
  toolExecutor?: ToolExecutor | undefined;
  toolCallIds?: Set<string> | undefined;
  toolCounter?: number | undefined;
  loopCounter?: number | undefined;
  loopSummaries?: LoopSummary[] | undefined;
  runLimitTracker?: RunLimitTracker | undefined;
}

export interface IdGenerator {
  nextId(prefix: string): string;
}
