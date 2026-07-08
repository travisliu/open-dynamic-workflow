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
