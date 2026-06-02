import type { AgentResult } from "../types/agent.js";
import type { JsonSchema, ProviderName } from "../types/common.js";

export interface AgentExecutionInput {
  id: string;
  label?: string;
  provider: ProviderName;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs: number;
  cwd: string;
  metadata?: Record<string, unknown>;
  signal: AbortSignal;
}

export interface AgentExecutor {
  execute(input: AgentExecutionInput): Promise<AgentResult>;
}
