import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { RuntimeProfileContextSeed } from "../types/config.js";
import type { WorkflowContextRuntime } from "./types.js";
import { isJsonPlainObject, validateJsonValue } from "./json.js";

export function validateProfileContextSeed(seed: unknown): asserts seed is RuntimeProfileContextSeed {
  if (seed === null || typeof seed !== "object") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      "Profile context seed must be an object"
    );
  }

  const s = seed as Record<string, any>;

  // Check reservedPath
  if (s.reservedPath !== "$profile") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_RESERVED_PATH,
      `Reserved path must be '$profile', received: '${s.reservedPath}'`
    );
  }

  // Check context
  if (!s.context || !isJsonPlainObject(s.context)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      "Profile context seed must contain a valid 'context' plain object"
    );
  }

  // Check if context has its own top-level $profile key
  if ("$profile" in s.context) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_RESERVED_PATH,
      "Profile context cannot define a top-level '$profile' key"
    );
  }

  // Validate context is JSON-safe
  try {
    validateJsonValue(s.context, { operation: "set", path: "context" });
  } catch (err: any) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      `Profile context is not JSON-safe: ${err.message}`,
      { cause: err }
    );
  }

  // Check metadata
  const metadata = s.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      "Profile context seed must contain a 'metadata' object"
    );
  }

  if (typeof metadata.name !== "string" || metadata.name.trim() === "") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      "Profile metadata 'name' must be a non-empty string"
    );
  }

  const validSources = ["config", "external", "external-override", "recorded"];
  if (typeof metadata.source !== "string" || !validSources.includes(metadata.source)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      `Profile metadata 'source' must be a valid ProfileSource, received: '${metadata.source}'`
    );
  }

  if (typeof metadata.hasExternalFile !== "boolean") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      "Profile metadata 'hasExternalFile' must be a boolean"
    );
  }

  if (typeof metadata.hash !== "string" || metadata.hash.trim() === "") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      "Profile metadata 'hash' must be a non-empty string"
    );
  }

  if (metadata.profilesPath !== undefined && typeof metadata.profilesPath !== "string") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_CONTEXT_INVALID,
      "Profile metadata 'profilesPath' must be a string if defined"
    );
  }
}

export function seedProfileContext(options: {
  contextRuntime: WorkflowContextRuntime;
  seed: RuntimeProfileContextSeed;
}): void {
  validateProfileContextSeed(options.seed);

  const facade = options.contextRuntime.createFacade({ suppressEvents: true });

  // Create the existing facade and write every top-level user context value with facade.set(key, value).
  for (const [key, value] of Object.entries(options.seed.context)) {
    facade.set(key, value);
  }

  // Then write, in this order, $profile.name, $profile.source, $profile.hasExternalFile, $profile.hash.
  facade.set("$profile.name", options.seed.metadata.name);
  facade.set("$profile.source", options.seed.metadata.source);
  facade.set("$profile.hasExternalFile", options.seed.metadata.hasExternalFile);
  facade.set("$profile.hash", options.seed.metadata.hash);
}
