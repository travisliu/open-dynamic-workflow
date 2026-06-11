import type { DirectAgentCallInput, AgentResult } from "../types/agent.js";
import type { JsonSchema } from "../types/common.js";

export interface SharedAgentDefinition {
  id: string;
  description?: string;
  inputSchema?: JsonSchema;
  agentPrompt?: string;
  metadata?: Record<string, unknown>;
  run(
    context: Record<string, unknown>,
    runtime: SharedAgentRuntime
  ): Promise<AgentResult>;
}

export interface SharedAgentRuntime {
  agent(input: DirectAgentCallInput): Promise<AgentResult>;
  log(message: string, data?: unknown): void;
  signal: AbortSignal;
  runId: string;
  cwd: string;
  artifactsDir: string;
  renderAgentPrompt(context: unknown): string;
  pipeline?: SharedAgentPipelineMetadata;
}

export interface SharedAgentPipelineMetadata {
  pipelineId: string;
  itemIndex: number;
  stageIndex: number;
  stageName: string;
  pipelineLabel?: string | undefined;
}

export interface SharedAgentRegistryEntry {
  id: string;
  sourcePath: string;
  definition: SharedAgentDefinition;
  validatedAt: string;
}

