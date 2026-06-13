import type { JsonObject, ProviderName, ReporterMode } from "./common.js";

export interface ProviderModelArgConfig {
  flag: string;
}

export interface ProviderConfig {
  command: string;
  args?: string[];
  defaultModel?: string | null;
  modelArg?: ProviderModelArgConfig | false;
  timeoutMs?: number;
  env?: Record<string, string>;
  mock?: MockProviderConfig;
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

export interface MockProviderConfig {
  responses?: Record<string, MockProviderResponse>;
  defaultResponse?: MockProviderResponse;
}

export interface MockProviderResponse {
  text?: string;
  json?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delayMs?: number;
  fail?: boolean;
  timeout?: boolean;
}

export interface SecurityConfig {
  allowWorkflowImports: false;
  passEnv: string[];
  redactEnv: string[];
}

export interface ReportingConfig {
  mode: ReporterMode;
  verbose: boolean;
}

export interface SharedAgentsConfig {
  dir: string;
  allowDynamicIds: false;
  maxDefinitions: number;
  strictPromptTemplateVariables: boolean;
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
  failFast?: boolean;
  providers: Record<string, ProviderConfig>;
  security: SecurityConfig;
  reporting: ReportingConfig;
  sharedAgents: SharedAgentsConfig;
  workflow: WorkflowConfig;
  orchestration?: OrchestrationConfig;
}

export interface ResolvedConfig extends OpenFlowConfig {
  cwd: string;
  outDir: string;
  configPath?: string;
  cliArgs: Record<string, string | boolean | number>;
}

export interface CliRunOptions {
  workflowFile: string;
  provider?: ProviderName;
  model?: string;
  args: JsonObject;
  configPath?: string;
  cwd?: string;
  outDir?: string;
  report?: ReporterMode;
  concurrency?: number;
  timeoutMs?: number;
  resume?: string;
  noCache?: boolean;
  dryRun: boolean;
  failFast: boolean;
  verbose: boolean;
}
