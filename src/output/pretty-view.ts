/**
 * Reporter-local data model for the pretty reporter.
 * This is used between aggregation (pretty-view-builder) and rendering (pretty-renderer).
 */

export type PrettyStatus = "succeeded" | "failed" | "timed_out" | "cancelled" | "running" | "queued" | "skipped";

export interface StatusCounts {
  succeeded: number;
  failed: number;
  timed_out: number;
  cancelled: number;
  skipped: number;
  total: number;
}

export interface PrettyHeaderView {
  name: string;
  workflowFile?: string;
  runId?: string;
}

export interface PrettySummaryView {
  status: PrettyStatus;
  durationMs: number;
  workflowCounts: StatusCounts;
  agentCounts: StatusCounts;
  loopCounts: StatusCounts;
}

/**
 * Shared contract for artifact reporting.
 * Developer B owns the failedSubpaths resolution.
 */
export interface PrettyArtifactsView {
  rootDir: string;
  reportPath?: string;
  eventsPath?: string;
  failedSubpaths: string[];
}

/**
 * Shared failure record contract passed to Developer B's resolver.
 */
export interface PrettyFailureRecord {
  kind: "agent" | "workflow" | "tool" | "pipeline" | "loop";
  status: "failed" | "timed_out" | "cancelled";
  artifactSubpath?: string;
  specificFailureSubpath?: string;
  failureKind?: "schema" | "provider" | "process" | "timeout" | "cancelled" | "unknown";
}

export interface BaseNode {
  id: string;
  status: PrettyStatus;
  durationMs?: number;
}

export interface PhaseNode extends BaseNode {
  kind: "phase";
  name: string;
  children: PrettyExecutionNode[];
}

export interface WorkflowNode extends BaseNode {
  kind: "workflow";
  name: string;
  isRoot?: boolean;
  children: PrettyExecutionNode[];
}

export interface AgentNode extends BaseNode {
  kind: "agent";
  label: string;
  provider: string;
  model?: string;
  permissions?: {
    mode: string;
  };
}

export interface ToolNode extends BaseNode {
  kind: "tool";
  label: string;
  cached?: boolean;
  artifactPath?: string;
}

export interface PipelineNode extends BaseNode {
  kind: "pipeline";
  label?: string;
}

export interface LoopNode extends BaseNode {
  kind: "loop";
  label?: string;
  children?: PrettyExecutionNode[];
  roundCount?: number;
  maxRounds?: number;
  accepted?: boolean;
  reason?: string;
  artifactPath?: string;
}

export type PrettyExecutionNode =
  | PhaseNode
  | WorkflowNode
  | AgentNode
  | ToolNode
  | PipelineNode
  | LoopNode;

export interface PrettyRunView {
  header: PrettyHeaderView;
  execution: PrettyExecutionNode[];
  summary: PrettySummaryView;
  artifacts: PrettyArtifactsView;
  failureRecords: PrettyFailureRecord[];
}
