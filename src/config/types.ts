export type ProviderName = "codex" | "gemini" | "mock" | "copilot" | "opencode" | "antigravity" | "pi" | string;
export type ReporterMode = "pretty" | "json" | "jsonl";

import type { ThinkingEffort } from "../types/thinking-effort.js";

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

export interface ResolvedOpenDynamicWorkflowConfig extends Omit<OpenDynamicWorkflowConfig, "sharedAgents" | "tools" | "workflow"> {
  configPath?: string;
  cwd: string;
  outDir: string;

  sharedAgents: ResolvedSharedAgentsConfig;
  tools: ResolvedToolsConfig;
  workflow: ResolvedWorkflowConfig;

  _normalizedDiscovery: NormalizedDiscoveryConfig;
  _configDiagnostics: ConfigDiagnostic[];
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
