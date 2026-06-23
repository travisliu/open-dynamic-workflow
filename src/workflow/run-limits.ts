import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { WorkflowRunLimitSummary } from "../types/workflow.js";

export class RunLimitTracker {
  private readonly maxAgentCalls?: number | undefined;
  private agentCalls = 0;
  private exceeded = false;
  private message?: string | undefined;

  constructor(input: { maxAgentCalls?: number | undefined }) {
    this.maxAgentCalls = isPositiveInteger(input.maxAgentCalls) ? input.maxAgentCalls : undefined;
  }

  beforeAgentSchedule(agentId: string): void {
    if (this.maxAgentCalls === undefined) return;
    if (this.agentCalls >= this.maxAgentCalls) {
      throw this.markExceeded(
        `Run limit exceeded before scheduling agent '${agentId}': maxAgentCalls ${this.maxAgentCalls} has been reached.`
      );
    }
    this.agentCalls += 1;
  }

  summary(): WorkflowRunLimitSummary | undefined {
    if (this.maxAgentCalls === undefined) return undefined;
    const summary: WorkflowRunLimitSummary = {
      limits: { maxAgentCalls: this.maxAgentCalls },
      agentCalls: this.agentCalls,
      exceeded: this.exceeded
    };
    if (this.exceeded) {
      summary.exceededBy = "maxAgentCalls";
    }
    if (this.message !== undefined) {
      summary.message = this.message;
    }
    return summary;
  }

  private markExceeded(message: string): OpenDynamicWorkflowError {
    if (!this.exceeded) {
      this.exceeded = true;
      this.message = message;
    }
    return new OpenDynamicWorkflowError(ErrorCode.RUN_LIMIT_EXCEEDED, this.message || message);
  }
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}
