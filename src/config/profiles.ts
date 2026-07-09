import { createHash } from "crypto";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import {
  validateProfileName,
  validateWorkflowProfile,
  validateResolvedWorkflowProfile
} from "./schema.js";
import type { LoadedProfilesFile } from "./profile-file.js";
import type {
  WorkflowProfile,
  ResolvedWorkflowProfile,
  ProfileCatalogEntry,
  ProfileDiagnostic,
  ResolvedProfileSelection,
  ProfileSource,
  WorkflowProfileCatalog,
  ProfileName,
  WorkflowProfileRunOptions
} from "./types.js";
import type { JsonObject } from "../types/common.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";
import type { ConfigCliOverrides } from "./merge.js";

function hasOwn(obj: any, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export interface BuildProfileCatalogInput {
  configProfiles?: WorkflowProfileCatalog | undefined;
  configPath?: string | undefined;
  externalProfiles?: LoadedProfilesFile | undefined;
}

export interface BuildProfileCatalogResult {
  catalog: Record<string, ProfileCatalogEntry>;
  diagnostics: ProfileDiagnostic[];
}

/**
 * Builds a merged profile catalog from project config profiles and external profiles.
 * External profiles override config profiles of the same name and trigger a warning diagnostic.
 */
export function buildProfileCatalog(input: BuildProfileCatalogInput): BuildProfileCatalogResult {
  const catalog: Record<string, ProfileCatalogEntry> = Object.create(null);
  const diagnostics: ProfileDiagnostic[] = [];

  const configPath = input.configPath;

  if (input.configProfiles) {
    for (const [name, profile] of Object.entries(input.configProfiles)) {
      validateProfileName(name, `profiles.${name}`);
      validateWorkflowProfile(profile, `profiles.${name}`);
      catalog[name] = {
        name,
        profile,
        source: "config",
        sourcePath: configPath,
        overridesConfigProfile: false,
      };
    }
  }

  if (input.externalProfiles?.document.profiles) {
    for (const [name, profile] of Object.entries(input.externalProfiles.document.profiles)) {
      validateProfileName(name, `profiles.${name}`);
      validateWorkflowProfile(profile, `profiles.${name}`);
      const existed = hasOwn(catalog, name);
      catalog[name] = {
        name,
        profile,
        source: existed ? "external-override" : "external",
        sourcePath: input.externalProfiles.path,
        overridesConfigProfile: existed,
      };
      if (existed) {
        diagnostics.push({
          severity: "warning",
          code: "PROFILE_EXTERNAL_OVERRIDE",
          message: `External profile '${name}' overrides config profile.`,
          path: `profiles.${name}`
        });
      }
    }
  }

  return { catalog, diagnostics };
}

export interface ResolveSelectedProfileInput {
  selectedName?: string | undefined;
  catalog: Record<string, ProfileCatalogEntry>;
  hasExternalFile: boolean;
}

export interface ResolveSelectedProfileResult {
  selection?: ResolvedProfileSelection | undefined;
  diagnostics: ProfileDiagnostic[];
}

/**
 * Resolves the extends inheritance chain for the selected profile via DFS.
 * Throws errors for cycle detection or missing bases, and calculates the canonical profile hash.
 * 
 * Inheritance chain convention: first DFS visit order for the selected traversal (bases left-to-right, each name once), ending with the selected profile.
 */
export function resolveSelectedProfile(input: ResolveSelectedProfileInput): ResolveSelectedProfileResult {
  if (input.selectedName === undefined) {
    return { selection: undefined, diagnostics: [] };
  }

  validateProfileName(input.selectedName, "profile");

  const availableNames = Object.keys(input.catalog).sort();
  if (!hasOwn(input.catalog, input.selectedName)) {
    const listStr = availableNames.length > 0 ? availableNames.join(", ") : "none available";
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_NOT_FOUND,
      `Profile '${input.selectedName}' not found. Available profiles: ${listStr}.`
    );
  }

  const states: Record<string, "visiting" | "resolved"> = Object.create(null);
  const cache: Record<string, ResolvedWorkflowProfile> = Object.create(null);
  const chain: string[] = [];

  function dfs(name: string, visitStack: string[]): ResolvedWorkflowProfile {
    if (hasOwn(cache, name)) {
      return cache[name]!;
    }

    const state = hasOwn(states, name) ? states[name] : undefined;
    if (state === "visiting") {
      const idx = visitStack.indexOf(name);
      const cycle = [...visitStack.slice(idx), name].join(" -> ");
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Cyclic inheritance detected: ${cycle}`
      );
    }

    states[name] = "visiting";
    const entry = hasOwn(input.catalog, name) ? input.catalog[name] : undefined;
    if (!entry) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_NOT_FOUND,
        `Profile base '${name}' not found.`
      );
    }

    validateWorkflowProfile(entry.profile, `profiles.${name}`);

    let resolved: ResolvedWorkflowProfile = {
      args: {},
      context: {},
      run: {}
    };

    if (entry.profile.description !== undefined) {
      resolved.description = entry.profile.description;
    }

    const bases = entry.profile.extends !== undefined
      ? (Array.isArray(entry.profile.extends) ? entry.profile.extends : [entry.profile.extends])
      : [];

    for (const base of bases) {
      if (!hasOwn(input.catalog, base)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.PROFILE_NOT_FOUND,
          `Profile base '${base}' not found.`
        );
      }
      const resolvedBase = dfs(base, [...visitStack, name]);
      resolved = mergeProfiles(resolved, resolvedBase);
    }

    resolved = mergeProfiles(resolved, entry.profile);

    validateResolvedWorkflowProfile(resolved, `profiles.${name}`);

    states[name] = "resolved";
    cache[name] = resolved;

    if (!chain.includes(name)) {
      chain.push(name);
    }

    return resolved;
  }

  const resolved = dfs(input.selectedName, []);

  // Construct diagnostics (reconstruct catalog override diagnostics)
  const catalogDiagnostics: ProfileDiagnostic[] = [];
  for (const [name, entry] of Object.entries(input.catalog)) {
    if (entry.overridesConfigProfile) {
      catalogDiagnostics.push({
        severity: "warning",
        code: "PROFILE_EXTERNAL_OVERRIDE",
        message: `External profile '${name}' overrides config profile.`,
        path: `profiles.${name}`
      });
    }
  }

  const selectedEntry = hasOwn(input.catalog, input.selectedName) ? input.catalog[input.selectedName] : undefined;
  if (!selectedEntry) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_NOT_FOUND,
      `Selected profile '${input.selectedName}' not found in catalog.`
    );
  }
  let profilesPath: string | undefined = undefined;
  if (input.hasExternalFile) {
    for (const entry of Object.values(input.catalog)) {
      if (entry.source === "external" || entry.source === "external-override") {
        profilesPath = entry.sourcePath;
        break;
      }
    }
  }

  const selection: ResolvedProfileSelection = {
    selected: input.selectedName,
    source: selectedEntry.source,
    profilesPath,
    hasExternalFile: input.hasExternalFile,
    resolved,
    hash: canonicalProfileHash(resolved),
    inheritanceChain: chain,
    diagnostics: catalogDiagnostics
  };

  return {
    selection,
    diagnostics: catalogDiagnostics
  };
}

function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => cloneDeep(item)) as unknown as T;
  }
  const cloned: any = {};
  for (const key of Object.keys(value)) {
    cloned[key] = cloneDeep((value as any)[key]);
  }
  return cloned;
}

function mergeContext(baseCtx: any, childCtx: any): any {
  const baseIsObj = baseCtx !== null && typeof baseCtx === "object" && !Array.isArray(baseCtx);
  const childIsObj = childCtx !== null && typeof childCtx === "object" && !Array.isArray(childCtx);

  if (baseIsObj && childIsObj) {
    const merged = { ...cloneDeep(baseCtx) };
    for (const key of Object.keys(childCtx)) {
      merged[key] = mergeContext(baseCtx[key], childCtx[key]);
    }
    return merged;
  }

  return cloneDeep(childCtx);
}

/**
 * Merges a child profile on top of a resolved base profile, implementing precedence and cloning rules.
 */
export function mergeProfiles(base: ResolvedWorkflowProfile, child: WorkflowProfile): ResolvedWorkflowProfile {
  let description = base.description;
  if (child.description !== undefined) {
    description = child.description;
  }

  const baseArgs = base.args || {};
  const childArgs = child.args || {};
  const args = { ...cloneDeep(baseArgs), ...cloneDeep(childArgs) };

  const context = mergeContext(base.context || {}, child.context || {});

  const baseRun = base.run || {};
  const childRun = child.run || {};
  const run: any = { ...cloneDeep(baseRun), ...cloneDeep(childRun) };

  const baseRetry = baseRun.retry;
  const childRetry = childRun.retry;
  const baseRetryIsObj = baseRetry !== null && typeof baseRetry === "object" && !Array.isArray(baseRetry);
  const childRetryIsObj = childRetry !== null && typeof childRetry === "object" && !Array.isArray(childRetry);

  if (baseRetryIsObj && childRetryIsObj) {
    run.retry = { ...cloneDeep(baseRetry), ...cloneDeep(childRetry) };
  } else if (childRetry !== undefined) {
    run.retry = cloneDeep(childRetry);
  } else if (baseRetry !== undefined) {
    run.retry = cloneDeep(baseRetry);
  }

  const result: ResolvedWorkflowProfile = {
    args,
    context,
    run
  };

  if (description !== undefined) {
    result.description = description;
  }

  return result;
}

function sortRecursively(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortRecursively);
  }
  const sortedKeys = Object.keys(value).sort();
  const sortedObj: any = {};
  for (const key of sortedKeys) {
    sortedObj[key] = sortRecursively((value as any)[key]);
  }
  return sortedObj;
}

/**
 * Generates a stable SHA-256 hash of a ResolvedWorkflowProfile using canonical JSON sorting.
 */
export function canonicalProfileHash(profile: ResolvedWorkflowProfile): string {
  const cleanProfile: ResolvedWorkflowProfile = {
    args: profile.args || {},
    context: profile.context || {},
    run: profile.run || {}
  };
  if (profile.description !== undefined) {
    cleanProfile.description = profile.description;
  }

  const sorted = sortRecursively(cleanProfile);
  const jsonStr = JSON.stringify(sorted);
  const hashHex = createHash("sha256").update(jsonStr).digest("hex");
  return `sha256:${hashHex}`;
}

/**
 * Converts profile run options to CLI overrides, mapping only allowed FR-6 keys.
 */
export function profileRunOptionsToCliOverrides(run?: WorkflowProfileRunOptions | undefined): {
  config: ConfigCliOverrides;
  thinkingEffort?: ThinkingEffort | undefined;
} {
  const configOverrides: ConfigCliOverrides = {};
  let thinkingEffort: ThinkingEffort | undefined;

  if (!run) {
    return { config: configOverrides };
  }

  if (run.provider !== undefined) configOverrides.provider = run.provider;
  if (run.model !== undefined) configOverrides.model = run.model;
  if (run.concurrency !== undefined) configOverrides.concurrency = run.concurrency;
  if (run.timeoutMs !== undefined) configOverrides.timeoutMs = run.timeoutMs;
  if (run.maxAgentCalls !== undefined) configOverrides.maxAgentCalls = run.maxAgentCalls;
  if (run.failFast !== undefined) configOverrides.failFast = run.failFast;
  if (run.report !== undefined) configOverrides.report = run.report;
  
  if (run.thinkingEffort !== undefined) {
    thinkingEffort = run.thinkingEffort;
  }

  if (run.retry !== undefined) {
    const retry = run.retry;
    if (retry === false) {
      configOverrides.noRetry = true;
    } else if (typeof retry === "object" && retry !== null) {
      if ("enabled" in retry && retry.enabled === false) {
        configOverrides.noRetry = true;
        if (retry.policy?.disableDelay !== undefined) {
          configOverrides.retryDisableDelay = retry.policy.disableDelay;
        }
      } else {
        const sourceObj: any = ("policy" in retry && retry.policy && typeof retry.policy === "object") ? retry.policy : retry;
        if (sourceObj.maxAttempts !== undefined) configOverrides.retryMaxAttempts = sourceObj.maxAttempts;
        if (sourceObj.delayMs !== undefined) configOverrides.retryDelayMs = sourceObj.delayMs;
        if (sourceObj.maxDelayMs !== undefined) configOverrides.retryMaxDelayMs = sourceObj.maxDelayMs;
        if (sourceObj.backoff !== undefined) configOverrides.retryBackoff = sourceObj.backoff;
        if (sourceObj.disableDelay !== undefined) configOverrides.retryDisableDelay = sourceObj.disableDelay;
        
        if (sourceObj.maxAttempts === 1) {
          configOverrides.noRetry = true;
        }
      }
    }
  }

  return {
    config: configOverrides,
    thinkingEffort,
  };
}

/**
 * Shallow merges profile args and explicit args, cloning values so nested elements are not shared.
 */
export function mergeProfileArgs(
  profileArgs: JsonObject | undefined,
  explicitArgs: JsonObject | undefined
): JsonObject {
  const result: JsonObject = {};
  if (profileArgs) {
    for (const [key, value] of Object.entries(profileArgs)) {
      if (value !== undefined) {
        result[key] = JSON.parse(JSON.stringify(value));
      }
    }
  }
  if (explicitArgs) {
    for (const [key, value] of Object.entries(explicitArgs)) {
      if (value !== undefined) {
        const profileVal = profileArgs ? profileArgs[key] : undefined;
        let coercedValue = value;
        if (typeof value === "string") {
          if (typeof profileVal === "number") {
            const num = Number(value);
            if (!isNaN(num)) {
              coercedValue = num;
            }
          } else if (typeof profileVal === "boolean") {
            if (value === "true") {
              coercedValue = true;
            } else if (value === "false") {
              coercedValue = false;
            }
          }
        }
        result[key] = JSON.parse(JSON.stringify(coercedValue));
      }
    }
  }
  return result;
}
