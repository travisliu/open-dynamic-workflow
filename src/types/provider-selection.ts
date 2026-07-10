import type { ThinkingEffort } from "./thinking-effort.js";
import type { ResolvedRetryPolicy, RetryPolicy, RetryConfigInput } from "./retry.js";
import type { ResolvedProviderAlias, ResolvedProviderAliasRegistry, ProviderConfig, ExecutionDefaultLayers } from "../config/types.js";
import type { DirectAgentCallInput } from "./agent.js";

export type ProviderReferenceSource =
  | "agent"
  | "cli"
  | "globalConfig"
  | "builtIn";

export type ProviderSettingSource =
  | "agent"
  | "providerAlias"
  | "cli"
  | "providerConfig"
  | "globalConfig"
  | "builtIn";

export type ProviderSettingName =
  | "provider"
  | "model"
  | "thinkingEffort"
  | "timeoutMs"
  | "retry";

export interface ProviderSettingValue<T = unknown> {
  value: T;
  source: ProviderSettingSource;
  sourcePath: string;
}

export interface ProviderSettingOverride {
  setting: ProviderSettingName;
  selected: ProviderSettingValue;
  overridden: ProviderSettingValue;
}

export interface ResolvedRetrySelection {
  value: ResolvedRetryPolicy;
  source: ProviderSettingSource;
  sourcePath: string;
  fieldSources: Readonly<
    Record<keyof RetryPolicy, ProviderSettingValue>
  >;
}

export interface ResolvedProviderSelection {
  schemaVersion: "open-dynamic-workflow.provider-selection.v1";

  requestedProvider: string;
  requestedProviderSource: ProviderReferenceSource;
  providerAlias?: string | undefined;
  providerAliasChain?: readonly string[] | undefined;
  providerAliasDigest?: string | undefined;
  provider: string;

  model?: string | null | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  timeoutMs: number;
  retry: ResolvedRetryPolicy;

  sources: Readonly<{
    provider: ProviderSettingValue<string>;
    model?: ProviderSettingValue<string | null> | undefined;
    thinkingEffort?: ProviderSettingValue<ThinkingEffort> | undefined;
    timeoutMs: ProviderSettingValue<number>;
    retry: ProviderSettingValue<ResolvedRetryPolicy>;
  }>;

  retryFieldSources: ResolvedRetrySelection["fieldSources"];
  overrides: readonly ProviderSettingOverride[];
}

export interface RetryPolicyArtifact {
  enabled: boolean;
  maxAttempts: number;
  delayMs: number;
  backoff: "fixed" | "exponential";
  maxDelayMs: number;
  jitter: boolean;
  disableDelay: boolean;
}

export interface ResolvedProviderSelectionArtifact {
  schemaVersion: "open-dynamic-workflow.provider-selection.v1";
  selection: {
    requestedProvider: string;
    requestedProviderSource: ProviderReferenceSource;
    providerAlias?: string | undefined;
    providerAliasChain?: readonly string[] | undefined;
    providerAliasDigest?: string | undefined;
    resolvedProvider: string;
  };
  resolvedExecution: {
    model?: string | null | undefined;
    thinkingEffort?: ThinkingEffort | undefined;
    timeoutMs: number;
    retry: RetryPolicyArtifact;
  };
  sources: {
    provider: ProviderSettingSource;
    model?: ProviderSettingSource | undefined;
    thinkingEffort?: ProviderSettingSource | undefined;
    timeoutMs: ProviderSettingSource;
    retry: ProviderSettingSource;
  };
}

export type ProviderReferenceResolution =
  | {
      kind: "alias";
      requestedProvider: string;
      alias: ResolvedProviderAlias;
      provider: string;
    }
  | {
      kind: "provider";
      requestedProvider: string;
      provider: string;
    };

export interface ResolveProviderSelectionInput {
  call: Partial<DirectAgentCallInput>;
  providers: Readonly<Record<string, ProviderConfig>>;
  aliases: ResolvedProviderAliasRegistry;
  layers: ExecutionDefaultLayers;
}
