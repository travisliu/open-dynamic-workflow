export type ProviderName = "codex" | "gemini" | "mock" | "opencode" | "antigravity" | "pi" | string;
export type ReporterMode = "pretty" | "json" | "jsonl";

export interface ProviderModelArgConfig {
  flag: string;
}

export interface ProviderConfig {
  command: string;
  args?: string[];
  defaultModel: string | null;
  modelArg?: ProviderModelArgConfig | false;
  timeoutMs?: number;
  env?: Record<string, string>;
  responses?: Record<string, unknown>; // Used by mock provider.
  promptMode?: "stdin" | "arg";
  promptFlag?: string;
  modelFlag?: string;
  sandboxFlag?: string;
  dangerouslySkipPermissionsFlag?: string;
  useSandboxByDefault?: boolean;
  permissionPolicy?: string;
  printTimeoutFlag?: string;
  agentFlag?: string;
  dirFlag?: string | false;
  formatFlag?: string;
  format?: string;
  variantFlag?: string;
  defaultAgent?: string;
  defaultVariant?: string;
  piProvider?: string;
  providerFlag?: string;
  executionMode?: string;
  approvalMode?: string;
  safeTools?: string[];
  fullAccessTools?: string[];
  thinking?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  deterministicEnv?: boolean;
  noSession?: boolean;
  noContextFiles?: boolean;
  noExtensions?: boolean;
  noSkills?: boolean;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
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
