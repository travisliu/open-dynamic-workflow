import type { ThinkingEffort } from "../types/thinking-effort.js";

export type ThinkingEffortSource = "agent" | "cli" | "provider-default" | "provider-cli-default";

export interface ResolveThinkingEffortInput {
  agentThinkingEffort?: ThinkingEffort | undefined;
  cliThinkingEffort?: ThinkingEffort | undefined;
  providerDefaultThinkingEffort?: ThinkingEffort | undefined;
}

export interface ResolveThinkingEffortResult {
  thinkingEffort?: ThinkingEffort | undefined;
  source: ThinkingEffortSource;
}

export function resolveThinkingEffort(
  input: ResolveThinkingEffortInput
): ResolveThinkingEffortResult {
  if (input.agentThinkingEffort !== undefined) {
    return {
      thinkingEffort: input.agentThinkingEffort,
      source: "agent",
    };
  }
  if (input.cliThinkingEffort !== undefined) {
    return {
      thinkingEffort: input.cliThinkingEffort,
      source: "cli",
    };
  }
  if (input.providerDefaultThinkingEffort !== undefined) {
    return {
      thinkingEffort: input.providerDefaultThinkingEffort,
      source: "provider-default",
    };
  }
  return {
    thinkingEffort: undefined,
    source: "provider-cli-default",
  };
}
