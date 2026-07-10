export type ProviderName = "codex" | "gemini" | "mock" | "copilot" | "opencode" | "antigravity" | "pi" | string;
export type ReporterMode = "pretty" | "json" | "jsonl";

import type { ThinkingEffort } from "../types/thinking-effort.js";
import type { RetryConfigInput, ResolvedRetryPolicy, RetryPolicyInput, RetryPolicy } from "../types/retry.js";
import type { JsonObject } from "../types/common.js";

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
  defaultThinkingEffort?: ThinkingEffort;
}

export interface SecurityConfig {
  passEnv: string[];
  redactEnv: string[];
  allowWorkflowImports: false;
}

export interface OrchestrationConfig {
  concurrency?: number;
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

// --- Raw Public Configuration Types ---

export interface ResourcePathConfig {
  include?: unknown;
  exclude?: unknown;
}

export interface SharedAgentsConfig extends ResourcePathConfig {
  dir?: unknown;
  allowDynamicIds?: boolean;
  maxDefinitions?: number;
  strictPromptTemplateVariables?: boolean;
}

export interface ToolsConfig extends ResourcePathConfig {
  dir?: unknown;
  concurrency?: number;
  maxDefinitions?: number;
}

export interface WorkflowDiscoveryConfig {
  include?: unknown;
  exclude?: unknown;
}

export interface WorkflowConfig extends ResourcePathConfig {
  discovery?: WorkflowDiscoveryConfig | unknown;
  maxDepth?: number;
  maxLoopRounds?: number;
}

export interface OpenDynamicWorkflowConfig {
  defaultProvider: ProviderName;
  concurrency: number;
  timeoutMs: number;
  maxAgentCalls?: number | undefined;
  defaultModel?: string | null;
  providers: Record<string, ProviderConfig>;
  security: SecurityConfig;
  sharedAgents: SharedAgentsConfig;
  tools?: ToolsConfig;
  workflow: WorkflowConfig;
  orchestration?: OrchestrationConfig;
  reporting: {
    mode: ReporterMode;
    verbose: boolean;
  };
  failFast?: boolean;
  retry?: false | RetryConfigInput | ResolvedRetryPolicy | undefined;
  profiles?: WorkflowProfileCatalog | undefined;
  providerAliasMaxDepth?: number | undefined;
  providerAliases?: ProviderAliasesConfig | undefined;
}

// --- Resolved Runtime Configuration Types ---

export interface ResolvedSharedAgentsConfig {
  include: string[];
  exclude: string[];
  dir: string;

  allowDynamicIds: boolean;
  maxDefinitions: number;
  strictPromptTemplateVariables: boolean;
}

export interface ResolvedToolsConfig {
  include: string[];
  exclude: string[];
  dir: string;

  concurrency: number;
  maxDefinitions: number;
}

export interface ResolvedWorkflowDiscoveryConfig {
  include: string[];
  exclude?: string[];
}

export interface ResolvedWorkflowConfig {
  include: string[];
  exclude: string[];
  discovery: ResolvedWorkflowDiscoveryConfig;

  maxDepth: number;
  maxLoopRounds: number;
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

export interface ResolvedOpenDynamicWorkflowConfig extends Omit<OpenDynamicWorkflowConfig, "sharedAgents" | "tools" | "workflow" | "providerAliases"> {
  configPath?: string;
  cwd: string;
  outDir: string;

  sharedAgents: ResolvedSharedAgentsConfig;
  tools: ResolvedToolsConfig;
  workflow: ResolvedWorkflowConfig;

  _normalizedDiscovery: NormalizedDiscoveryConfig;
  _configDiagnostics: ConfigDiagnostic[];
  retry?: ResolvedRetryPolicy | undefined;
  providerAliasMaxDepth: number;
  providerAliases: ResolvedProviderAliasRegistry;
  _executionDefaultLayers: ExecutionDefaultLayers;
}

// --- Normalized Discovery Types ---

export type DiscoveryResource = "workflow" | "sharedAgents" | "tools";

export type DiscoveryConfigSource =
  | "new"
  | "legacy-dir"
  | "legacy-discovery"
  | "default"
  | "cli-override";

export type DiscoveryCompatibilityMode =
  | "new-suffix-specific"
  | "legacy-compatible"
  | "default-suffix-specific"
  | "cli-dir-compatible";

export interface NormalizedResourceDiscovery {
  resource: DiscoveryResource;
  include: string[];
  exclude: string[];

  source: DiscoveryConfigSource;
  includeSource: DiscoveryConfigSource;
  excludeSource: DiscoveryConfigSource;
  compatibilityMode: DiscoveryCompatibilityMode;

  /** Raw key paths that contributed to the normalized result. */
  sourcePaths: string[];

  /** Original patterns before POSIX/cwd-relative normalization. */
  rawInclude: string[];
  rawExclude: string[];

  diagnostics: ConfigDiagnostic[];
}

export interface NormalizedDiscoveryConfig {
  workflow: NormalizedResourceDiscovery;
  sharedAgents: NormalizedResourceDiscovery;
  tools: NormalizedResourceDiscovery;
}

export interface DiscoveryCliOverrides {
  resourceType?: "all" | "workflow" | "agent" | "tool";
  dir?: string;
  workflowsDir?: string;
  agentsDir?: string;
  toolsDir?: string;
}

// --- Diagnostic Types ---

export type ConfigDiagnosticSeverity = "warning" | "error";

export type ConfigDiagnosticCode =
  | "CONFIG_PATH_INVALID_TYPE"
  | "CONFIG_PATH_EMPTY_PATTERN"
  | "CONFIG_PATH_DIRECTORY_ONLY"
  | "CONFIG_PATH_UNSUPPORTED_RESOURCE_SUFFIX"
  | "CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX"
  | "CONFIG_PATH_LEGACY_KEY_USED"
  | "CONFIG_PATH_NEW_OVERRIDES_LEGACY"
  | "CONFIG_PATH_CLI_OVERRIDE_USED"
  | "CONFIG_PATH_INCLUDE_MATCHED_NOTHING"
  | "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING"
  | "CONFIG_PATH_OUTSIDE_WORKSPACE"
  | "CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN"
  | "CONFIG_PATH_SYMLINK_ESCAPE";

export interface ConfigDiagnostic {
  resource: DiscoveryResource;
  path: string;
  severity: ConfigDiagnosticSeverity;
  code: ConfigDiagnosticCode;
  message: string;
  value?: unknown;
  hint?: string;
  fatalInStrictContext: boolean;
  migration?: {
    oldKey?: string;
    ignoredKey?: string;
    effectiveInclude?: string[];
    effectiveExclude?: string[];
    replacementYaml?: string;
  };
  metrics?: {
    includePattern?: string;
    includeMatchCount?: number;
    excludePattern?: string;
    excludedMatchCount?: number;
  };
}

export type ConfigDiagnosticContext =
  | "list"
  | "list-strict"
  | "validate"
  | "validate-strict"
  | "run"
  | "run-strict"
  | "doctor";

export function isStrictConfigDiagnosticContext(
  context: ConfigDiagnosticContext
): boolean {
  return context === "list-strict" ||
    context === "validate-strict" ||
    context === "run-strict";
}

export function getFatalConfigDiagnostics(
  diagnostics: ConfigDiagnostic[],
  context: ConfigDiagnosticContext
): ConfigDiagnostic[] {
  if (!isStrictConfigDiagnosticContext(context)) {
    return [];
  }

  return diagnostics.filter(diagnostic => diagnostic.fatalInStrictContext);
}
