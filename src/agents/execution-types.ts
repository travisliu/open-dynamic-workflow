import type { AgentResult, AgentPermissions } from "../types/agent.js";
import type { JsonSchema, ProviderName } from "../types/common.js";
import type { StructuredOutputConfig } from "../types/agent.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";
import type { ResolvedProviderSelectionArtifact } from "../types/provider-selection.js";

export interface AgentExecutionInput {
  id: string;
  label?: string;
  provider: ProviderName;
  prompt: string;
  model?: string | null;
  schema?: JsonSchema;
  structuredOutput?: StructuredOutputConfig;
  timeoutMs: number;
  cwd: string;
  permissions: AgentPermissions;
  metadata?: Record<string, unknown>;
  signal: AbortSignal;
  thinkingEffort?: ThinkingEffort;
  providerSelection?: ResolvedProviderSelectionArtifact | undefined;
  artifacts?: {
    baseDir: string;        // agents/<logicalId>/attempts/<n>
    logicalDir: string;     // agents/<logicalId>
    attempt: number;
  };
}

export interface AgentExecutor {
  execute(input: AgentExecutionInput): Promise<AgentResult>;
}
