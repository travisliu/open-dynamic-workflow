export type ProviderName = "codex" | "gemini" | "mock" | string;
export type ReporterMode = "pretty" | "json" | "jsonl";

export interface ProviderModelArgConfig {
  flag: string;
}

export interface ProviderConfig {
  command: string;
  args: string[];
  defaultModel: string | null;
  modelArg?: ProviderModelArgConfig | false;
  timeoutMs?: number;
  env?: Record<string, string>;
  responses?: Record<string, unknown>; // Used by mock provider.
  promptMode?: "stdin" | "arg";
}

export interface SecurityConfig {
  passEnv: string[];
  redactEnv: string[];
  allowWorkflowImports: false;
}

export interface SharedAgentsConfig {
  dir: string;
  allowDynamicIds: false;
  maxDefinitions: number;
  strictPromptTemplateVariables: boolean;
}

export interface ToolsConfig {
  dir: string;
  concurrency: number;
  maxDefinitions: number;
}

export interface WorkflowDiscoveryConfig {
  include: string[];
}

export interface WorkflowConfig {
  discovery: WorkflowDiscoveryConfig;
  maxDepth: number;
}

export interface OrchestrationConfig {
  concurrency?: number;
}

export interface OpenFlowConfig {
  defaultProvider: ProviderName;
  concurrency: number;
  timeoutMs: number;
  defaultModel?: string | null;
  providers: Record<string, ProviderConfig>;
  security: SecurityConfig;
  sharedAgents: SharedAgentsConfig;
  tools: ToolsConfig;
  workflow: WorkflowConfig;
  orchestration?: OrchestrationConfig;
  reporting: {
    mode: ReporterMode;
    verbose: boolean;
  };
  failFast?: boolean;
}

export interface ResolvedOpenFlowConfig extends OpenFlowConfig {
  configPath?: string;
  cwd: string;
  outDir: string;
}
