import type {
  RetryPolicy,
  RetryConfigInput,
  RetryPolicyInput,
  ResolvedRetryPolicy
} from "../types/retry.js";

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
