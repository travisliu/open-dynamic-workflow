import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { loadExternalProfilesFile } from "../config/profile-file.js";
import {
  buildProfileCatalog,
  resolveSelectedProfile,
  profileRunOptionsToCliOverrides,
  mergeProfileArgs,
} from "../config/profiles.js";
import type {
  ResolvedConfig,
  ProfileDiagnostic,
  ResolvedProfileSelection,
  RuntimeProfileContextSeed,
  ProfileReportMetadata,
} from "../types/config.js";
import type { ConfigCliOverrides } from "../config/merge.js";
import type { JsonObject } from "../types/common.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";
import type { RecordedRunProfileInput } from "../types/artifacts.js";
import { recordedProfileToRunProfile } from "./run-input-profile.js";

export interface ValidateProfileOptionsInput {
  cwd: string;
  configPath?: string | undefined;
  rawOptions: any;
  config: any;
}

export async function validateProfileOptions(input: ValidateProfileOptionsInput): Promise<{
  selection?: ResolvedProfileSelection | undefined;
  diagnostics: ProfileDiagnostic[];
}> {
  const rawOptions = input.rawOptions || {};
  const profile = rawOptions.profile;
  const profiles = rawOptions.profiles;

  if (profile !== undefined) {
    if (typeof profile !== "string" || profile.trim() === "") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        "Profile option must be a non-empty string."
      );
    }
  }

  if (profiles !== undefined) {
    if (typeof profiles !== "string" || profiles.trim() === "") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_FILE_INVALID,
        "Profiles path option must be a non-empty string."
      );
    }
  }

  const externalProfiles = profiles !== undefined
    ? await loadExternalProfilesFile({ cwd: input.cwd, profilesPath: profiles })
    : undefined;

  // Cast the config profiles to the appropriate type
  const configProfiles = input.config.profiles as any;

  const { catalog, diagnostics: catalogDiagnostics } = buildProfileCatalog({
    configProfiles,
    configPath: input.configPath,
    externalProfiles,
  });

  const hasExternalFile = externalProfiles !== undefined;

  const { selection, diagnostics: selectionDiagnostics } = resolveSelectedProfile({
    selectedName: profile,
    catalog,
    hasExternalFile,
  });

  const diagnostics = [...catalogDiagnostics, ...selectionDiagnostics];

  if (profile === undefined && profiles !== undefined) {
    diagnostics.push({
      severity: "warning",
      code: "PROFILE_UNUSED_FILE",
      message: `Profiles file '${profiles}' was loaded but no profile was selected.`,
    });
  }

  return {
    selection,
    diagnostics,
  };
}

export interface ResolveRunProfileInput {
  cwd: string;
  configPath?: string | undefined;
  baseConfig: any;
  rawOptions: unknown;
  explicitCliOverrides: ConfigCliOverrides;
  explicitArgs: JsonObject;
  recordedProfile?: RecordedRunProfileInput | undefined;
}

export interface ResolveRunProfileResult {
  profileRunAsCli: {
    config: ConfigCliOverrides;
    thinkingEffort?: ThinkingEffort | undefined;
  };
  finalCliArgs: JsonObject;
  selection?: ResolvedProfileSelection;
  contextSeed?: RuntimeProfileContextSeed;
  reportProfile?: ProfileReportMetadata;
  diagnostics: ProfileDiagnostic[];
  resumedFromRecordedProfile?: boolean;
}

export function resolveResumeProfileBehavior(
  mode: "resume" | "run-resume",
  hasExplicitFlags: boolean,
  recorded: RecordedRunProfileInput | undefined
): "reuse" | "fresh" | "none" {
  if (mode === "run-resume" && hasExplicitFlags) {
    return "fresh";
  }
  if (recorded) {
    return "reuse";
  }
  return "none";
}

export async function resolveRunProfile(input: ResolveRunProfileInput): Promise<ResolveRunProfileResult> {
  const rawOptions = (input.rawOptions || {}) as any;
  const hasExplicitFlags = rawOptions.profile !== undefined || rawOptions.profiles !== undefined;
  const mode = rawOptions.recordedProfile ? "resume" : (rawOptions.resume ? "run-resume" : undefined);

  if (mode) {
    const behavior = resolveResumeProfileBehavior(mode, hasExplicitFlags, input.recordedProfile);
    if (behavior === "reuse" && input.recordedProfile) {
      const selection: ResolvedProfileSelection = {
        selected: input.recordedProfile.selected,
        source: "recorded",
        profilesPath: input.recordedProfile.profilesPath,
        hasExternalFile: input.recordedProfile.profilesPath !== undefined,
        resolved: input.recordedProfile.resolved,
        hash: input.recordedProfile.hash,
        inheritanceChain: input.recordedProfile.inheritanceChain || [],
        diagnostics: [],
      };

      const {
        profileRunAsCli,
        finalCliArgs,
        contextSeed,
        reportProfile,
      } = recordedProfileToRunProfile(input.recordedProfile, input.explicitArgs);

      return {
        profileRunAsCli,
        finalCliArgs,
        selection,
        contextSeed,
        reportProfile,
        diagnostics: [],
        resumedFromRecordedProfile: true,
      };
    }
  }

  const { selection, diagnostics } = await validateProfileOptions({
    cwd: input.cwd,
    configPath: input.configPath,
    rawOptions: input.rawOptions,
    config: input.baseConfig,
  });

  if (selection) {
    const profileRunAsCli = profileRunOptionsToCliOverrides(selection.resolved.run);
    const finalCliArgs = mergeProfileArgs(selection.resolved.args, input.explicitArgs);
    
    const contextSeed: RuntimeProfileContextSeed = {
      context: selection.resolved.context || {},
      metadata: {
        name: selection.selected,
        source: selection.source,
        hasExternalFile: selection.hasExternalFile,
        hash: selection.hash,
        profilesPath: selection.profilesPath,
      },
      reservedPath: "$profile",
    };

    const reportProfile: ProfileReportMetadata = {
      selected: selection.selected,
      source: selection.source,
      profilesPath: selection.profilesPath,
      hash: selection.hash,
    };

    return {
      profileRunAsCli,
      finalCliArgs,
      selection,
      contextSeed,
      reportProfile,
      diagnostics,
    };
  }

  return {
    profileRunAsCli: { config: {} },
    finalCliArgs: input.explicitArgs,
    diagnostics,
  };
}

