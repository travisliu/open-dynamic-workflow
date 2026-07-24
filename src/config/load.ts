import { readFile } from "node:fs/promises";
import { parseConfigYaml } from "./yaml.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { mergeConfigWithMetadata, type ConfigCliOverrides } from "./merge.js";
import { validateConfig, validateRetryConfigInput } from "./schema.js";
import type { ResolvedOpenDynamicWorkflowConfig, ConfigDiagnosticContext, DiscoveryCliOverrides, ExecutionDefaultLayers, RetryCliOverrides } from "./types.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";
import { resolveUserPath, resolveProjectPath } from "../cli/paths.js";
import { resolveArtifactRunsRoot } from "../cli/artifact-paths.js";
import type { RunProfileConfig } from "./types.js";
import { normalizeDiscoveryConfig } from "./path-discovery.js";
import { getFatalConfigDiagnostics } from "./path-diagnostics.js";
import { resolveProviderAliases } from "./provider-aliases.js";
import { BUILT_IN_PROVIDER_NAMES } from "../agents/provider-names.js";

export interface LoadConfigInput {
  cwd: string;
  configPath?: string;
  outDir?: string;
  selectedProfileName?: string;
  selectedProfile?: RunProfileConfig;
  cli: ConfigCliOverrides;
  diagnosticContext?: ConfigDiagnosticContext;
  discoveryCliOverrides?: DiscoveryCliOverrides;
}

export function defaultConfigPath(cwd = process.cwd()): string {
  return resolveProjectPath(".open-dynamic-workflow/config.yaml", cwd);
}

export async function loadConfig(input: LoadConfigInput): Promise<ResolvedOpenDynamicWorkflowConfig> {
  const absoluteCwd = resolveProjectPath(input.cwd);
  let resolvedConfigPath: string | undefined;
  let fileConfig: any = undefined;

  if (input.configPath) {
    resolvedConfigPath = resolveUserPath(input.configPath, absoluteCwd);
    try {
      const content = await readFile(resolvedConfigPath, "utf8");
      try {
        fileConfig = parseConfigYaml(content, resolvedConfigPath);
        if (typeof fileConfig !== "object" || fileConfig === null) {
          fileConfig = {};
        }
      } catch (err: any) {
        if (err instanceof OpenDynamicWorkflowError) {
          throw err;
        }
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Invalid YAML in config file: ${resolvedConfigPath}. ${err.message}`,
          { cause: err }
        );
      }
    } catch (err: any) {
      if (err instanceof OpenDynamicWorkflowError) {
        throw err;
      }
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Unable to read config file: ${resolvedConfigPath}`,
        { cause: err }
      );
    }
  } else {
    // Try to load default config location: .open-dynamic-workflow/config.yaml
    const defPath = defaultConfigPath(absoluteCwd);
    try {
      const content = await readFile(defPath, "utf8");
      resolvedConfigPath = defPath;
      try {
        fileConfig = parseConfigYaml(content, defPath);
        if (typeof fileConfig !== "object" || fileConfig === null) {
          fileConfig = {};
        }
      } catch (err: any) {
        if (err instanceof OpenDynamicWorkflowError) {
          throw err;
        }
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Invalid YAML in config file: ${defPath}. ${err.message}`,
          { cause: err }
        );
      }
    } catch (err: any) {
      if (err instanceof OpenDynamicWorkflowError) {
        throw err;
      }
      if (err.code !== "ENOENT") {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Unable to read config file: ${defPath}`,
          { cause: err }
        );
      }
    }
  }

  validateRetryConfigInput(fileConfig?.retry);
  const mergedResult = mergeConfigWithMetadata(DEFAULT_CONFIG, fileConfig || {}, input.cli);
  const merged = mergedResult.config;
  validateConfig(merged);

  const aliasResult = resolveProviderAliases({
    rawAliases: (merged as any).providerAliases,
    providers: merged.providers,
    builtInProviderNames: new Set(BUILT_IN_PROVIDER_NAMES),
    maxDepth: (merged as any).providerAliasMaxDepth ?? 8,
  });

  const finalProvider = merged.defaultProvider;
  if (typeof finalProvider !== "string" || (!(finalProvider in merged.providers) && !(finalProvider in aliasResult.aliases))) {
    const err = new OpenDynamicWorkflowError(
      ErrorCode.PROVIDER_REFERENCE_NOT_FOUND,
      `Config value 'defaultProvider' ('${finalProvider}') must be defined in providers or providerAliases.`
    );
    (err as any).requestedProvider = finalProvider;
    (err as any).cause = { requestedProvider: finalProvider };
    (err as any).details = { requestedProvider: finalProvider };
    throw err;
  }

  // Build _executionDefaultLayers
  const cliRetry: RetryCliOverrides = {};
  let hasRetryCli = false;
  if (input.cli.retryMaxAttempts !== undefined) { cliRetry.maxAttempts = input.cli.retryMaxAttempts; hasRetryCli = true; }
  if (input.cli.retryDelayMs !== undefined) { cliRetry.delayMs = input.cli.retryDelayMs; hasRetryCli = true; }
  if (input.cli.retryMaxDelayMs !== undefined) { cliRetry.maxDelayMs = input.cli.retryMaxDelayMs; hasRetryCli = true; }
  if (input.cli.retryBackoff !== undefined) { cliRetry.backoff = input.cli.retryBackoff; hasRetryCli = true; }
  if (input.cli.retryDisableDelay !== undefined) { cliRetry.disableDelay = input.cli.retryDisableDelay; hasRetryCli = true; }
  if (input.cli.noRetry !== undefined) { cliRetry.noRetry = input.cli.noRetry; hasRetryCli = true; }

  const cliLayer: any = {};
  if (input.cli.provider !== undefined) cliLayer.provider = input.cli.provider;
  if (input.cli.model !== undefined) cliLayer.model = input.cli.model;
  if (input.cli.timeoutMs !== undefined) cliLayer.timeoutMs = input.cli.timeoutMs;
  if (input.cli.thinkingEffort !== undefined) cliLayer.thinkingEffort = input.cli.thinkingEffort;
  if (hasRetryCli) cliLayer.retry = Object.freeze(cliRetry);
  Object.freeze(cliLayer);

  const configLayer: any = {};
  if (fileConfig && typeof fileConfig === "object") {
    if (fileConfig.defaultProvider !== undefined) configLayer.defaultProvider = fileConfig.defaultProvider;
    if (fileConfig.defaultModel !== undefined) configLayer.defaultModel = fileConfig.defaultModel;
    if (fileConfig.timeoutMs !== undefined) configLayer.timeoutMs = fileConfig.timeoutMs;
    if (fileConfig.retry !== undefined) {
      configLayer.retry = typeof fileConfig.retry === "object" && fileConfig.retry !== null
        ? Object.freeze({ ...fileConfig.retry })
        : fileConfig.retry;
    }
  }
  Object.freeze(configLayer);

  const builtInLayer = Object.freeze({
    defaultProvider: DEFAULT_CONFIG.defaultProvider,
    timeoutMs: DEFAULT_CONFIG.timeoutMs,
  });

  const _executionDefaultLayers = Object.freeze({
    cli: cliLayer,
    config: configLayer,
    builtIn: builtInLayer
  });

  const context = input.diagnosticContext ?? "list";

  const { discovery, diagnostics } = normalizeDiscoveryConfig({
    config: merged,
    cwd: absoluteCwd,
    ...(input.discoveryCliOverrides ? { cliOverrides: input.discoveryCliOverrides } : {}),
    ...(fileConfig !== undefined ? { rawConfig: fileConfig } : {}),
  });

  const fatalDiagnostics = getFatalConfigDiagnostics(diagnostics, context);
  if (fatalDiagnostics.length > 0) {
    const messages = fatalDiagnostics.map(
      (d) => `- ${d.path} ${d.code}: ${d.message}`
    );
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Invalid path configuration:\n${messages.join("\n")}`
    );
  }

  const resolvedOutDir = resolveArtifactRunsRoot({
    cwd: absoluteCwd,
    ...(input.outDir !== undefined ? { cliOutDir: input.outDir } : {}),
    ...(input.selectedProfileName !== undefined ? { selectedProfileName: input.selectedProfileName } : {}),
    ...(input.selectedProfile !== undefined ? { selectedProfile: input.selectedProfile } : {}),
    ...(mergedResult.explicit.outDir ? { fileOutDir: (fileConfig as any).outDir } : {}),
    builtInOutDir: DEFAULT_CONFIG.outDir ?? ".open-dynamic-workflow/runs",
  });

  const result: ResolvedOpenDynamicWorkflowConfig = {
    ...merged,
    providerAliases: aliasResult.aliases,
    providerAliasMaxDepth: (merged as any).providerAliasMaxDepth ?? 8,
    _executionDefaultLayers,
    sharedAgents: {
      ...merged.sharedAgents,
      include: discovery.sharedAgents.include,
      exclude: discovery.sharedAgents.exclude,
      dir: (merged.sharedAgents.dir as string) ?? ".open-dynamic-workflow/agents",
      allowDynamicIds: merged.sharedAgents.allowDynamicIds ?? false,
      maxDefinitions: merged.sharedAgents.maxDefinitions ?? 100,
      strictPromptTemplateVariables: merged.sharedAgents.strictPromptTemplateVariables ?? true,
    },
    tools: {
      include: discovery.tools.include,
      exclude: discovery.tools.exclude,
      dir: (merged.tools?.dir as string) ?? ".open-dynamic-workflow/tools",
      concurrency: merged.tools?.concurrency ?? 4,
      maxDefinitions: merged.tools?.maxDefinitions ?? 100,
    },
    workflow: {
      ...merged.workflow,
      include: discovery.workflow.include,
      exclude: discovery.workflow.exclude,
      discovery: {
        include: ((merged.workflow as any).discovery?.include as string[]) || [],
        exclude: ((merged.workflow as any).discovery?.exclude as string[]) || undefined,
      },
      maxDepth: merged.workflow.maxDepth ?? 8,
      maxLoopRounds: merged.workflow.maxLoopRounds ?? 20,
    },
    cwd: absoluteCwd,
    outDir: resolvedOutDir.path,
    _resolution: { outDir: resolvedOutDir },
    _normalizedDiscovery: discovery,
    _configDiagnostics: diagnostics,
    retry: merged.retry as any,
  };
  if (resolvedConfigPath !== undefined) {
    result.configPath = resolvedConfigPath;
  }
  return result;
}
