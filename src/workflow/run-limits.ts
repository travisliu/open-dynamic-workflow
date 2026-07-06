import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { WorkflowRunLimitSummary } from "../types/workflow.js";

/**
 * Tracks run limits for the workflow, specifically counting the total number of
 * live execution attempts against the configured `maxAgentCalls` limit.
 *
 * Each scheduled attempt (including retries for the same logical agent call)
 * increments the usage count individually.
 */
export class RunLimitTracker {
  private readonly maxAgentCalls?: number | undefined;
  // Tracks the total number of started live attempts (both initial calls and retries)
  private agentCalls = 0;
  private exceeded = false;
  private message?: string | undefined;

  constructor(input: { maxAgentCalls?: number | undefined }) {
    this.maxAgentCalls = isPositiveInteger(input.maxAgentCalls) ? input.maxAgentCalls : undefined;
  }

  /**
   * Called before scheduling a live execution attempt for an agent.
   *
   * Every live attempt (including retry attempts for the same logical agentId)
   * must pass through this check before being executed by the provider.
   * If the limit is reached, it terminally throws RUN_LIMIT_EXCEEDED.
   */
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
