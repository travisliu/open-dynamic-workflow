import type { AgentUsage, ProviderFailure, ProviderParsedResult } from "../types/agent.js";
import type { SerializedError } from "../types/errors.js";

export function threadIdFromProviderResult(result: ProviderParsedResult): string | undefined {
  return result.providerThreadId ?? result.providerSessionId;
}

export function normalizeProviderFailure(failure: ProviderFailure): SerializedError {
  const serialized: SerializedError = {
    name: failure.name || "ProviderFailure",
    message: failure.message || "Provider reported a terminal failure.",
    code: failure.code || "PROVIDER_PROCESS_FAILED"
  };
  if (failure.stack !== undefined) {
    serialized.stack = failure.stack;
  }
  const cause = failure.cause ?? failure.details;
  if (cause !== undefined) {
    serialized.cause = cause;
  }
  return serialized;
}

export interface UsageSummary extends AgentUsage {
  agentCount: number;
}

export function summarizeAgentUsage(results: Array<{ usage?: AgentUsage | undefined }>): UsageSummary | undefined {
  const summary: UsageSummary = { agentCount: 0 };

  for (const result of results) {
    if (!result.usage) continue;
    summary.agentCount += 1;
    addUsageField(summary, "inputTokens", result.usage.inputTokens);
    addUsageField(summary, "cachedInputTokens", result.usage.cachedInputTokens);
    addUsageField(summary, "outputTokens", result.usage.outputTokens);
    addUsageField(summary, "reasoningOutputTokens", result.usage.reasoningOutputTokens);
    addUsageField(summary, "totalTokens", result.usage.totalTokens ?? inferredTotalTokens(result.usage));
  }

  return summary.agentCount > 0 ? summary : undefined;
}

function addUsageField(summary: UsageSummary, key: keyof AgentUsage, value: number | undefined): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  summary[key] = (summary[key] ?? 0) + value;
}

function inferredTotalTokens(usage: AgentUsage): number | undefined {
  const input = finiteNumber(usage.inputTokens);
  const output = finiteNumber(usage.outputTokens);
  if (input === undefined && output === undefined) return undefined;
  return (input ?? 0) + (output ?? 0);
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
