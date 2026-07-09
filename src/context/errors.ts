import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { ContextOperationName } from "./types.js";

export function contextInvalidPath(
  operation: ContextOperationName,
  path: string,
  reason: string
): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_INVALID_PATH,
    `Context operation '${operation}' failed for path '${path}': ${reason}`
  );
}

export function contextInvalidValue(
  operation: ContextOperationName,
  path: string,
  reason: string
): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_INVALID_VALUE,
    `Context operation '${operation}' failed for path '${path}': ${reason}`
  );
}

export function contextSizeLimitExceeded(
  operation: ContextOperationName,
  path: string,
  bytes: number,
  limitBytes: number
): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED,
    `Context operation '${operation}' failed for path '${path}': size of ${bytes} bytes exceeds the limit of ${limitBytes} bytes`
  );
}

export function contextTypeMismatch(
  operation: ContextOperationName,
  path: string,
  reason: string
): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_TYPE_MISMATCH,
    `Context operation '${operation}' failed for path '${path}': ${reason}`
  );
}

export function contextMergeRuleRequired(
  operation: ContextOperationName,
  path: string,
  scopeId: string
): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_MERGE_RULE_REQUIRED,
    `Context operation '${operation}' failed for path '${path}' in scope '${scopeId}': merge rule required`
  );
}

export function contextMergeConflict(
  path: string,
  scopeId: string,
  parentScopeId: string,
  reason: string
): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_MERGE_CONFLICT,
    `Context merge conflict at path '${path}' (scope '${scopeId}' vs parent '${parentScopeId}'): ${reason}`
  );
}

export function contextInheritPathNotFound(
  path: string,
  parentScopeId: string,
  scopeId: string
): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_INHERIT_PATH_NOT_FOUND,
    `Required inherited path '${path}' not found in parent scope '${parentScopeId}' for child scope '${scopeId}'`
  );
}

export function contextArtifactWriteFailed(
  reason: string
): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_ARTIFACT_WRITE_FAILED,
    `Failed to write context artifact: ${reason}`
  );
}

