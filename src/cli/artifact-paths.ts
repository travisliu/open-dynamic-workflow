import * as path from "node:path";

import type {
  OutDirResolutionSource,
  ResolvedOutDir,
  RunProfileConfig
} from "../config/types.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";

export interface ResolveArtifactRunsRootInput {
  cwd: string;
  cliOutDir?: string | undefined;
  selectedProfileName?: string | undefined;
  selectedProfile?: RunProfileConfig | undefined;
  fileOutDir?: string | undefined;
  builtInOutDir: string;
}

export interface SelectRunProfileInput {
  profiles: Record<string, RunProfileConfig>;
  explicitProfile?: string | undefined;
  recordedProfile?: string | undefined;
  reuseRecordedProfile: boolean;
}

export interface SelectedRunProfile {
  name?: string | undefined;
  config?: RunProfileConfig | undefined;
  source: "explicit" | "recorded" | "none";
}

export type RunTargetKind = "bare-run-id" | "explicit-run-path";

export interface ResolvePreviousRunInput {
  target: string;
  cwd: string;
  effectiveRunsRoot: string;
  legacyRunsRoot: string;
  fs: Pick<typeof import("node:fs/promises"), "stat">;
}

export interface ResolvedPreviousRun {
  target: string;
  kind: RunTargetKind;
  runDir: string;
  source: "explicit-path" | "effective-root" | "legacy-fallback";
  attemptedPaths: string[];
}

type DirectoryCandidateStatus =
  | { kind: "directory" }
  | { kind: "missing" }
  | { kind: "not-directory" };

function usageError(message: string): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, message);
}

function configError(message: string): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(ErrorCode.CONFIG_VALIDATION_ERROR, message);
}

function requireNonEmptyString(
  value: unknown,
  message: string,
  error: (message: string) => OpenDynamicWorkflowError
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw error(message);
  }
}

function selectedProfileMetadata(input: ResolveArtifactRunsRootInput): string | undefined {
  const hasName = input.selectedProfileName !== undefined;
  const hasProfile = input.selectedProfile !== undefined;

  if (hasName !== hasProfile) {
    throw usageError("Selected profile name and configuration must be provided together.");
  }

  if (!hasName) {
    return undefined;
  }

  requireNonEmptyString(
    input.selectedProfileName,
    "Selected profile name must be a non-empty string.",
    usageError
  );
  if (
    typeof input.selectedProfile !== "object" ||
    input.selectedProfile === null ||
    Array.isArray(input.selectedProfile)
  ) {
    throw usageError("Selected profile configuration must be an object.");
  }

  return input.selectedProfileName;
}

export function resolveArtifactRunsRoot(
  input: ResolveArtifactRunsRootInput
): ResolvedOutDir {
  const selectedProfile = selectedProfileMetadata(input);
  let rawValue: unknown;
  let source: OutDirResolutionSource;
  let invalidValueError: (message: string) => OpenDynamicWorkflowError;

  if (input.cliOutDir !== undefined) {
    rawValue = input.cliOutDir;
    source = "cli";
    invalidValueError = usageError;
  } else if (input.selectedProfile?.outDir !== undefined) {
    rawValue = input.selectedProfile.outDir;
    source = "profile";
    invalidValueError = configError;
  } else if (input.fileOutDir !== undefined) {
    rawValue = input.fileOutDir;
    source = "config";
    invalidValueError = configError;
  } else {
    rawValue = input.builtInOutDir;
    source = "built-in-default";
    invalidValueError = configError;
  }

  requireNonEmptyString(rawValue, `Invalid ${source} output directory.`, invalidValueError);

  return {
    path: path.resolve(input.cwd, rawValue),
    rawValue,
    source,
    ...(selectedProfile === undefined ? {} : { selectedProfile })
  };
}

export function selectRunProfile(input: SelectRunProfileInput): SelectedRunProfile {
  const candidate = input.explicitProfile !== undefined
    ? { name: input.explicitProfile, source: "explicit" as const }
    : input.reuseRecordedProfile && input.recordedProfile !== undefined
      ? { name: input.recordedProfile, source: "recorded" as const }
      : undefined;

  if (candidate === undefined) {
    return { source: "none" };
  }

  requireNonEmptyString(candidate.name, "Profile name must be a non-empty string.", usageError);
  if (!Object.prototype.hasOwnProperty.call(input.profiles, candidate.name)) {
    throw usageError(`Profile '${candidate.name}' was not found.`);
  }

  return {
    name: candidate.name,
    config: input.profiles[candidate.name],
    source: candidate.source
  };
}

export function legacyRunsRoot(cwd: string): string {
  return path.resolve(cwd, ".open-dynamic-workflow/runs");
}

export function classifyRunTarget(target: string): RunTargetKind {
  requireNonEmptyString(target, "Run target must be a non-empty string.", usageError);

  if (
    path.isAbsolute(target) ||
    path.win32.isAbsolute(target) ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith(".\\") ||
    target.startsWith("..\\") ||
    target.includes("/") ||
    target.includes("\\")
  ) {
    return "explicit-run-path";
  }

  return "bare-run-id";
}

async function directoryCandidateStatus(
  fs: ResolvePreviousRunInput["fs"],
  candidate: string
): Promise<DirectoryCandidateStatus> {
  try {
    const stats = await fs.stat(candidate);
    return stats.isDirectory() ? { kind: "directory" } : { kind: "not-directory" };
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }
}

function missingRunError(attemptedPaths: readonly string[]): OpenDynamicWorkflowError {
  return usageError(`Run directory was not found. Checked: ${attemptedPaths.join(", ")}`);
}

function notDirectoryError(candidate: string): OpenDynamicWorkflowError {
  return usageError(`Run directory required, but '${candidate}' is not a directory.`);
}

export async function resolvePreviousRun(
  input: ResolvePreviousRunInput
): Promise<ResolvedPreviousRun> {
  const kind = classifyRunTarget(input.target);
  const absoluteCwd = path.resolve(input.cwd);

  if (kind === "explicit-run-path") {
    const runDir = path.resolve(absoluteCwd, input.target);
    const attemptedPaths = [runDir];
    const status = await directoryCandidateStatus(input.fs, runDir);
    if (status.kind === "directory") {
      return { target: input.target, kind, runDir, source: "explicit-path", attemptedPaths };
    }
    if (status.kind === "not-directory") {
      throw notDirectoryError(runDir);
    }
    throw missingRunError(attemptedPaths);
  }

  const effectiveRoot = path.resolve(absoluteCwd, input.effectiveRunsRoot);
  const fallbackRoot = path.resolve(absoluteCwd, input.legacyRunsRoot);
  const primary = path.resolve(effectiveRoot, input.target);
  const attemptedPaths = [primary];
  const primaryStatus = await directoryCandidateStatus(input.fs, primary);

  if (primaryStatus.kind === "directory") {
    return { target: input.target, kind, runDir: primary, source: "effective-root", attemptedPaths };
  }
  if (primaryStatus.kind === "not-directory") {
    throw notDirectoryError(primary);
  }
  if (effectiveRoot === fallbackRoot) {
    throw missingRunError(attemptedPaths);
  }

  const fallback = path.resolve(fallbackRoot, input.target);
  attemptedPaths.push(fallback);
  const fallbackStatus = await directoryCandidateStatus(input.fs, fallback);
  if (fallbackStatus.kind === "directory") {
    return { target: input.target, kind, runDir: fallback, source: "legacy-fallback", attemptedPaths };
  }
  if (fallbackStatus.kind === "not-directory") {
    throw notDirectoryError(fallback);
  }
  throw missingRunError(attemptedPaths);
}
