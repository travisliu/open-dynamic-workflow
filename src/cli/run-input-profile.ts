import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import {
  validateProfileName,
  validateResolvedWorkflowProfile,
  validateObjectOwnPropertiesOnly,
} from "../config/schema.js";
import {
  profileRunOptionsToCliOverrides,
  mergeProfileArgs,
} from "../config/profiles.js";
import type {
  RecordedRunProfileInput,
} from "../types/artifacts.js";
import type {
  ResolvedProfileSelection,
  RuntimeProfileContextSeed,
  ProfileReportMetadata,
} from "../types/config.js";
import type { JsonObject } from "../types/common.js";

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

export function createRecordedRunProfile(
  selection: ResolvedProfileSelection,
  options?: { resumedFromRecordedProfile?: boolean }
): RecordedRunProfileInput {
  const result: RecordedRunProfileInput = {
    selected: selection.selected,
    source: selection.source,
    resolved: cloneDeep(selection.resolved),
    hash: selection.hash,
  };

  if (selection.profilesPath !== undefined) {
    result.profilesPath = selection.profilesPath;
  }

  if (selection.inheritanceChain !== undefined) {
    result.inheritanceChain = cloneDeep(selection.inheritanceChain);
  }

  if (options?.resumedFromRecordedProfile) {
    result.resumedFromRecordedProfile = true;
  }

  return result;
}

export function parseRecordedRunProfile(value: unknown): RecordedRunProfileInput | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("value must be an object.");
    }

    // Validate own properties first to prevent prototype pollution or inherited props
    validateObjectOwnPropertiesOnly(value, "profile");

    const allowedKeys = [
      "selected",
      "source",
      "profilesPath",
      "resolved",
      "hash",
      "inheritanceChain",
      "resumedFromRecordedProfile",
    ];

    for (const key of Object.getOwnPropertyNames(value)) {
      if (!allowedKeys.includes(key)) {
        throw new Error(`property '${key}' is not allowed.`);
      }
    }

    if (!("selected" in value)) {
      throw new Error("missing 'selected'.");
    }
    validateProfileName((value as any).selected, "profile.selected");

    if (!("source" in value)) {
      throw new Error("missing 'source'.");
    }
    const source = (value as any).source;
    if (typeof source !== "string" || !["config", "external", "external-override", "recorded"].includes(source)) {
      throw new Error(`invalid 'source' "${source}".`);
    }

    if ("profilesPath" in value && (value as any).profilesPath !== undefined) {
      const profilesPath = (value as any).profilesPath;
      if (typeof profilesPath !== "string" || profilesPath.trim() === "") {
        throw new Error("'profilesPath' must be a non-empty string.");
      }
    }

    if (!("hash" in value)) {
      throw new Error("missing 'hash'.");
    }
    const hash = (value as any).hash;
    if (typeof hash !== "string" || hash.trim() === "") {
      throw new Error("'hash' must be a non-empty string.");
    }

    if ("inheritanceChain" in value && (value as any).inheritanceChain !== undefined) {
      const chain = (value as any).inheritanceChain;
      if (!Array.isArray(chain)) {
        throw new Error("'inheritanceChain' must be an array.");
      }
      for (let i = 0; i < chain.length; i++) {
        const name = chain[i];
        if (typeof name !== "string" || name.trim() === "") {
          throw new Error(`'inheritanceChain[${i}]' must be a non-empty string.`);
        }
      }
    }

    if ("resumedFromRecordedProfile" in value && (value as any).resumedFromRecordedProfile !== undefined) {
      if ((value as any).resumedFromRecordedProfile !== true) {
        throw new Error("'resumedFromRecordedProfile' must be true.");
      }
    }

    if (!("resolved" in value)) {
      throw new Error("missing 'resolved'.");
    }

    validateResolvedWorkflowProfile((value as any).resolved, "profile.resolved");
  } catch (err: any) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Recorded profile is malformed: ${err.message}`,
      { cause: err }
    );
  }

  return cloneDeep(value) as unknown as RecordedRunProfileInput;
}

export function recordedProfileToRunProfile(
  recorded: RecordedRunProfileInput,
  explicitArgs: JsonObject
) {
  const resolved = cloneDeep(recorded.resolved);

  const profileRunAsCli = profileRunOptionsToCliOverrides(resolved.run);
  const finalCliArgs = mergeProfileArgs(resolved.args, explicitArgs);

  const contextSeed: RuntimeProfileContextSeed = {
    context: resolved.context || {},
    metadata: {
      name: recorded.selected,
      source: "recorded",
      hasExternalFile: recorded.profilesPath !== undefined,
      hash: recorded.hash,
      profilesPath: recorded.profilesPath,
    },
    reservedPath: "$profile",
  };

  const reportProfile: ProfileReportMetadata & { resumedFromRecordedProfile?: true } = {
    selected: recorded.selected,
    source: "recorded",
    profilesPath: recorded.profilesPath,
    hash: recorded.hash,
  };

  if (recorded.resumedFromRecordedProfile) {
    reportProfile.resumedFromRecordedProfile = true;
  }

  return {
    profileRunAsCli,
    finalCliArgs,
    contextSeed,
    reportProfile,
  };
}
