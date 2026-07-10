import { createHash } from "node:crypto";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { isThinkingEffort, type ThinkingEffort } from "../types/thinking-effort.js";
import type { RetryPolicy, RetryPolicyInput } from "../types/retry.js";
import type { ProviderConfig } from "./types.js";

// --- Types Defined by Developer A & B Contracts ---

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

export interface ResolveProviderAliasesInput {
  rawAliases: unknown;
  providers: Readonly<Record<string, ProviderConfig>>;
  builtInProviderNames: ReadonlySet<string>;
  maxDepth: number;
}

export interface ResolveProviderAliasesResult {
  aliases: ResolvedProviderAliasRegistry;
}

export interface ResolvedProviderAliasArtifact {
  name: string;
  inheritanceChain: readonly string[];
  provider: string;
  model?: string | null | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  timeoutMs?: number | undefined;
  retry?: RetryPolicyInput | undefined;
  digest: string;
}

// Helper to validate and normalize objects securely
function safeNormalizeObject(obj: unknown, path: string): Record<string, any> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new OpenDynamicWorkflowError(
      "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
      `Config value '${path}' must be an object.`
    );
  }
  
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new OpenDynamicWorkflowError(
      "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
      `Config value '${path}' has an invalid prototype.`
    );
  }

  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new OpenDynamicWorkflowError(
      "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
      `Config value '${path}' contains symbol keys.`
    );
  }

  // Check inherited enumerable properties
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
        `Config value '${path}' contains inherited enumerable property '${key}'.`
      );
    }
  }

  const descriptors = Object.getOwnPropertyDescriptors(obj);
  const ownKeys = Object.getOwnPropertyNames(obj);
  const result = Object.create(null);

  for (const key of ownKeys) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
        `Config value '${path}' contains dangerous key '${key}'.`
      );
    }
    const desc = descriptors[key];
    if (!desc) {
      continue;
    }
    if (!desc.enumerable) {
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
        `Config value '${path}' contains non-enumerable property '${key}'.`
      );
    }
    if (desc.get || desc.set) {
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
        `Config value '${path}' contains accessor property '${key}'.`
      );
    }
    result[key] = desc.value;
  }

  return result;
}

// Deep freeze helper
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as any)[key];
    deepFreeze(val);
  }
  return obj;
}

const RETRY_FIELD_ORDER = [
  "maxAttempts",
  "delayMs",
  "backoff",
  "maxDelayMs",
  "jitter",
  "disableDelay"
] as const;

function canonicalizeRetry(retry: RetryPolicyInput): RetryPolicyInput {
  if (retry === false) {
    return false;
  }
  const result = Object.create(null);
  for (const field of RETRY_FIELD_ORDER) {
    if (field in retry) {
      const val = (retry as any)[field];
      if (val !== undefined) {
        result[field] = val;
      }
    }
  }
  return result;
}

function buildRootToSelectedChain(startName: string, safeRawAliases: Record<string, any>): string[] {
  const chain: string[] = [];
  let current: string | undefined = startName;
  const visited = new Set<string>();

  while (current && current in safeRawAliases) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    chain.push(current);
    const rawDef: any = safeRawAliases[current];
    current = rawDef && typeof rawDef === "object" ? rawDef.extends : undefined;
  }
  return chain.reverse();
}

// Compute deterministic SHA-256 digest
function computeDigest(
  name: string,
  inheritanceChain: readonly string[],
  provider: string,
  model: string | null | undefined,
  thinkingEffort: ThinkingEffort | undefined,
  timeoutMs: number | undefined,
  retry: RetryPolicyInput | undefined
): string {
  const material: any = {};
  material.schemaVersion = "open-dynamic-workflow.provider-alias-digest.v1";
  material.name = name;
  material.inheritanceChain = inheritanceChain;
  material.provider = provider;
  
  if (model !== undefined) {
    material.model = model;
  }
  if (thinkingEffort !== undefined) {
    material.thinkingEffort = thinkingEffort;
  }
  if (timeoutMs !== undefined) {
    material.timeoutMs = timeoutMs;
  }
  if (retry !== undefined) {
    if (retry === false) {
      material.retry = false;
    } else {
      const normalizedRetry: any = {};
      for (const k of RETRY_FIELD_ORDER) {
        if (k in retry) {
          normalizedRetry[k] = retry[k];
        }
      }
      material.retry = normalizedRetry;
    }
  }

  const jsonStr = JSON.stringify(material);
  const hash = createHash("sha256").update(jsonStr).digest("hex");
  return `sha256:${hash}`;
}

export function resolveProviderAliases(
  input: ResolveProviderAliasesInput
): ResolveProviderAliasesResult {
  // 1. Validate maxDepth
  if (typeof input.maxDepth !== "number" || !Number.isInteger(input.maxDepth) || input.maxDepth <= 0) {
    throw new OpenDynamicWorkflowError(
      "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
      `providerAliasMaxDepth must be a positive integer.`
    );
  }

  // 2. Treat omitted rawAliases as empty registry
  if (input.rawAliases === undefined || input.rawAliases === null) {
    const registry = Object.create(null);
    Object.freeze(registry);
    const result = { aliases: registry };
    Object.freeze(result);
    return result;
  }

  // 3. Validate rawAliases is a safe object
  const safeRawAliases = safeNormalizeObject(input.rawAliases, "providerAliases");
  const aliasKeys = Object.keys(safeRawAliases);
  const aliasNameRegex = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

  // 4. Validate names and raw definitions
  for (const name of aliasKeys) {
    if (name.length < 1 || name.length > 128 || !aliasNameRegex.test(name)) {
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
        `Invalid provider alias name: '${name}'.`
      );
    }

    const path = `providerAliases.${name}`;
    const safeDef = safeNormalizeObject(safeRawAliases[name], path);

    const allowedFields = new Set([
      "provider",
      "extends",
      "model",
      "thinkingEffort",
      "timeoutMs",
      "retry"
    ]);
    for (const field of Object.keys(safeDef)) {
      if (!allowedFields.has(field)) {
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
          `Config value '${path}.${field}' is not allowed.`
        );
      }
    }

    if ("provider" in safeDef) {
      const p = safeDef.provider;
      if (typeof p !== "string" || p.trim().length === 0) {
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
          `Config value '${path}.provider' must be a non-empty string.`
        );
      }
    }
    if ("extends" in safeDef) {
      const ext = safeDef.extends;
      if (typeof ext !== "string" || ext.trim().length === 0) {
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
          `Config value '${path}.extends' must be a non-empty string.`
        );
      }
    }
    if ("model" in safeDef) {
      const m = safeDef.model;
      if (m !== null && typeof m !== "string") {
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
          `Config value '${path}.model' must be a string or null.`
        );
      }
    }
    if ("thinkingEffort" in safeDef) {
      const te = safeDef.thinkingEffort;
      if (!isThinkingEffort(te)) {
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
          `Config value '${path}.thinkingEffort' must be a valid thinking effort value.`
        );
      }
    }
    if ("timeoutMs" in safeDef) {
      const t = safeDef.timeoutMs;
      if (typeof t !== "number" || !Number.isInteger(t) || t <= 0) {
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
          `Config value '${path}.timeoutMs' must be a positive integer.`
        );
      }
    }
    if ("retry" in safeDef) {
      const r = safeDef.retry;
      if (r !== false) {
        const safeRetry = safeNormalizeObject(r, `${path}.retry`);
        const allowedRetryFields = new Set([
          "maxAttempts",
          "delayMs",
          "maxDelayMs",
          "backoff",
          "jitter",
          "disableDelay"
        ]);
        for (const k of Object.keys(safeRetry)) {
          if (!allowedRetryFields.has(k)) {
            if (k === "retryOn" || k === "retryReasons" || k === "retryOnErrors" || k === "errorCategories") {
              throw new OpenDynamicWorkflowError(
                "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
                `${k} is not supported in experimental retry v1. Retry eligibility is runtime-defined; configure maxAttempts and delay behavior only.`
              );
            }
            throw new OpenDynamicWorkflowError(
              "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
              `Config value '${path}.retry.${k}' is not allowed.`
            );
          }
        }
        if ("maxAttempts" in safeRetry) {
          const val = safeRetry.maxAttempts;
          if (typeof val !== "number" || !Number.isInteger(val) || val <= 0) {
            throw new OpenDynamicWorkflowError(
              "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
              `Config value '${path}.retry.maxAttempts' must be a positive integer.`
            );
          }
        }
        if ("delayMs" in safeRetry) {
          const val = safeRetry.delayMs;
          if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
            throw new OpenDynamicWorkflowError(
              "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
              `Config value '${path}.retry.delayMs' must be a non-negative integer.`
            );
          }
        }
        if ("maxDelayMs" in safeRetry) {
          const val = safeRetry.maxDelayMs;
          if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
            throw new OpenDynamicWorkflowError(
              "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
              `Config value '${path}.retry.maxDelayMs' must be a non-negative integer.`
            );
          }
        }
        if ("backoff" in safeRetry) {
          const val = safeRetry.backoff;
          if (val !== "fixed" && val !== "exponential") {
            throw new OpenDynamicWorkflowError(
              "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
              `Config value '${path}.retry.backoff' must be 'fixed' or 'exponential'.`
            );
          }
        }
        if ("jitter" in safeRetry) {
          const val = safeRetry.jitter;
          if (typeof val !== "boolean") {
            throw new OpenDynamicWorkflowError(
              "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
              `Config value '${path}.retry.jitter' must be a boolean.`
            );
          }
        }
        if ("disableDelay" in safeRetry) {
          const val = safeRetry.disableDelay;
          if (typeof val !== "boolean") {
            throw new OpenDynamicWorkflowError(
              "PROVIDER_ALIAS_INVALID_DEFINITION" as any,
              `Config value '${path}.retry.disableDelay' must be a boolean.`
            );
          }
        }
      }
    }
  }

  // 5. Check namespace collisions before graph traversal
  const sortedCollisionKeys = [...aliasKeys].sort();
  for (const name of sortedCollisionKeys) {
    if (input.builtInProviderNames.has(name)) {
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_NAMESPACE_CONFLICT" as any,
        `Alias '${name}' collides with a built-in provider name.`,
        { cause: { alias: name, collisionType: "built-in" } }
      );
    }
    if (name in input.providers) {
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_NAMESPACE_CONFLICT" as any,
        `Alias '${name}' collides with configured provider '${name}'.`,
        { cause: { alias: name, collisionType: "configured-provider" } }
      );
    }
  }

  // 6. DFS Graph Resolution
  const sortedNames = [...aliasKeys].sort();
  const state: Record<string, "unvisited" | "visiting" | "resolved"> = Object.create(null);
  for (const name of sortedNames) {
    state[name] = "unvisited";
  }
  const resolved: Record<string, ResolvedProviderAlias> = Object.create(null);

  function resolveAlias(name: string, stack: string[]): ResolvedProviderAlias {
    if (state[name] === "resolved") {
      return resolved[name]!;
    }
    if (state[name] === "visiting") {
      const cycleStartIdx = stack.indexOf(name);
      const cycleChain = [...stack.slice(cycleStartIdx), name];
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_CYCLE_DETECTED" as any,
        `Cycle detected: ${cycleChain.join(" -> ")}`,
        { cause: { inheritanceChain: cycleChain } }
      );
    }

    if (stack.length + 1 > input.maxDepth) {
      const selectedLeaf = stack[0] || name;
      const attemptedChain = buildRootToSelectedChain(selectedLeaf, safeRawAliases);
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED" as any,
        `Max depth of ${input.maxDepth} exceeded by chain: ${attemptedChain.join(" -> ")}`,
        { cause: { inheritanceChain: attemptedChain, limit: input.maxDepth } }
      );
    }

    state[name] = "visiting";
    const rawDef = safeNormalizeObject(safeRawAliases[name], `providerAliases.${name}`);

    let parentResolved: ResolvedProviderAlias | undefined = undefined;
    if ("extends" in rawDef) {
      const parentName = rawDef.extends;
      if (!(parentName in safeRawAliases)) {
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_PARENT_NOT_FOUND" as any,
          `Parent alias '${parentName}' not found for alias '${name}'.`,
          { cause: { alias: name, parent: parentName } }
        );
      }
      parentResolved = resolveAlias(parentName, [...stack, name]);

      if (parentResolved.inheritanceChain.length + 1 > input.maxDepth) {
        const attemptedChain = buildRootToSelectedChain(name, safeRawAliases);
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED" as any,
          `Max depth of ${input.maxDepth} exceeded by chain: ${attemptedChain.join(" -> ")}`,
          { cause: { inheritanceChain: attemptedChain, limit: input.maxDepth } }
        );
      }
    }

    // Merge parent & child
    let provider: string;
    let providerSource: string;

    if (parentResolved !== undefined) {
      if (!("provider" in rawDef)) {
        provider = parentResolved.provider;
        providerSource = parentResolved.origins.provider;
      } else {
        const childProvider = rawDef.provider;
        if (childProvider === parentResolved.provider) {
          provider = parentResolved.provider;
          providerSource = parentResolved.origins.provider;
        } else {
          throw new OpenDynamicWorkflowError(
            "PROVIDER_ALIAS_PROVIDER_REPLACEMENT" as any,
            `Alias '${name}' cannot replace inherited provider '${parentResolved.provider}' with '${childProvider}'.`,
            { cause: { alias: name, parentProvider: parentResolved.provider, childProvider } }
          );
        }
      }
    } else {
      if (!("provider" in rawDef)) {
        throw new OpenDynamicWorkflowError(
          "PROVIDER_ALIAS_PROVIDER_REQUIRED" as any,
          `Alias '${name}' is a root alias and must specify a 'provider'.`,
          { cause: { alias: name } }
        );
      }
      provider = rawDef.provider;
      providerSource = name;
    }

    // Require concrete provider to exist in input.providers
    if (!(provider in input.providers)) {
      throw new OpenDynamicWorkflowError(
        "PROVIDER_ALIAS_PROVIDER_NOT_FOUND" as any,
        `Provider '${provider}' not found for alias '${name}'.`,
        { cause: { alias: name, provider } }
      );
    }

    // Merge model
    let model: string | null | undefined = undefined;
    let modelSource: string | undefined = undefined;
    if ("model" in rawDef) {
      model = rawDef.model;
      modelSource = name;
    } else if (parentResolved && parentResolved.model !== undefined) {
      model = parentResolved.model;
      modelSource = parentResolved.origins.model;
    }

    // Merge thinkingEffort
    let thinkingEffort: ThinkingEffort | undefined = undefined;
    let thinkingEffortSource: string | undefined = undefined;
    if ("thinkingEffort" in rawDef) {
      thinkingEffort = rawDef.thinkingEffort;
      thinkingEffortSource = name;
    } else if (parentResolved && parentResolved.thinkingEffort !== undefined) {
      thinkingEffort = parentResolved.thinkingEffort;
      thinkingEffortSource = parentResolved.origins.thinkingEffort;
    }

    // Merge timeoutMs
    let timeoutMs: number | undefined = undefined;
    let timeoutMsSource: string | undefined = undefined;
    if ("timeoutMs" in rawDef) {
      timeoutMs = rawDef.timeoutMs;
      timeoutMsSource = name;
    } else if (parentResolved && parentResolved.timeoutMs !== undefined) {
      timeoutMs = parentResolved.timeoutMs;
      timeoutMsSource = parentResolved.origins.timeoutMs;
    }

    // Merge retry
    let retry: RetryPolicyInput | undefined = undefined;
    let retryProvenance: ProviderAliasRetryProvenance | undefined = undefined;

    if ("retry" in rawDef) {
      const childRetry = rawDef.retry;
      if (childRetry === false) {
        retry = false;
        retryProvenance = {
          sourceAlias: name,
          fieldSources: Object.create(null)
        };
      } else {
        if (parentResolved && parentResolved.retry && (parentResolved.retry as any) !== false) {
          const tempMerged = { ...parentResolved.retry, ...childRetry };
          retry = canonicalizeRetry(tempMerged);

          const fieldSources = Object.create(null);
          if (parentResolved.origins.retry) {
            Object.assign(fieldSources, parentResolved.origins.retry.fieldSources);
          }
          for (const k of Object.keys(childRetry)) {
            fieldSources[k] = name;
          }
          retryProvenance = {
            sourceAlias: name,
            fieldSources
          };
        } else {
          retry = canonicalizeRetry(childRetry);
          const fieldSources = Object.create(null);
          for (const k of Object.keys(childRetry)) {
            fieldSources[k] = name;
          }
          retryProvenance = {
            sourceAlias: name,
            fieldSources
          };
        }
      }
    } else {
      if (parentResolved && parentResolved.retry !== undefined) {
        retry = canonicalizeRetry(parentResolved.retry);
        if (parentResolved.origins.retry) {
          retryProvenance = {
            sourceAlias: parentResolved.origins.retry.sourceAlias,
            fieldSources: { ...parentResolved.origins.retry.fieldSources }
          };
        }
      }
    }

    const inheritanceChain = parentResolved 
      ? [...parentResolved.inheritanceChain, name]
      : [name];

    const origins: any = Object.create(null);
    origins.provider = providerSource;
    if (modelSource !== undefined) origins.model = modelSource;
    if (thinkingEffortSource !== undefined) origins.thinkingEffort = thinkingEffortSource;
    if (timeoutMsSource !== undefined) origins.timeoutMs = timeoutMsSource;
    if (retryProvenance !== undefined) origins.retry = retryProvenance;

    const digest = computeDigest(
      name,
      inheritanceChain,
      provider,
      model,
      thinkingEffort,
      timeoutMs,
      retry
    );

    const resolvedAlias: ResolvedProviderAlias = {
      name,
      inheritanceChain,
      provider,
      origins,
      digest
    };
    if (model !== undefined) {
      resolvedAlias.model = model;
    }
    if (thinkingEffort !== undefined) {
      resolvedAlias.thinkingEffort = thinkingEffort;
    }
    if (timeoutMs !== undefined) {
      resolvedAlias.timeoutMs = timeoutMs;
    }
    if (retry !== undefined) {
      resolvedAlias.retry = retry;
    }

    state[name] = "resolved";
    resolved[name] = deepFreeze(resolvedAlias);
    return resolved[name];
  }

  for (const name of sortedNames) {
    resolveAlias(name, []);
  }

  const registry = Object.create(null);
  for (const name of sortedNames) {
    registry[name] = resolved[name];
  }
  deepFreeze(registry);

  const result = { aliases: registry };
  Object.freeze(result);
  return result;
}

export function toResolvedProviderAliasArtifactRegistry(
  registry: ResolvedProviderAliasRegistry
): Readonly<Record<string, ResolvedProviderAliasArtifact>> {
  const result = Object.create(null);
  const sortedKeys = Object.keys(registry).sort();
  for (const key of sortedKeys) {
    const alias = registry[key];
    if (!alias) {
      continue;
    }
    const artifact: ResolvedProviderAliasArtifact = {
      name: alias.name,
      inheritanceChain: [...alias.inheritanceChain],
      provider: alias.provider,
      digest: alias.digest
    };
    if (alias.model !== undefined) {
      artifact.model = alias.model;
    }
    if (alias.thinkingEffort !== undefined) {
      artifact.thinkingEffort = alias.thinkingEffort;
    }
    if (alias.timeoutMs !== undefined) {
      artifact.timeoutMs = alias.timeoutMs;
    }
    if (alias.retry !== undefined) {
      if (alias.retry === false) {
        artifact.retry = false;
      } else {
        artifact.retry = deepFreeze(canonicalizeRetry(alias.retry));
      }
    }
    result[key] = Object.freeze(artifact);
  }
  Object.freeze(result);
  return result;
}
