import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { AgentResult, AgentUsage } from "../types/agent.js";
import type { BudgetConfig } from "../types/config.js";
import type { WorkflowBudgetSummary } from "../types/workflow.js";

export type BudgetExceededBy = NonNullable<WorkflowBudgetSummary["exceededBy"]>;

export class BudgetTracker {
  private readonly limits: BudgetConfig;
  private readonly startedAtMs: number;
  private agentCalls = 0;
  private observedTokens = 0;
  private exceededBy?: BudgetExceededBy;
  private message?: string;

  constructor(input: { limits?: BudgetConfig | undefined; startedAtMs: number }) {
    this.limits = compactLimits(input.limits);
    this.startedAtMs = input.startedAtMs;
  }

  hasLimits(): boolean {
    return Object.keys(this.limits).length > 0;
  }

  beforeAgentSchedule(agentId: string, nowMs: number): void {
    this.throwIfAlreadyExceeded();
    this.checkRunMs(nowMs);
    if (this.limits.maxAgentCalls !== undefined && this.agentCalls >= this.limits.maxAgentCalls) {
      throw this.markExceeded(
        "maxAgentCalls",
        `Budget exceeded before scheduling agent '${agentId}': maxAgentCalls ${this.limits.maxAgentCalls} has been reached.`
      );
    }
    this.agentCalls += 1;
  }

  afterAgentResult(result: AgentResult, nowMs: number): void {
    if (!result.cache?.hit) {
      this.observedTokens += observedTokensFromUsage(result.usage);
    }
    this.checkRunMs(nowMs);
    if (
      this.limits.maxObservedTokens !== undefined &&
      this.observedTokens > this.limits.maxObservedTokens
    ) {
      throw this.markExceeded(
        "maxObservedTokens",
        `Budget exceeded after agent '${result.id}': observed tokens ${this.observedTokens} exceeded maxObservedTokens ${this.limits.maxObservedTokens}.`
      );
    }
  }

  markRunTimeExceeded(): OpenDynamicWorkflowError {
    return this.markExceeded(
      "maxRunMs",
      `Budget exceeded: maxRunMs ${this.limits.maxRunMs} elapsed.`
    );
  }

  summary(): WorkflowBudgetSummary | undefined {
    if (!this.hasLimits()) return undefined;
    const summary: WorkflowBudgetSummary = {
      limits: { ...this.limits },
      agentCalls: this.agentCalls,
      observedTokens: this.observedTokens,
      exceeded: this.exceededBy !== undefined
    };
    if (this.exceededBy !== undefined) {
      summary.exceededBy = this.exceededBy;
    }
    if (this.message !== undefined) {
      summary.message = this.message;
    }
    return summary;
  }

  private checkRunMs(nowMs: number): void {
    if (this.limits.maxRunMs === undefined) return;
    if (nowMs - this.startedAtMs > this.limits.maxRunMs) {
      throw this.markRunTimeExceeded();
    }
  }

  private throwIfAlreadyExceeded(): void {
    if (this.exceededBy !== undefined) {
      throw new OpenDynamicWorkflowError(ErrorCode.BUDGET_EXCEEDED, this.message || "Workflow budget exceeded.");
    }
  }

  private markExceeded(exceededBy: BudgetExceededBy, message: string): OpenDynamicWorkflowError {
    if (this.exceededBy === undefined) {
      this.exceededBy = exceededBy;
      this.message = message;
    }
    return new OpenDynamicWorkflowError(ErrorCode.BUDGET_EXCEEDED, this.message || message);
  }
}

export function observedTokensFromUsage(usage: AgentUsage | undefined): number {
  if (!usage) return 0;
  const total = finiteNumber(usage.totalTokens);
  if (total !== undefined) return total;
  return (finiteNumber(usage.inputTokens) ?? 0) + (finiteNumber(usage.outputTokens) ?? 0);
}

function compactLimits(limits: BudgetConfig | undefined): BudgetConfig {
  const compact: BudgetConfig = {};
  if (isPositiveInteger(limits?.maxAgentCalls)) compact.maxAgentCalls = limits!.maxAgentCalls;
  if (isPositiveInteger(limits?.maxObservedTokens)) compact.maxObservedTokens = limits!.maxObservedTokens;
  if (isPositiveInteger(limits?.maxRunMs)) compact.maxRunMs = limits!.maxRunMs;
  return compact;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
