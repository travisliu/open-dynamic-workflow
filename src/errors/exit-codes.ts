import { OpenDynamicWorkflowError } from "./types.js";
import { ErrorCode } from "./codes.js";

export enum ExitCode {
  Success = 0,
  GeneralError = 1,
  CLI_USAGE_ERROR = 2,
  WorkflowInvalid = 3,
  ResourceNotFound = 4,
  ExecutionFailed = 5,
  Cancelled = 6,
  Timeout = 7,
  InternalError = 8,
  SecurityViolation = 9
}

export function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof OpenDynamicWorkflowError) {
    switch (error.code) {
      case ErrorCode.CLI_USAGE_ERROR:
      case ErrorCode.CONFIG_VALIDATION_ERROR:
        return ExitCode.CLI_USAGE_ERROR;
      
      case ErrorCode.WORKFLOW_PARSE_ERROR:
      case ErrorCode.WORKFLOW_VALIDATION_ERROR:
      case ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND:
      case ErrorCode.WORKFLOW_DUPLICATE_DEFINITION:
      case ErrorCode.WORKFLOW_INVALID_CALL:
      case ErrorCode.WORKFLOW_INPUT_VALIDATION_FAILED:
      case ErrorCode.WORKFLOW_RECURSION_DETECTED:
      case ErrorCode.WORKFLOW_MAX_DEPTH_EXCEEDED:
      case ErrorCode.WORKFLOW_DUPLICATE_NAME:
      case ErrorCode.WORKFLOW_DISCOVERY_FAILED:
      case ErrorCode.WORKFLOW_INVALID_METADATA:
      case ErrorCode.WORKFLOW_RESUME_TARGET_CHANGED:
      case ErrorCode.TOOL_DEFINITION_NOT_FOUND:
      case ErrorCode.TOOL_DUPLICATE_DEFINITION:
      case ErrorCode.TOOL_INVALID_DEFINITION:
      case ErrorCode.TOOL_INVALID_CONTEXT:
        return ExitCode.WorkflowInvalid;

      case ErrorCode.PROVIDER_UNAVAILABLE:
      case ErrorCode.WORKFLOW_TARGET_NOT_FOUND:
      case ErrorCode.WORKFLOW_FILE_NOT_FOUND:
        return ExitCode.ResourceNotFound;

      case ErrorCode.SECURITY_POLICY_VIOLATION:
      case ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION:
        return ExitCode.SecurityViolation;

      case ErrorCode.USER_CANCELLED:
      case ErrorCode.TOOL_CANCELLED:
      case ErrorCode.WORKFLOW_CANCELLED:
        return ExitCode.Cancelled;

      case ErrorCode.PROCESS_TIMEOUT:
      case ErrorCode.WORKFLOW_TIMEOUT:
      case ErrorCode.TOOL_TIMEOUT:
        return ExitCode.Timeout;

      case ErrorCode.INTERNAL_ERROR:
      case ErrorCode.ARTIFACT_WRITE_FAILED:
      case ErrorCode.TOOL_ARTIFACT_WRITE_FAILED:
        return ExitCode.InternalError;

      case ErrorCode.PROVIDER_PROCESS_FAILED:
      case ErrorCode.SCHEMA_VALIDATION_FAILED:
      case ErrorCode.TOOL_EXECUTION_FAILED:
      case ErrorCode.TOOL_INVALID_INPUT:
      case ErrorCode.TOOL_INVALID_OUTPUT:
      case ErrorCode.TOOL_SERIALIZATION_FAILED:
      case ErrorCode.WORKFLOW_FAILED:
      case ErrorCode.RUN_LIMIT_EXCEEDED:
        return ExitCode.GeneralError;

      default:
        return ExitCode.ExecutionFailed;
    }
  }

  return ExitCode.InternalError;
}
