import type { AgentUsage } from "../types/agent.js";

export function formatUsageSummary(summary?: (AgentUsage & { agentCount: number }) | undefined): string | undefined {
  if (!summary || summary.agentCount <= 0) {
    return undefined;
  }
  const parts = [
    `${summary.totalTokens ?? 0} total`,
    `${summary.inputTokens ?? 0} input`,
    `${summary.outputTokens ?? 0} output`
  ];
  if ((summary.reasoningOutputTokens ?? 0) > 0) {
    parts.push(`${summary.reasoningOutputTokens} reasoning`);
  }
  if ((summary.cachedInputTokens ?? 0) > 0) {
    parts.push(`${summary.cachedInputTokens} cached input`);
  }
  return `Usage: ${parts.join(", ")} tokens across ${summary.agentCount} live agent${summary.agentCount === 1 ? "" : "s"}`;
}
