import * as path from "path";
import { realpath, readFile } from "fs/promises";
import { parseDocument } from "yaml";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { isPathInsideCwd } from "./path-safety.js";
import type { ProfilesFileDocument } from "./types.js";
import { validateProfileCatalog } from "./schema.js";

export interface LoadExternalProfilesInput {
  cwd: string;
  profilesPath?: string | undefined;
}

export interface LoadedProfilesFile {
  path: string;        // canonical real path used for IO/source metadata
  displayPath: string; // normalized cwd-relative POSIX path when possible
  document: ProfilesFileDocument;
}

export async function loadExternalProfilesFile(
  input: LoadExternalProfilesInput,
): Promise<LoadedProfilesFile | undefined> {
  // 1. Return undefined only when profilesPath === undefined.
  // An empty or whitespace-only supplied string is invalid and throws PROFILE_FILE_INVALID.
  if (input.profilesPath === undefined) {
    return undefined;
  }
  if (input.profilesPath.trim() === "") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      "Profiles path cannot be empty or whitespace-only."
    );
  }

  // 2. Reject URL-like inputs before path resolution using a scheme check.
  // Reject non-YAML suffixes; accept only .yaml and .yml (case-insensitive).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input.profilesPath)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `URL-like paths are not supported: ${input.profilesPath}`
    );
  }

  const ext = path.extname(input.profilesPath).toLowerCase();
  if (ext !== ".yaml" && ext !== ".yml") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `Unsupported file extension: ${ext}. Only .yaml and .yml are allowed.`
    );
  }

  // 3. Resolve relative values from cwd; permit absolute paths only if they are inside cwd.
  // Use path.resolve, path.relative, and isPathInsideCwd() for lexical containment.
  const absoluteCwd = path.resolve(input.cwd);
  const resolvedTargetLexical = path.resolve(absoluteCwd, input.profilesPath);

  if (!isPathInsideCwd({ cwd: absoluteCwd, targetPath: resolvedTargetLexical })) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `Profiles file path resolves outside the workspace: ${input.profilesPath}`
    );
  }

  // 4. Read/canonicalize safely: after lexical acceptance, realpath the workspace and target.
  // Map target ENOENT to PROFILE_FILE_NOT_FOUND; map all other failures to PROFILE_FILE_INVALID.
  // Confirm canonical target containment under canonical workspace so symlinks cannot escape.
  let canonicalWorkspace: string;
  try {
    canonicalWorkspace = await realpath(absoluteCwd);
  } catch (err: any) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `Workspace directory is invalid: ${input.cwd}`,
      { cause: err }
    );
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(resolvedTargetLexical);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_FILE_NOT_FOUND,
        `Profiles file not found: ${input.profilesPath}`
      );
    }
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `Failed to resolve profiles file path: ${input.profilesPath}`,
      { cause: err }
    );
  }

  // Check canonical containment
  const relativeFromCanonical = path.relative(canonicalWorkspace, canonicalTarget);
  const isInsideCanonical = !relativeFromCanonical.startsWith("..") && !path.isAbsolute(relativeFromCanonical) && relativeFromCanonical !== "";
  if (!isInsideCanonical) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `Profiles file escapes the workspace: ${input.profilesPath}`
    );
  }

  // 5. Read UTF-8 from the canonical target.
  let content: string;
  try {
    content = await readFile(canonicalTarget, "utf8");
  } catch (err: any) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `Failed to read profiles file: ${input.profilesPath}`,
      { cause: err }
    );
  }

  // Determine display path (POSIX style normalized relative to cwd if possible)
  let displayPath: string;
  const relativeToCwd = path.relative(absoluteCwd, canonicalTarget);
  if (!relativeToCwd.startsWith("..") && !path.isAbsolute(relativeToCwd)) {
    displayPath = relativeToCwd.replace(/\\/g, "/");
  } else {
    displayPath = canonicalTarget.replace(/\\/g, "/");
  }

  // 6. Parse with yaml dependency using document API to detect duplicate keys.
  let doc;
  try {
    doc = parseDocument(content);
  } catch (err: any) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `Failed to parse YAML profiles file: ${err.message}`,
      { cause: err }
    );
  }

  if (doc.errors && doc.errors.length > 0) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      `Invalid YAML in profiles file: ${doc.errors.map((e: any) => e.message).join("; ")}`
    );
  }

  const documentData = doc.toJS();

  // 7. Validate external envelope before profile semantics
  if (documentData === null || typeof documentData !== "object" || Array.isArray(documentData)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      "Root of profiles file must be a non-null, non-array object."
    );
  }

  const allowedEnvelopeKeys = ["description", "version", "profiles"];
  const ownKeys = Object.keys(documentData);
  for (const key of ownKeys) {
    if (!allowedEnvelopeKeys.includes(key)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_FILE_INVALID,
        `Unsupported envelope key: ${key}`
      );
    }
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_FILE_INVALID,
        `Unsafe envelope key: ${key}`
      );
    }
  }

  if (!("profiles" in documentData)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      "Missing required envelope key: profiles"
    );
  }

  if ("description" in documentData && typeof (documentData as any).description !== "string") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      "Envelope key 'description' must be a string."
    );
  }

  if ("version" in documentData && typeof (documentData as any).version !== "string") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_FILE_INVALID,
      "Envelope key 'version' must be a string."
    );
  }

  // 8. Call validateProfileCatalog. If it throws, preserve its code.
  validateProfileCatalog(documentData.profiles, "profiles");

  const document: ProfilesFileDocument = {
    ...(documentData.description !== undefined ? { description: documentData.description } : {}),
    ...(documentData.version !== undefined ? { version: documentData.version } : {}),
    profiles: documentData.profiles,
  };

  return {
    path: canonicalTarget,
    displayPath,
    document,
  };
}
