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
  allowShell: false;
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
