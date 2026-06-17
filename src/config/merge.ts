import type { OpenDynamicWorkflowConfig } from "./types.js";

export interface ConfigCliOverrides {
  provider?: string | undefined;
  model?: string | undefined;
  concurrency?: number | undefined;
  timeoutMs?: number | undefined;
  maxAgentCalls?: number | undefined;
  maxObservedTokens?: number | undefined;
  maxRunMs?: number | undefined;
  report?: "pretty" | "json" | "jsonl" | undefined;
  verbose?: boolean | undefined;
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
        ...defaults.workflow.discovery,
        ...(fileConfig.workflow?.discovery ?? {})
      }
    },
    budgets: {
      ...(defaults.budgets ?? {}),
      ...(fileConfig.budgets ?? {})
    }
  };

  if (cli.provider) merged.defaultProvider = cli.provider;
  if (cli.model !== undefined) merged.defaultModel = cli.model;
  if (cli.concurrency !== undefined) merged.concurrency = cli.concurrency;
  if (cli.timeoutMs !== undefined) merged.timeoutMs = cli.timeoutMs;
  if (cli.maxAgentCalls !== undefined) merged.budgets = { ...(merged.budgets ?? {}), maxAgentCalls: cli.maxAgentCalls };
  if (cli.maxObservedTokens !== undefined) merged.budgets = { ...(merged.budgets ?? {}), maxObservedTokens: cli.maxObservedTokens };
  if (cli.maxRunMs !== undefined) merged.budgets = { ...(merged.budgets ?? {}), maxRunMs: cli.maxRunMs };
  if (cli.report) merged.reporting.mode = cli.report;
  if (cli.verbose !== undefined) merged.reporting.verbose = cli.verbose;

  return merged;
}
