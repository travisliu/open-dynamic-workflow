import type { ReporterStartInput } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";
import type {
  PrettyRunView,
  PrettyExecutionNode,
  PrettyStatus,
  StatusCounts,
  WorkflowNode,
  PhaseNode,
  AgentNode,
  ToolNode,
  PipelineNode,
  PrettyFailureRecord,
  PrettyHeaderView,
} from "./pretty-view.js";

export class PrettyViewBuilder {
  private startInput?: ReporterStartInput;
  private events: EventEnvelope[] = [];
  
  // Tracking state for tree construction
  private nodesById = new Map<string, PrettyExecutionNode>();
  private rootNodes: PrettyExecutionNode[] = [];
  
  // workflowInvocationId -> activePhaseNodeId
  private activePhaseMap = new Map<string, string>();

  constructor() {}

  addStart(input: ReporterStartInput) {
    this.startInput = input;
  }

  addEvent(event: EventEnvelope): string | undefined {
    this.events.push(event);
    return this.processEvent(event);
  }

  getNode(id: string): PrettyExecutionNode | undefined {
    return this.nodesById.get(id);
  }

  getNodeDepth(id: string): number | null {
    return this.findNodeDepth(this.rootNodes, id, 0);
  }

  getWorkflowLogDepth(workflowId: string): number {
    const activePhaseId = this.activePhaseMap.get(workflowId);
    if (activePhaseId) {
      const phaseDepth = this.getNodeDepth(activePhaseId);
      if (phaseDepth !== null) {
        return phaseDepth + 1;
      }
    }
    const workflowDepth = this.getNodeDepth(workflowId);
    if (workflowDepth !== null) {
      return workflowDepth + 1;
    }
    return 0;
  }

  private findNodeDepth(nodes: PrettyExecutionNode[], targetId: string, currentDepth: number): number | null {
    for (const node of nodes) {
      if (node.id === targetId) {
        return currentDepth;
      }
      if (node.kind === "phase") {
        const depth = this.findNodeDepth(node.children, targetId, currentDepth + 1);
        if (depth !== null) return depth;
      } else if (node.kind === "workflow") {
        const nextDepth = node.isRoot ? currentDepth : currentDepth + 1;
        const depth = this.findNodeDepth(node.children, targetId, nextDepth);
        if (depth !== null) return depth;
      } else if (node.kind === "loop") {
        const depth = this.findNodeDepth(node.children ?? [], targetId, currentDepth + 1);
        if (depth !== null) return depth;
      }
    }
    return null;
  }

  build(result: WorkflowRunResult): PrettyRunView {
    const summary = this.buildSummary(result);
    
    const header: PrettyHeaderView = {
      name: this.startInput?.meta.name ?? "Unknown Run",
      runId: this.startInput?.runId ?? result.runId,
    };

    const workflowFile = this.startInput?.workflow?.file ?? result.workflow?.file;
    if (workflowFile) {
      header.workflowFile = workflowFile;
    }

    return {
      header,
      execution: this.rootNodes,
      summary,
      artifacts: {
        rootDir: result.artifactsDir ?? "unknown",
        reportPath: result.reportPath,
        eventsPath: result.eventsPath,
        failedSubpaths: [], 
      },
      failureRecords: this.collectFailureRecords(),
    };
  }

  private processEvent(event: EventEnvelope): string | undefined {
    const payload = event.payload as any;
    const type = event.type;

    switch (type) {
      case "workflow.invocation.started": {
        const node: WorkflowNode = {
          id: payload.workflowInvocationId,
          kind: "workflow",
          name: payload.workflowName,
          status: "running",
          children: [],
          isRoot: !payload.parentWorkflowInvocationId,
        };
        this.nodesById.set(node.id, node);
        
        if (payload.parentWorkflowInvocationId) {
          this.attachToParent(payload.parentWorkflowInvocationId, node);
        } else {
          this.rootNodes.push(node);
        }
        return node.id;
      }

      case "workflow.invocation.completed":
      case "workflow.invocation.failed":
      case "workflow.invocation.timed_out":
      case "workflow.invocation.cancelled": {
        const node = this.nodesById.get(payload.workflowInvocationId);
        if (node) {
          const statusSource = payload.status || type.split(".").pop();
          if (statusSource) {
            node.status = this.mapStatus(statusSource);
          }
          node.durationMs = payload.durationMs;
          if (payload.artifactPath) (node as any).artifactPath = payload.artifactPath;
        }
        return payload.workflowInvocationId;
      }

      case "phase.started": {
        let workflowId = payload.workflowInvocationId;
        if (!workflowId) {
          workflowId = this.getActiveWorkflowId();
        }

        const phaseId = workflowId ? `${workflowId}-phase-${payload.name}` : `phase-${payload.name}`;
        const node: PhaseNode = {
          id: phaseId,
          kind: "phase",
          name: payload.name,
          status: "running",
          children: [],
        };
        this.nodesById.set(node.id, node);
        if (workflowId) {
          this.activePhaseMap.set(workflowId, node.id);
          const workflow = this.nodesById.get(workflowId) as WorkflowNode;
          if (workflow) {
            workflow.children.push(node);
          } else {
            this.rootNodes.push(node);
          }
        } else {
          this.rootNodes.push(node);
        }
        return node.id;
      }

      case "agent.started": {
        let workflowId = payload.workflowInvocationId;
        if (!workflowId) {
          workflowId = this.getActiveWorkflowId();
        }

        const node: AgentNode = {
          id: payload.agentRunId || payload.agentId,
          kind: "agent",
          label: payload.label ?? payload.agentId,
          status: "running",
          provider: payload.provider,
          model: payload.model,
          permissions: payload.permissions,
        };
        this.nodesById.set(node.id, node);
        this.attachToParent(workflowId, node);
        return node.id;
      }

      case "agent.completed":
      case "agent.failed":
      case "agent.timed_out":
      case "agent.cancelled": {
        const node = this.nodesById.get(payload.agentRunId || payload.agentId) as AgentNode;
        if (node) {
          const statusPart = type.split(".")[1];
          if (statusPart) {
            node.status = this.mapStatus(statusPart);
          }
          node.durationMs = payload.durationMs;
          if (payload.artifacts) (node as any).artifacts = payload.artifacts;
          if (payload.error) (node as any).error = payload.error;
        }
        return payload.agentRunId || payload.agentId;
      }

      case "tool.started": {
        const workflowId = payload.workflowInvocationId;
        const node: ToolNode = {
          id: payload.toolInvocationId || payload.toolCallId,
          kind: "tool",
          label: payload.label ?? payload.definition,
          status: "running",
        };
        if (payload.artifactPath) (node as any).artifactPath = payload.artifactPath;
        this.nodesById.set(node.id, node);
        if (payload.loopId) {
          const loop = this.nodesById.get(payload.loopId);
          if (loop?.kind === "loop") {
            loop.children ??= [];
            loop.children.push(node);
          } else {
            this.attachToParent(workflowId, node);
          }
        } else {
          this.attachToParent(workflowId, node);
        }
        return node.id;
      }

      case "tool.completed":
      case "tool.failed":
      case "tool.timed_out":
      case "tool.cancelled": {
        const node = this.nodesById.get(payload.toolInvocationId || payload.toolCallId);
        if (node) {
          const statusPart = type.split(".")[1];
          if (statusPart) {
            node.status = this.mapStatus(statusPart);
          }
          node.durationMs = payload.executionDurationMs;
          if (payload.error) (node as any).error = payload.error;
        }
        return payload.toolInvocationId || payload.toolCallId;
      }

      case "tool.cache_hit": {
        const id = payload.toolCallId;
        let node = this.nodesById.get(id) as ToolNode;
        if (!node) {
          node = {
            id,
            kind: "tool",
            label: payload.label ?? payload.definition,
            status: "succeeded",
            cached: true,
          };
          if (payload.artifactPath) node.artifactPath = payload.artifactPath;
          this.nodesById.set(id, node);

          const workflowId = payload.workflowInvocationId ?? this.getActiveWorkflowId();
          if (payload.loopId) {
            const loop = this.nodesById.get(payload.loopId);
            if (loop?.kind === "loop") {
              loop.children ??= [];
              loop.children.push(node);
            } else {
              this.attachToParent(workflowId, node);
            }
          } else {
            this.attachToParent(workflowId, node);
          }
        } else {
          node.status = "succeeded";
          node.cached = true;
          if (payload.artifactPath) node.artifactPath = payload.artifactPath;
        }
        return id;
      }

      case "pipeline.started": {
        const workflowId = payload.workflowInvocationId;
        const node: PipelineNode = {
          id: payload.pipelineId,
          kind: "pipeline",
          label: payload.label,
          status: "running",
        };
        if (payload.artifactPath) (node as any).artifactPath = payload.artifactPath;
        this.nodesById.set(node.id, node);
        this.attachToParent(workflowId, node);
        return node.id;
      }

      case "pipeline.completed":
      case "pipeline.failed":
      case "pipeline.cancelled": {
        const node = this.nodesById.get(payload.pipelineId);
        if (node) {
          const statusPart = type.split(".").pop();
          if (statusPart) {
            node.status = this.mapStatus(statusPart);
          }
          node.durationMs = payload.durationMs;
          if (payload.artifactPath) (node as any).artifactPath = payload.artifactPath;
        }
        return payload.pipelineId;
      }

      case "loop.started": {
        const workflowId = payload.workflowInvocationId || this.getActiveWorkflowId();
        const node: any = {
          id: payload.loopId,
          kind: "loop",
          label: payload.label,
          status: "running",
          maxRounds: payload.maxRounds,
          roundCount: 0,
          children: [],
        };
        if (payload.artifactPath) node.artifactPath = payload.artifactPath;
        this.nodesById.set(node.id, node);
        this.attachToParent(workflowId, node);
        return node.id;
      }

      case "loop.round.completed":
      case "loop.round.failed":
      case "loop.round.cancelled":
      case "loop.round.timed_out": {
        const node = this.nodesById.get(payload.loopId) as any;
        if (node) {
          node.roundCount = Math.max(node.roundCount ?? 0, payload.roundIndex);
        }
        return payload.loopId;
      }

      case "loop.completed":
      case "loop.failed":
      case "loop.cancelled":
      case "loop.timed_out":
      case "loop.max_rounds": {
        const node = this.nodesById.get(payload.loopId) as any;
        if (node) {
          const statusPart = type.split(".").pop();
          if (statusPart) {
            if (statusPart === "completed") {
              node.status = "succeeded";
            } else if (statusPart === "max_rounds") {
              node.status = "failed";
            } else {
              node.status = this.mapStatus(statusPart);
            }
          }
          node.durationMs = payload.durationMs;
          node.roundCount = payload.roundsCompleted ?? payload.roundCount;
          node.maxRounds = payload.maxRounds;
          node.reason = payload.reason;
          if (payload.artifactPath) node.artifactPath = payload.artifactPath;
        }
        return payload.loopId;
      }
    }
    return undefined;
  }

  private getActiveWorkflowId(): string | undefined {
    const workflows = Array.from(this.nodesById.values())
      .filter(n => n.kind === "workflow" && n.status === "running") as WorkflowNode[];
    if (workflows.length > 0) {
      return workflows[workflows.length - 1]?.id;
    }
    return undefined;
  }

  private attachToParent(workflowId: string | undefined, node: PrettyExecutionNode) {
    const workflow = workflowId ? this.nodesById.get(workflowId) as WorkflowNode : undefined;
    if (workflow) {
      const activePhaseId = this.activePhaseMap.get(workflow.id);
      if (activePhaseId) {
        const phase = this.nodesById.get(activePhaseId) as PhaseNode;
        if (phase && phase.children) {
          phase.children.push(node);
          return;
        }
      }
      if (workflow.children) {
        workflow.children.push(node);
      } else {
        this.rootNodes.push(node);
      }
    } else {
      this.rootNodes.push(node);
    }
  }

  private mapStatus(s: string): PrettyStatus {
    if (s === "completed") return "succeeded";
    return s as PrettyStatus;
  }

  private buildSummary(result: WorkflowRunResult): any {
    const workflowCounts: StatusCounts = { succeeded: 0, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 0 };
    const agentCounts: StatusCounts = { succeeded: 0, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 0 };
    const loopCounts: StatusCounts = { succeeded: 0, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 0 };

    for (const node of this.nodesById.values()) {
      if (node.kind === "workflow") {
        workflowCounts.total++;
        if (node.status === "succeeded") workflowCounts.succeeded++;
        else if (node.status === "failed") workflowCounts.failed++;
        else if (node.status === "timed_out") workflowCounts.timed_out++;
        else if (node.status === "cancelled") workflowCounts.cancelled++;
        else if (node.status === "skipped") workflowCounts.skipped++;
      } else if (node.kind === "agent") {
        agentCounts.total++;
        if (node.status === "succeeded") agentCounts.succeeded++;
        else if (node.status === "failed") agentCounts.failed++;
        else if (node.status === "timed_out") agentCounts.timed_out++;
        else if (node.status === "cancelled") agentCounts.cancelled++;
        else if (node.status === "skipped") agentCounts.skipped++;
      } else if (node.kind === "loop") {
        loopCounts.total++;
        if (node.status === "succeeded") loopCounts.succeeded++;
        else if (node.status === "failed") loopCounts.failed++;
        else if (node.status === "timed_out") loopCounts.timed_out++;
        else if (node.status === "cancelled") loopCounts.cancelled++;
        else if (node.status === "skipped") loopCounts.skipped++;
      }
    }

    return {
      status: result.status,
      durationMs: result.durationMs,
      workflowCounts,
      agentCounts,
      loopCounts,
    };
  }

  private collectFailureRecords(): PrettyFailureRecord[] {
    const records: PrettyFailureRecord[] = [];
    for (const node of this.nodesById.values()) {
      if (node.status === "failed" || node.status === "timed_out" || node.status === "cancelled") {
        const record: PrettyFailureRecord = {
          kind: node.kind as any,
          status: node.status as any,
        };

        if (node.kind === "agent") {
          const aNode = node as any;
          if (aNode.artifacts) {
            record.artifactSubpath = aNode.artifacts.dir;
            
            // Determine failureKind
            let failureKind: NonNullable<PrettyFailureRecord["failureKind"]> = "unknown";
            if (node.status === "timed_out") {
              failureKind = "timeout";
            } else if (node.status === "cancelled") {
              failureKind = "cancelled";
            }

            if (aNode.error) {
              const mapped = this.mapErrorToFailureKind(aNode.error);
              if (mapped && mapped !== "unknown") {
                failureKind = mapped;
              }
            }
            
            record.failureKind = failureKind;

            if (failureKind === "schema" && aNode.artifacts.validationErrorPath) {
              record.specificFailureSubpath = aNode.artifacts.validationErrorPath;
            } else if ((failureKind === "provider" || failureKind === "process" || failureKind === "timeout") && aNode.artifacts.stderrPath) {
              record.specificFailureSubpath = aNode.artifacts.stderrPath;
            }
          }
        } else if (node.kind === "workflow" || node.kind === "tool" || node.kind === "pipeline" || node.kind === "loop") {
          record.artifactSubpath = (node as any).artifactPath;
        }

        records.push(record);
      }
    }
    return records;
  }

  private mapErrorToFailureKind(error?: any): PrettyFailureRecord["failureKind"] {
    if (!error) return "unknown";
    if (error.code === "VALIDATION_ERROR" || error.type === "ValidationError") return "schema";
    if (error.code === "PROVIDER_ERROR") return "provider";
    if (error.code === "PROCESS_ERROR") return "process";
    if (error.code === "TIMEOUT" || error.type === "TimeoutError") return "timeout";
    return "unknown";
  }
}
