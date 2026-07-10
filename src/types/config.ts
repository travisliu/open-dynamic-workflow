import type { JsonObject, ProviderName, ReporterMode } from "./common.js";
import type { ThinkingEffort } from "./thinking-effort.js";
import type { ResolvedRetryPolicy, RetryBackoff, RetryConfigInput, RetryPolicyInput, RetryPolicy } from "./retry.js";


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
  defaultThinkingEffort?: ThinkingEffort | undefined;
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
  maxLoopRounds: number;
}

export interface OrchestrationConfig {
  concurrency?: number;
}

export interface ProviderAliasConfig {
  provider?: string | undefined;
  extends?: string | undefined;
  model?: string | null | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  timeoutMs?: number | undefined;
  retry?: RetryPolicyInput | undefined;
}

export type ProviderAliasesConfig = Record<string, ProviderAliasConfig>;

export type ProviderAliasSettingName =
  | "provider"
  | "model"
  | "thinkingEffort"
  | "timeoutMs"
  | "retry";

export interface ProviderAliasRetryProvenance {
  sourceAlias: string;
  fieldSources: Partial<Record<keyof RetryPolicy, string>>;
}

export interface ResolvedProviderAlias {
  name: string;
  inheritanceChain: readonly string[];
  provider: string;

  model?: string | null | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  timeoutMs?: number | undefined;
  retry?: RetryPolicyInput | undefined;

  origins: Readonly<{
    provider: string;
    model?: string | undefined;
    thinkingEffort?: string | undefined;
    timeoutMs?: string | undefined;
    retry?: ProviderAliasRetryProvenance | undefined;
  }>;

  digest: string;
}

export type ResolvedProviderAliasRegistry = Readonly<
  Record<string, ResolvedProviderAlias>
>;

export interface OpenDynamicWorkflowConfig {
  defaultProvider: ProviderName;
  concurrency: number;
  timeoutMs: number;
  maxAgentCalls?: number | undefined;
  defaultModel?: string | null;
  failFast?: boolean;
  retry?: false | RetryConfigInput | ResolvedRetryPolicy | undefined;
  providers: Record<string, ProviderConfig>;
  security: SecurityConfig;
  reporting: ReportingConfig;
  sharedAgents: SharedAgentsConfig;
  workflow: WorkflowConfig;
  orchestration?: OrchestrationConfig;
  profiles?: WorkflowProfileCatalog | undefined;
  providerAliasMaxDepth?: number | undefined;
  providerAliases?: ProviderAliasesConfig | undefined;
}

export interface RetryCliOverrides {
  maxAttempts?: number | undefined;
  delayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  backoff?: "fixed" | "exponential" | undefined;
  disableDelay?: boolean | undefined;
  noRetry?: boolean | undefined;
}

export interface ExecutionDefaultLayers {
  cli: Readonly<{
    provider?: string;
    model?: string;
    timeoutMs?: number;
    thinkingEffort?: ThinkingEffort;
    retry?: RetryCliOverrides;
  }>;
  config: Readonly<{
    defaultProvider?: string;
    defaultModel?: string | null;
    timeoutMs?: number;
    retry?: false | RetryConfigInput;
  }>;
  builtIn: Readonly<{
    defaultProvider: string;
    timeoutMs: number;
  }>;
}

export interface ResolvedConfig extends Omit<OpenDynamicWorkflowConfig, "providerAliases"> {
  cwd: string;
  outDir: string;
  configPath?: string;
  cliArgs?: Record<string, string | boolean | number> | undefined;
  retry?: ResolvedRetryPolicy | undefined;
  providerAliasMaxDepth: number;
  providerAliases: ResolvedProviderAliasRegistry;
  _executionDefaultLayers: ExecutionDefaultLayers;
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
  resume?: string;
  noCache?: boolean;
  dryRun: boolean;
  failFast: boolean;
  verbose: boolean;
  thinkingEffort?: ThinkingEffort | undefined;
  retryMaxAttempts?: number | undefined;
  retryDelayMs?: number | undefined;
  retryMaxDelayMs?: number | undefined;
  retryBackoff?: RetryBackoff | undefined;
  retryDisableDelay?: boolean | undefined;
  noRetry?: boolean | undefined;
}

export type ProfileName = string;

export interface WorkflowProfile {
  description?: string | undefined;
  extends?: ProfileName | ProfileName[] | undefined;
  args?: JsonObject | undefined;
  context?: JsonObject | undefined;
  run?: WorkflowProfileRunOptions | undefined;
}

export interface WorkflowProfileRunOptions {
  provider?: ProviderName | undefined;
  model?: string | undefined;
  concurrency?: number | undefined;
  timeoutMs?: number | undefined;
  maxAgentCalls?: number | undefined;
  failFast?: boolean | undefined;
  report?: ReporterMode | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  retry?: false | Partial<RetryConfigInput> | ResolvedRetryPolicy | undefined;
}

export type WorkflowProfileCatalog = Record<ProfileName, WorkflowProfile>;

export interface ProfilesFileDocument {
  description?: string | undefined;
  version?: string | undefined;
  profiles: WorkflowProfileCatalog;
}

export type ProfileSource =
  | "config"
  | "external"
  | "external-override"
  | "recorded";

export interface RuntimeProfileContextSeed {
  context: JsonObject;
  metadata: {
    name: string;
    source: ProfileSource;
    hasExternalFile: boolean;
    hash: string;
    profilesPath?: string | undefined;
  };
  reservedPath: "$profile";
}

export interface ProfileReportMetadata {
  selected: string;
  source: ProfileSource;
  profilesPath?: string | undefined;
  hash: string;
  resumedFromRecordedProfile?: true | undefined;
}

export interface ProfileCatalogEntry {
  name: ProfileName;
  profile: WorkflowProfile;
  source: Exclude<ProfileSource, "recorded">;
  sourcePath?: string | undefined;
  overridesConfigProfile: boolean;
}

export interface ResolvedWorkflowProfile {
  description?: string | undefined;
  args: JsonObject;
  context: JsonObject;
  run: WorkflowProfileRunOptions;
}

export interface ProfileDiagnostic {
  severity: "warning" | "info";
  code: string;
  message: string;
  path?: string | undefined;
}

export interface ResolvedProfileSelection {
  selected: ProfileName;
  source: ProfileSource;
  profilesPath?: string | undefined;
  hasExternalFile: boolean;
  resolved: ResolvedWorkflowProfile;
  hash: string;
  inheritanceChain: ProfileName[];
  diagnostics: ProfileDiagnostic[];
}
