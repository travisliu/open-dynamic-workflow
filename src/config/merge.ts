import type { OpenDynamicWorkflowConfig } from "./types.js";
import { resolveGlobalRetryPolicy } from "./retry.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";

export interface ConfigCliOverrides {
  provider?: string | undefined;
  model?: string | undefined;
  concurrency?: number | undefined;
  timeoutMs?: number | undefined;
  maxAgentCalls?: number | undefined;
  report?: "pretty" | "json" | "jsonl" | undefined;
  verbose?: boolean | undefined;
  retryMaxAttempts?: number | undefined;
  retryDelayMs?: number | undefined;
  retryMaxDelayMs?: number | undefined;
  retryBackoff?: "fixed" | "exponential" | undefined;
  retryDisableDelay?: boolean | undefined;
  noRetry?: boolean | undefined;
  failFast?: boolean | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
}

export interface MergedConfigResult {
  config: OpenDynamicWorkflowConfig;
  explicit: { outDir: boolean };
}

function isOrdinaryDescriptorSafeProfileCatalog(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
      return false;
    }
  }
  return true;
}

export function mergeConfig(
  defaults: OpenDynamicWorkflowConfig,
  fileConfig: Partial<OpenDynamicWorkflowConfig>,
  cli: ConfigCliOverrides
): OpenDynamicWorkflowConfig {
  return mergeConfigWithMetadata(defaults, fileConfig, cli).config;
}

export function mergeConfigWithMetadata(
  defaults: OpenDynamicWorkflowConfig,
  fileConfig: Partial<OpenDynamicWorkflowConfig>,
  cli: ConfigCliOverrides
): MergedConfigResult {
  const mergedProviders = { ...defaults.providers };
  if (fileConfig.providers) {
    for (const [key, value] of Object.entries(fileConfig.providers)) {
      if (value) {
        mergedProviders[key] = {
          ...mergedProviders[key],
          ...value
        } as any;
      }
    }
  }

  const fileProfilesDescriptor = Object.getOwnPropertyDescriptor(fileConfig, "profiles");
  const fileProfiles = fileProfilesDescriptor && "value" in fileProfilesDescriptor
    ? fileProfilesDescriptor.value
    : undefined;
  const hasFileProfiles = fileProfilesDescriptor !== undefined;
  const mergedProfiles = !hasFileProfiles
    ? defaults.profiles
    : isOrdinaryDescriptorSafeProfileCatalog(fileProfiles)
      ? { ...(defaults.profiles ?? {}), ...fileProfiles }
      : fileProfiles;

  const merged: OpenDynamicWorkflowConfig = {
    ...defaults,
    ...fileConfig,
    providers: mergedProviders,
    security: {
      ...defaults.security,
      ...(fileConfig.security ?? {}),
      allowWorkflowImports: false
    },
    reporting: {
      ...defaults.reporting,
      ...(fileConfig.reporting ?? {})
    },
    sharedAgents: {
      ...defaults.sharedAgents,
      ...(fileConfig.sharedAgents ?? {}),
      allowDynamicIds: false
    },
    tools: {
      ...defaults.tools,
      ...(fileConfig.tools ?? {})
    },
    workflow: {
      ...defaults.workflow,
      ...(fileConfig.workflow ?? {}),
      discovery: {
        ...(typeof defaults.workflow.discovery === "object" && defaults.workflow.discovery !== null ? defaults.workflow.discovery : {}),
        ...(typeof fileConfig.workflow?.discovery === "object" && fileConfig.workflow?.discovery !== null ? fileConfig.workflow?.discovery : {})
      }
    },
    profiles: mergedProfiles as OpenDynamicWorkflowConfig["profiles"]
  };

  if (cli.provider) merged.defaultProvider = cli.provider;
  if (cli.model !== undefined) merged.defaultModel = cli.model;
  if (cli.concurrency !== undefined) merged.concurrency = cli.concurrency;
  if (cli.timeoutMs !== undefined) merged.timeoutMs = cli.timeoutMs;
  if (cli.maxAgentCalls !== undefined) merged.maxAgentCalls = cli.maxAgentCalls;
  if (cli.report) merged.reporting.mode = cli.report;
  if (cli.verbose !== undefined) merged.reporting.verbose = cli.verbose;
  if (cli.failFast !== undefined) merged.failFast = cli.failFast;

  const cliOverrides = {
    maxAttempts: cli.retryMaxAttempts,
    delayMs: cli.retryDelayMs,
    maxDelayMs: cli.retryMaxDelayMs,
    backoff: cli.retryBackoff,
    disableDelay: cli.retryDisableDelay,
    noRetry: cli.noRetry
  };

  merged.retry = resolveGlobalRetryPolicy({
    configRetry: fileConfig.retry,
    cliOverrides
  });

  return {
    config: merged,
    explicit: {
      outDir: Object.prototype.hasOwnProperty.call(fileConfig, "outDir")
    }
  };
}
