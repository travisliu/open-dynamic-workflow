import type { ThinkingEffort } from "../types/thinking-effort.js";
import type { ResolvedRetryPolicy, RetryPolicy, RetryConfigInput, RetryPolicyInput } from "../types/retry.js";
import type {
  ResolvedProviderAlias,
  ResolvedProviderAliasRegistry,
  ProviderConfig,
  ExecutionDefaultLayers
} from "../config/types.js";
import type { DirectAgentCallInput } from "../types/agent.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { resolveLayeredRetryPolicy } from "../config/retry.js";
import { BUILT_IN_PROVIDER_NAMES } from "./provider-names.js";
import type {
  ProviderReferenceSource,
  ProviderSettingSource,
  ProviderSettingName,
  ProviderSettingValue,
  ProviderSettingOverride,
  ResolvedRetrySelection,
  ResolvedProviderSelection,
  ResolvedProviderSelectionArtifact,
  ProviderReferenceResolution,
  ResolveProviderSelectionInput
} from "../types/provider-selection.js";


interface Candidate<T> {
  value: T;
  source: ProviderSettingSource;
  sourcePath: string;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const prop = (obj as any)[key];
    if (prop !== null && (typeof prop === "object" || typeof prop === "function") && !Object.isFrozen(prop)) {
      deepFreeze(prop);
    }
  }
  return obj;
}

function isRetryPolicyEquivalent(p1: ResolvedRetryPolicy, p2: ResolvedRetryPolicy): boolean {
  if (p1.enabled !== p2.enabled) return false;
  if (!p1.enabled) return true; // both disabled
  const fields: (keyof RetryPolicy)[] = ["maxAttempts", "delayMs", "backoff", "maxDelayMs", "jitter", "disableDelay"];
  return fields.every(k => p1.policy[k] === p2.policy[k]);
}

function selectSettingAndOverrides<T>(
  candidates: Candidate<T>[],
  settingName: ProviderSettingName,
  overridesList: ProviderSettingOverride[],
  isEquivalent: (a: T, b: T) => boolean = (x, y) => x === y
): { value: T; source: ProviderSettingValue<T> } | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const selected = candidates[0]!;
  
  for (let i = 1; i < candidates.length; i++) {
    const cand = candidates[i]!;
    if (cand.value !== undefined && !isEquivalent(selected.value, cand.value)) {
      overridesList.push({
        setting: settingName,
        selected: selected as any,
        overridden: cand as any
      });
    }
  }

  return {
    value: selected.value,
    source: selected as any
  };
}

export function resolveProviderReference(input: {
  requestedProvider: string;
  aliases: ResolvedProviderAliasRegistry;
  providers: Readonly<Record<string, ProviderConfig>>;
}): ProviderReferenceResolution {
  const { requestedProvider, aliases, providers } = input;
  const aliasesSafe = aliases || {};
  const providersSafe = providers || {};
  if (Object.prototype.hasOwnProperty.call(aliasesSafe, requestedProvider)) {
    const alias = aliasesSafe[requestedProvider]!;
    return {
      kind: "alias",
      requestedProvider,
      alias,
      provider: alias.provider
    };
  } else if (Object.prototype.hasOwnProperty.call(providersSafe, requestedProvider) || BUILT_IN_PROVIDER_NAMES.includes(requestedProvider as any)) {
    return {
      kind: "provider",
      requestedProvider,
      provider: requestedProvider
    };
  } else {
    const err = new OpenDynamicWorkflowError(
      ErrorCode.PROVIDER_REFERENCE_NOT_FOUND,
      `Unknown provider reference '${requestedProvider}'. Expected a configured provider or provider alias.`
    );
    (err as any).requestedProvider = requestedProvider;
    (err as any).details = { requestedProvider };
    (err as any).cause = { requestedProvider };
    throw err;
  }
}

export function resolveProviderSelection(
  input: ResolveProviderSelectionInput
): ResolvedProviderSelection {
  const { call, providers, aliases } = input;
  const rawLayers = input.layers || {};
  const layers = {
    cli: rawLayers.cli || {},
    config: rawLayers.config || {},
    builtIn: rawLayers.builtIn || { defaultProvider: "mock", timeoutMs: 900000 }
  };

  // 1. Choose requested provider by presence
  let requestedProvider: string;
  let requestedProviderSource: ProviderReferenceSource;
  let requestedProviderSourcePath: string;

  if (call.provider !== undefined) {
    requestedProvider = call.provider;
    requestedProviderSource = "agent";
    requestedProviderSourcePath = "agent.provider";
  } else if (layers.cli.provider !== undefined) {
    requestedProvider = layers.cli.provider;
    requestedProviderSource = "cli";
    requestedProviderSourcePath = "cli.provider";
  } else if (layers.config.defaultProvider !== undefined) {
    requestedProvider = layers.config.defaultProvider;
    requestedProviderSource = "globalConfig";
    requestedProviderSourcePath = "config.defaultProvider";
  } else {
    requestedProvider = layers.builtIn.defaultProvider;
    requestedProviderSource = "builtIn";
    requestedProviderSourcePath = "builtIn.defaultProvider";
  }

  const ref = resolveProviderReference({
    requestedProvider,
    aliases,
    providers
  });

  const concreteProvider = ref.provider;
  const providerConfig = providers[concreteProvider];

  const overrides: ProviderSettingOverride[] = [];

  // Overrides for provider reference setting itself
  const providerCandidates: Candidate<string>[] = [];
  if (call.provider !== undefined) {
    providerCandidates.push({ value: call.provider, source: "agent", sourcePath: "agent.provider" });
  }
  if (layers.cli.provider !== undefined) {
    providerCandidates.push({ value: layers.cli.provider, source: "cli", sourcePath: "cli.provider" });
  }
  if (layers.config.defaultProvider !== undefined) {
    providerCandidates.push({ value: layers.config.defaultProvider, source: "globalConfig", sourcePath: "config.defaultProvider" });
  }
  if (layers.builtIn.defaultProvider !== undefined) {
    providerCandidates.push({ value: layers.builtIn.defaultProvider, source: "builtIn", sourcePath: "builtIn.defaultProvider" });
  }

  // Record provider setting overrides based on requested provider reference
  selectSettingAndOverrides(providerCandidates, "provider", overrides);

  // Set authoritative provider source setting value
  let providerSourceValue: ProviderSettingValue<string>;
  if (ref.kind === "alias") {
    providerSourceValue = {
      value: concreteProvider,
      source: "providerAlias",
      sourcePath: `providerAliases.${ref.alias.origins.provider}.provider`
    };
  } else {
    const selectedProviderCand = providerCandidates[0]!;
    providerSourceValue = {
      value: concreteProvider,
      source: selectedProviderCand.source,
      sourcePath: selectedProviderCand.sourcePath
    };
  }

  // 2. Model resolution
  const modelCandidates: Candidate<string | null>[] = [];
  if (call.model !== undefined) {
    modelCandidates.push({ value: call.model, source: "agent", sourcePath: "agent.model" });
  }
  if (ref.kind === "alias" && ref.alias.model !== undefined) {
    modelCandidates.push({
      value: ref.alias.model,
      source: "providerAlias",
      sourcePath: `providerAliases.${ref.alias.origins.model}.model`
    });
  }
  if (layers.cli.model !== undefined) {
    modelCandidates.push({ value: layers.cli.model, source: "cli", sourcePath: "cli.model" });
  }
  if (providerConfig && providerConfig.defaultModel !== undefined) {
    modelCandidates.push({
      value: providerConfig.defaultModel,
      source: "providerConfig",
      sourcePath: `providers.${concreteProvider}.defaultModel`
    });
  }
  if (layers.config.defaultModel !== undefined) {
    modelCandidates.push({ value: layers.config.defaultModel, source: "globalConfig", sourcePath: "config.defaultModel" });
  }

  const modelResult = selectSettingAndOverrides(modelCandidates, "model", overrides);

  // 3. Thinking-Effort resolution
  const thinkingCandidates: Candidate<ThinkingEffort>[] = [];
  if (call.thinkingEffort !== undefined) {
    thinkingCandidates.push({ value: call.thinkingEffort, source: "agent", sourcePath: "agent.thinkingEffort" });
  }
  if (ref.kind === "alias" && ref.alias.thinkingEffort !== undefined) {
    thinkingCandidates.push({
      value: ref.alias.thinkingEffort,
      source: "providerAlias",
      sourcePath: `providerAliases.${ref.alias.origins.thinkingEffort}.thinkingEffort`
    });
  }
  if (layers.cli.thinkingEffort !== undefined) {
    thinkingCandidates.push({ value: layers.cli.thinkingEffort, source: "cli", sourcePath: "cli.thinkingEffort" });
  }
  if (providerConfig && providerConfig.defaultThinkingEffort !== undefined) {
    thinkingCandidates.push({
      value: providerConfig.defaultThinkingEffort,
      source: "providerConfig",
      sourcePath: `providers.${concreteProvider}.defaultThinkingEffort`
    });
  }
  if (providerConfig && providerConfig.thinking !== undefined) {
    thinkingCandidates.push({
      value: providerConfig.thinking as ThinkingEffort,
      source: "providerConfig",
      sourcePath: `providers.${concreteProvider}.thinking`
    });
  }

  const thinkingResult = selectSettingAndOverrides(thinkingCandidates, "thinkingEffort", overrides);

  // 4. Timeout resolution
  const timeoutCandidates: Candidate<number>[] = [];
  if (call.timeoutMs !== undefined) {
    timeoutCandidates.push({ value: call.timeoutMs, source: "agent", sourcePath: "agent.timeoutMs" });
  }
  if (ref.kind === "alias" && ref.alias.timeoutMs !== undefined) {
    timeoutCandidates.push({
      value: ref.alias.timeoutMs,
      source: "providerAlias",
      sourcePath: `providerAliases.${ref.alias.origins.timeoutMs}.timeoutMs`
    });
  }
  if (layers.cli.timeoutMs !== undefined) {
    timeoutCandidates.push({ value: layers.cli.timeoutMs, source: "cli", sourcePath: "cli.timeoutMs" });
  }
  if (providerConfig && providerConfig.timeoutMs !== undefined) {
    timeoutCandidates.push({
      value: providerConfig.timeoutMs,
      source: "providerConfig",
      sourcePath: `providers.${concreteProvider}.timeoutMs`
    });
  }
  if (layers.config.timeoutMs !== undefined) {
    timeoutCandidates.push({ value: layers.config.timeoutMs, source: "globalConfig", sourcePath: "config.timeoutMs" });
  }
  if (layers.builtIn.timeoutMs !== undefined) {
    timeoutCandidates.push({ value: layers.builtIn.timeoutMs, source: "builtIn", sourcePath: "builtIn.timeoutMs" });
  }

  const timeoutResult = selectSettingAndOverrides(timeoutCandidates, "timeoutMs", overrides);

  // 5. Retry resolution
  let aliasRetry: RetryPolicyInput | undefined;
  let aliasProvenance: any;
  if (ref.kind === "alias") {
    aliasRetry = ref.alias.retry;
    if (aliasRetry !== undefined) {
      const sourceAlias = ref.alias.origins.retry?.sourceAlias || ref.alias.name;
      aliasProvenance = {
        policyPath: `providerAliases.${sourceAlias}.retry`,
        fieldPaths: {}
      };
      if (ref.alias.origins.retry) {
        const fields: (keyof RetryPolicy)[] = ["maxAttempts", "delayMs", "backoff", "maxDelayMs", "jitter", "disableDelay"];
        for (const f of fields) {
          const definingAlias = ref.alias.origins.retry.fieldSources[f] || sourceAlias;
          aliasProvenance.fieldPaths[f] = `providerAliases.${definingAlias}.retry.${f}`;
        }
      }
    }
  }

  const cliOverrides = layers.cli.retry;
  const hasCliRetryOverrides = cliOverrides && (
    cliOverrides.maxAttempts !== undefined ||
    cliOverrides.delayMs !== undefined ||
    cliOverrides.maxDelayMs !== undefined ||
    cliOverrides.backoff !== undefined ||
    cliOverrides.disableDelay !== undefined ||
    cliOverrides.noRetry !== undefined
  );

  const retryCandidates: Candidate<ResolvedRetryPolicy>[] = [];

  if (call.retry !== undefined) {
    const agentSel = resolveLayeredRetryPolicy({
      agent: call.retry,
      alias: aliasRetry,
      aliasProvenance,
      cli: cliOverrides,
      global: layers.config.retry
    });
    retryCandidates.push({ value: agentSel.value, source: "agent", sourcePath: "agent.retry" });
  }

  if (ref.kind === "alias" && aliasRetry !== undefined) {
    const aliasSel = resolveLayeredRetryPolicy({
      alias: aliasRetry,
      aliasProvenance,
      cli: cliOverrides,
      global: layers.config.retry
    });
    retryCandidates.push({ value: aliasSel.value, source: "providerAlias", sourcePath: aliasProvenance.policyPath });
  }

  if (hasCliRetryOverrides) {
    const cliSel = resolveLayeredRetryPolicy({
      cli: cliOverrides,
      global: layers.config.retry
    });
    retryCandidates.push({ value: cliSel.value, source: "cli", sourcePath: "cli" });
  }

  if (layers.config.retry !== undefined) {
    const globalSel = resolveLayeredRetryPolicy({
      global: layers.config.retry
    });
    retryCandidates.push({ value: globalSel.value, source: "globalConfig", sourcePath: "config.retry" });
  }

  const builtInSel = resolveLayeredRetryPolicy({});
  retryCandidates.push({ value: builtInSel.value, source: "builtIn", sourcePath: "builtIn.retry" });

  const finalRetrySelection = resolveLayeredRetryPolicy({
    agent: call.retry,
    alias: aliasRetry,
    aliasProvenance,
    cli: cliOverrides,
    global: layers.config.retry
  });

  // Record retry setting overrides
  selectSettingAndOverrides(retryCandidates, "retry", overrides, isRetryPolicyEquivalent);

  const retrySourceValue: ProviderSettingValue<ResolvedRetryPolicy> = {
    value: finalRetrySelection.value,
    source: finalRetrySelection.source,
    sourcePath: finalRetrySelection.sourcePath
  };

  const selectionResult: ResolvedProviderSelection = {
    schemaVersion: "open-dynamic-workflow.provider-selection.v1",
    requestedProvider,
    requestedProviderSource,
    ...(ref.kind === "alias" ? {
      providerAlias: ref.alias.name,
      providerAliasChain: ref.alias.inheritanceChain,
      providerAliasDigest: ref.alias.digest
    } : {}),
    provider: concreteProvider,
    ...(modelResult !== undefined ? { model: modelResult.value } : {}),
    ...(thinkingResult !== undefined ? { thinkingEffort: thinkingResult.value } : {}),
    timeoutMs: timeoutResult!.value,
    retry: finalRetrySelection.value,
    sources: {
      provider: providerSourceValue,
      ...(modelResult !== undefined ? { model: modelResult.source } : {}),
      ...(thinkingResult !== undefined ? { thinkingEffort: thinkingResult.source } : {}),
      timeoutMs: timeoutResult!.source,
      retry: retrySourceValue
    },
    retryFieldSources: finalRetrySelection.fieldSources,
    overrides
  };

  return deepFreeze(selectionResult);
}

export function toProviderSelectionArtifact(
  selection: ResolvedProviderSelection
): ResolvedProviderSelectionArtifact {
  const artifact: ResolvedProviderSelectionArtifact = {
    schemaVersion: "open-dynamic-workflow.provider-selection.v1",
    selection: {
      requestedProvider: selection.requestedProvider,
      requestedProviderSource: selection.requestedProviderSource,
      ...(selection.providerAlias !== undefined ? { providerAlias: selection.providerAlias } : {}),
      ...(selection.providerAliasChain !== undefined ? { providerAliasChain: [...selection.providerAliasChain] } : {}),
      ...(selection.providerAliasDigest !== undefined ? { providerAliasDigest: selection.providerAliasDigest } : {}),
      resolvedProvider: selection.provider
    },
    resolvedExecution: {
      ...(selection.model !== undefined ? { model: selection.model } : {}),
      ...(selection.thinkingEffort !== undefined ? { thinkingEffort: selection.thinkingEffort } : {}),
      timeoutMs: selection.timeoutMs,
      retry: {
        enabled: selection.retry.enabled,
        maxAttempts: selection.retry.policy.maxAttempts,
        delayMs: selection.retry.policy.delayMs,
        backoff: selection.retry.policy.backoff,
        maxDelayMs: selection.retry.policy.maxDelayMs,
        jitter: selection.retry.policy.jitter,
        disableDelay: selection.retry.policy.disableDelay
      }
    },
    sources: {
      provider: selection.sources.provider.source,
      ...(selection.sources.model !== undefined ? { model: selection.sources.model.source } : {}),
      ...(selection.sources.thinkingEffort !== undefined ? { thinkingEffort: selection.sources.thinkingEffort.source } : {}),
      timeoutMs: selection.sources.timeoutMs.source,
      retry: selection.sources.retry.source
    }
  };
  return deepFreeze(artifact);
}
