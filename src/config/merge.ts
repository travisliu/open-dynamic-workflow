import type { OpenDynamicWorkflowConfig } from "./types.js";

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
}

export function mergeConfig(
  defaults: OpenDynamicWorkflowConfig,
  fileConfig: Partial<OpenDynamicWorkflowConfig>,
  cli: ConfigCliOverrides
): OpenDynamicWorkflowConfig {
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
    }
  };

  if (cli.provider) merged.defaultProvider = cli.provider;
  if (cli.model !== undefined) merged.defaultModel = cli.model;
  if (cli.concurrency !== undefined) merged.concurrency = cli.concurrency;
  if (cli.timeoutMs !== undefined) merged.timeoutMs = cli.timeoutMs;
  if (cli.maxAgentCalls !== undefined) merged.maxAgentCalls = cli.maxAgentCalls;
  if (cli.report) merged.reporting.mode = cli.report;
  if (cli.verbose !== undefined) merged.reporting.verbose = cli.verbose;

  if (cli.noRetry) {
    merged.retry = false;
  } else {
    const hasRetryOverrides =
      cli.retryMaxAttempts !== undefined ||
      cli.retryDelayMs !== undefined ||
      cli.retryMaxDelayMs !== undefined ||
      cli.retryBackoff !== undefined ||
      cli.retryDisableDelay !== undefined;

    if (hasRetryOverrides) {
      const existingRetry = typeof merged.retry === "object" && merged.retry !== null ? merged.retry : {};
      const newRetry: any = {
        ...existingRetry,
      };
      if (cli.retryMaxAttempts !== undefined) newRetry.maxAttempts = cli.retryMaxAttempts;
      if (cli.retryDelayMs !== undefined) newRetry.delayMs = cli.retryDelayMs;
      if (cli.retryMaxDelayMs !== undefined) newRetry.maxDelayMs = cli.retryMaxDelayMs;
      if (cli.retryBackoff !== undefined) newRetry.backoff = cli.retryBackoff;
      if (cli.retryDisableDelay !== undefined) newRetry.disableDelay = cli.retryDisableDelay;
      merged.retry = newRetry;
    }
  }

  return merged;
}
