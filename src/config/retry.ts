import type {
  RetryPolicy,
  RetryConfigInput,
  RetryPolicyInput,
  ResolvedRetryPolicy
} from "../types/retry.js";
import type {
  ProviderSettingSource,
  ProviderSettingValue,
  ResolvedRetrySelection
} from "../types/provider-selection.js";

export interface RetryCliOverrides {
  maxAttempts?: number | undefined;
  delayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  backoff?: "fixed" | "exponential" | undefined;
  disableDelay?: boolean | undefined;
  noRetry?: boolean | undefined;
}

export const BUILT_IN_DEFAULT_POLICY: RetryPolicy = {
  maxAttempts: 1,
  delayMs: 1000,
  backoff: "exponential",
  maxDelayMs: 30000,
  jitter: true,
  disableDelay: false
};

export const RECOMMENDED_ENABLED_DEFAULTS: RetryPolicy = {
  maxAttempts: 3,
  delayMs: 1000,
  backoff: "exponential",
  maxDelayMs: 30000,
  jitter: true,
  disableDelay: false
};

function normalizePolicy(p: Partial<RetryPolicy>): RetryPolicy {
  return {
    maxAttempts: p.maxAttempts ?? 1,
    delayMs: p.delayMs ?? 1000,
    backoff: p.backoff ?? "exponential",
    maxDelayMs: p.maxDelayMs ?? 30000,
    jitter: p.jitter ?? true,
    disableDelay: p.disableDelay ?? false
  };
}

export function resolveGlobalRetryPolicy(input: {
  configRetry?: false | RetryConfigInput | ResolvedRetryPolicy | undefined;
  cliOverrides?: RetryCliOverrides | undefined;
}): ResolvedRetryPolicy {
  const { configRetry, cliOverrides } = input;

  if (configRetry === false) {
    return {
      enabled: false,
      policy: { ...BUILT_IN_DEFAULT_POLICY },
      source: "disabled"
    };
  }

  // 1. Establish base policy from config/default
  let basePolicy: RetryPolicy;
  let baseEnabled = false;
  let baseSource: "default" | "config" | "disabled" = "default";
  let baseDisabledBy: "omitted" | undefined = undefined;

  if (configRetry === undefined) {
    basePolicy = { ...BUILT_IN_DEFAULT_POLICY };
    baseEnabled = false;
    baseSource = "default";
    baseDisabledBy = "omitted";
  } else if ("policy" in configRetry) {
    // If it's already a ResolvedRetryPolicy, inherit it
    basePolicy = { ...configRetry.policy };
    baseEnabled = configRetry.enabled;
    baseSource = configRetry.source as any;
  } else {
    // It's a RetryConfigInput object
    basePolicy = normalizePolicy({
      ...RECOMMENDED_ENABLED_DEFAULTS,
      ...configRetry
    });
    baseEnabled = basePolicy.maxAttempts > 1;
    baseSource = "config";
  }

  // 2. Apply CLI overrides
  let finalPolicy = { ...basePolicy };
  let finalEnabled = baseEnabled;
  let finalSource: "default" | "config" | "cli" | "disabled" = baseSource;
  let finalDisabledBy: "omitted" | "cli" | undefined = baseDisabledBy;

  if (cliOverrides?.noRetry) {
    finalPolicy.maxAttempts = 1;
    finalEnabled = false;
    finalSource = "cli";
    finalDisabledBy = "cli";
    if (cliOverrides.disableDelay !== undefined) {
      finalPolicy.disableDelay = cliOverrides.disableDelay;
    }
  } else {
    const hasCliOverrides =
      cliOverrides?.maxAttempts !== undefined ||
      cliOverrides?.delayMs !== undefined ||
      cliOverrides?.maxDelayMs !== undefined ||
      cliOverrides?.backoff !== undefined ||
      cliOverrides?.disableDelay !== undefined;

    if (hasCliOverrides) {
      // If we had no config/default retry enabled, merge overrides into RECOMMENDED_ENABLED_DEFAULTS
      const mergeBase = (baseSource === "default" || baseSource === "disabled")
        ? RECOMMENDED_ENABLED_DEFAULTS
        : basePolicy;

      finalPolicy = normalizePolicy({
        ...mergeBase,
        ...(cliOverrides?.maxAttempts !== undefined ? { maxAttempts: cliOverrides.maxAttempts } : {}),
        ...(cliOverrides?.delayMs !== undefined ? { delayMs: cliOverrides.delayMs } : {}),
        ...(cliOverrides?.maxDelayMs !== undefined ? { maxDelayMs: cliOverrides.maxDelayMs } : {}),
        ...(cliOverrides?.backoff !== undefined ? { backoff: cliOverrides.backoff } : {}),
        ...(cliOverrides?.disableDelay !== undefined ? { disableDelay: cliOverrides.disableDelay } : {})
      });
      finalEnabled = finalPolicy.maxAttempts > 1;
      finalSource = "cli";
      finalDisabledBy = finalEnabled ? undefined : "omitted";
    }
  }

  // Guarantee key order and deterministic shape
  return {
    enabled: finalEnabled,
    policy: {
      maxAttempts: finalPolicy.maxAttempts,
      delayMs: finalPolicy.delayMs,
      backoff: finalPolicy.backoff,
      maxDelayMs: finalPolicy.maxDelayMs,
      jitter: finalPolicy.jitter,
      disableDelay: finalPolicy.disableDelay
    },
    source: finalSource,
    ...(finalDisabledBy ? { disabledBy: finalDisabledBy } : {})
  };
}

export function resolveAgentRetryPolicy(input: {
  globalPolicy: ResolvedRetryPolicy;
  agentRetry?: RetryPolicyInput | undefined;
}): ResolvedRetryPolicy {
  const { globalPolicy, agentRetry } = input;

  const globalPolicyIsHardDisabled =
    globalPolicy.source === "disabled";

  if (globalPolicyIsHardDisabled) {
    return {
      enabled: false,
      policy: { ...globalPolicy.policy },
      source: globalPolicy.source,
      ...(globalPolicy.disabledBy ? { disabledBy: globalPolicy.disabledBy } : {})
    };
  }

  if (agentRetry === undefined) {
    return {
      enabled: globalPolicy.enabled,
      policy: { ...globalPolicy.policy },
      source: globalPolicy.source,
      ...(globalPolicy.disabledBy ? { disabledBy: globalPolicy.disabledBy } : {})
    };
  }

  if (agentRetry === false) {
    return {
      enabled: false,
      policy: { ...BUILT_IN_DEFAULT_POLICY },
      source: "disabled",
      disabledBy: "agent"
    };
  }

  // agentRetry is a Partial<RetryPolicy>
  // Merge agent fields over global policy. If global policy was not enabled, start from RECOMMENDED_ENABLED_DEFAULTS
  const mergeBase = globalPolicy.enabled ? globalPolicy.policy : RECOMMENDED_ENABLED_DEFAULTS;

  const merged = normalizePolicy({
    ...mergeBase,
    ...agentRetry
  });

  const enabled = merged.maxAttempts > 1;

  return {
    enabled,
    policy: {
      maxAttempts: merged.maxAttempts,
      delayMs: merged.delayMs,
      backoff: merged.backoff,
      maxDelayMs: merged.maxDelayMs,
      jitter: merged.jitter,
      disableDelay: merged.disableDelay
    },
    source: "agent",
    ...(!enabled ? { disabledBy: "agent" } : {})
  };
}

export function resolveLayeredRetryPolicy(input: {
  agent?: RetryPolicyInput | undefined;
  alias?: RetryPolicyInput | undefined;
  aliasProvenance?: {
    policyPath: string;
    fieldPaths: Partial<Record<keyof RetryPolicy, string>>;
  } | undefined;
  cli?: RetryCliOverrides | undefined;
  global?: false | RetryConfigInput | undefined;
}): ResolvedRetrySelection {
  // We apply precedence from highest to lowest:
  // agent.retry > alias.retry > CLI retry flags > config.retry > built-in no-retry

  // State initialization with built-in default layer
  let enabled = false;
  let policy: RetryPolicy = { ...BUILT_IN_DEFAULT_POLICY };
  let source: ProviderSettingSource = "builtIn";
  let sourcePath = "builtIn.retry";
  let disabledBy: "omitted" | "cli" | "agent" | undefined = "omitted";

  const fieldSources: Record<keyof RetryPolicy, ProviderSettingValue> = {
    maxAttempts: { value: BUILT_IN_DEFAULT_POLICY.maxAttempts, source: "builtIn", sourcePath: "builtIn.retry" },
    delayMs: { value: BUILT_IN_DEFAULT_POLICY.delayMs, source: "builtIn", sourcePath: "builtIn.retry" },
    backoff: { value: BUILT_IN_DEFAULT_POLICY.backoff, source: "builtIn", sourcePath: "builtIn.retry" },
    maxDelayMs: { value: BUILT_IN_DEFAULT_POLICY.maxDelayMs, source: "builtIn", sourcePath: "builtIn.retry" },
    jitter: { value: BUILT_IN_DEFAULT_POLICY.jitter, source: "builtIn", sourcePath: "builtIn.retry" },
    disableDelay: { value: BUILT_IN_DEFAULT_POLICY.disableDelay, source: "builtIn", sourcePath: "builtIn.retry" }
  };

  // Helper to handle object layer merge
  const applyObjectLayer = (
    layerValue: Partial<RetryPolicy>,
    layerSource: ProviderSettingSource,
    layerPolicyPath: string,
    layerFieldPaths?: Partial<Record<keyof RetryPolicy, string>>
  ) => {
    // If transitioning from disabled to enabled, seed missing fields from RECOMMENDED_ENABLED_DEFAULTS
    const needsSeed = !enabled;
    
    if (needsSeed) {
      enabled = true;
      disabledBy = undefined;
      // Seed all fields first
      for (const field of Object.keys(BUILT_IN_DEFAULT_POLICY) as Array<keyof RetryPolicy>) {
        (policy as any)[field] = RECOMMENDED_ENABLED_DEFAULTS[field];
        fieldSources[field] = {
          value: RECOMMENDED_ENABLED_DEFAULTS[field],
          source: layerSource,
          sourcePath: layerFieldPaths?.[field] ?? layerPolicyPath
        };
      }
    }

    // Merge explicitly defined fields in layerValue
    for (const [key, val] of Object.entries(layerValue)) {
      const field = key as keyof RetryPolicy;
      if (val !== undefined) {
        (policy as any)[field] = val;
        fieldSources[field] = {
          value: val,
          source: layerSource,
          sourcePath: layerFieldPaths?.[field] ?? `${layerPolicyPath}.${field}`
        };
      }
    }

    // Recalculate enabled status based on final maxAttempts
    enabled = policy.maxAttempts > 1;
    if (!enabled) {
      if (layerSource === "agent") disabledBy = "agent";
      else if (layerSource === "cli") disabledBy = "cli";
      else disabledBy = "omitted";
    } else {
      disabledBy = undefined;
    }
    source = layerSource;
    sourcePath = layerPolicyPath;
  };

  const applyDisableLayer = (layerSource: ProviderSettingSource, layerPolicyPath: string, disabledReason: "cli" | "agent" | "omitted") => {
    enabled = false;
    disabledBy = disabledReason;
    policy = { ...BUILT_IN_DEFAULT_POLICY };
    source = layerSource;
    sourcePath = layerPolicyPath;
    for (const field of Object.keys(BUILT_IN_DEFAULT_POLICY) as Array<keyof RetryPolicy>) {
      fieldSources[field] = {
        value: BUILT_IN_DEFAULT_POLICY[field],
        source: layerSource,
        sourcePath: layerPolicyPath
      };
    }
  };

  // Layer 4: global
  if (input.global === false) {
    applyDisableLayer("globalConfig", "config.retry", "omitted");
  } else if (input.global !== undefined) {
    applyObjectLayer(input.global, "globalConfig", "config.retry");
  }

  // Layer 3: cli
  if (input.cli !== undefined) {
    if (input.cli.noRetry) {
      applyDisableLayer("cli", "cli.noRetry", "cli");
      if (input.cli.disableDelay !== undefined) {
        policy.disableDelay = input.cli.disableDelay;
        fieldSources.disableDelay = { value: input.cli.disableDelay, source: "cli", sourcePath: "cli.retryDisableDelay" };
      }
    } else {
      const hasCliOverrides =
        input.cli.maxAttempts !== undefined ||
        input.cli.delayMs !== undefined ||
        input.cli.maxDelayMs !== undefined ||
        input.cli.backoff !== undefined ||
        input.cli.disableDelay !== undefined;

      if (hasCliOverrides) {
        const overrides: Partial<RetryPolicy> = {};
        const fieldPaths: Partial<Record<keyof RetryPolicy, string>> = {};
        
        if (input.cli.maxAttempts !== undefined) {
          overrides.maxAttempts = input.cli.maxAttempts;
          fieldPaths.maxAttempts = "cli.retryMaxAttempts";
        }
        if (input.cli.delayMs !== undefined) {
          overrides.delayMs = input.cli.delayMs;
          fieldPaths.delayMs = "cli.retryDelayMs";
        }
        if (input.cli.maxDelayMs !== undefined) {
          overrides.maxDelayMs = input.cli.maxDelayMs;
          fieldPaths.maxDelayMs = "cli.retryMaxDelayMs";
        }
        if (input.cli.backoff !== undefined) {
          overrides.backoff = input.cli.backoff;
          fieldPaths.backoff = "cli.retryBackoff";
        }
        if (input.cli.disableDelay !== undefined) {
          overrides.disableDelay = input.cli.disableDelay;
          fieldPaths.disableDelay = "cli.retryDisableDelay";
        }

        applyObjectLayer(overrides, "cli", "cli.retry", fieldPaths);
      }
    }
  }

  // Layer 2: alias
  if (input.alias === false) {
    const policyPath = input.aliasProvenance?.policyPath ?? "providerAliases.unknown.retry";
    applyDisableLayer("providerAlias", policyPath, "omitted");
  } else if (input.alias !== undefined) {
    const policyPath = input.aliasProvenance?.policyPath ?? "providerAliases.unknown.retry";
    applyObjectLayer(input.alias, "providerAlias", policyPath, input.aliasProvenance?.fieldPaths);
  }

  // Layer 1: agent
  if (input.agent === false) {
    applyDisableLayer("agent", "agent.retry", "agent");
  } else if (input.agent !== undefined) {
    applyObjectLayer(input.agent, "agent", "agent.retry");
  }

  // Ensure canonical policy field order: maxAttempts, delayMs, backoff, maxDelayMs, jitter, disableDelay
  const finalResolvedPolicy: ResolvedRetryPolicy = {
    enabled,
    policy: {
      maxAttempts: policy.maxAttempts,
      delayMs: policy.delayMs,
      backoff: policy.backoff,
      maxDelayMs: policy.maxDelayMs,
      jitter: policy.jitter,
      disableDelay: policy.disableDelay
    },
    source: (enabled ? source : "disabled") as any,
    ...(disabledBy ? { disabledBy } : {})
  };

  Object.freeze(finalResolvedPolicy.policy);
  Object.freeze(finalResolvedPolicy);
  Object.freeze(fieldSources);

  return Object.freeze({
    value: finalResolvedPolicy,
    source,
    sourcePath,
    fieldSources
  });
}
