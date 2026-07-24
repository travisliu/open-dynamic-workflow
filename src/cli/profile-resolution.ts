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
  /** @deprecated Recorded snapshots are audit metadata and are never executable. */
  recordedProfile?: unknown | undefined;
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
}

export async function resolveRunProfile(input: ResolveRunProfileInput): Promise<ResolveRunProfileResult> {
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
