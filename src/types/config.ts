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
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval?: "untrusted" | "on-request" | "never";
  ephemeral?: boolean;
  profile?: string;
  profileV2?: string;
  config?: string[];
  ignoreUserConfig?: boolean;
  ignoreRules?: boolean;
  skipGitRepoCheck?: boolean;
  addDir?: string[];
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

export interface OpenFlowConfig {
  defaultProvider: ProviderName;
  concurrency: number;
  timeoutMs: number;
  defaultModel?: string | null;
  failFast?: boolean;
  providers: Record<string, ProviderConfig>;
  security: SecurityConfig;
  reporting: ReportingConfig;
  budget?: BudgetConfig | undefined;
}

export interface BudgetConfig {
  maxAgentCalls?: number | undefined;
  maxObservedTokens?: number | undefined;
  maxRunMs?: number | undefined;
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
  maxAgentCalls?: number | undefined;
  maxObservedTokens?: number | undefined;
  maxRunMs?: number | undefined;
  dryRun: boolean;
  failFast: boolean;
  verbose: boolean;
  resume?: string;
  noCache?: boolean;
  pauseResponses?: Record<string, unknown>;
}
