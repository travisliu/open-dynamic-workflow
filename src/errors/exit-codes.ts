import { ErrorCode } from "./codes.js";
import { OpenFlowError } from "./types.js";

export const ExitCode = {
  Success: 0,
  WorkflowFailed: 1,
  CliUsage: 2,
  WorkflowInvalid: 3,
  ProviderUnavailable: 4,
  SecurityPolicyViolation: 5,
  UserCancelled: 6,
  Timeout: 7,
  InternalError: 8
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export function exitCodeForError(error: unknown): ExitCode {
  if (error && typeof error === "object") {
    const errObj = error as any;
    if (errObj.code === "commander.helpDisplayed" || errObj.code === "commander.help" || errObj.code === "commander.version" ||
        (errObj.cause && (errObj.cause.code === "commander.helpDisplayed" || errObj.cause.code === "commander.help" || errObj.cause.code === "commander.version"))) {
      return ExitCode.Success;
    }
  }
  const isOpenFlowError = error instanceof OpenFlowError || (error && typeof error === "object" && "code" in error && "name" in error && (error as any).name === "OpenFlowError");
  if (!isOpenFlowError) return ExitCode.InternalError;

  const code = (error as any).code;
  switch (code) {
    case ErrorCode.CLI_USAGE_ERROR:
    case ErrorCode.CONFIG_VALIDATION_ERROR:
      return ExitCode.CliUsage;
    case ErrorCode.WORKFLOW_PARSE_ERROR:
    case ErrorCode.WORKFLOW_VALIDATION_ERROR:
    case ErrorCode.SHARED_AGENT_NOT_FOUND:
    case ErrorCode.SHARED_AGENT_INVALID_DEFINITION:
    case ErrorCode.SHARED_AGENT_DUPLICATE_ID:
    case ErrorCode.SHARED_AGENT_CONTEXT_VALIDATION_FAILED:
    case ErrorCode.SHARED_AGENT_PROMPT_RENDER_FAILED:
    case ErrorCode.SHARED_AGENT_UNDECLARED_PROMPT_VARIABLE:
    case ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND:
    case ErrorCode.WORKFLOW_DUPLICATE_DEFINITION:
    case ErrorCode.WORKFLOW_INVALID_CALL:
    case ErrorCode.WORKFLOW_INPUT_VALIDATION_FAILED:
    case ErrorCode.WORKFLOW_RECURSION_DETECTED:
    case ErrorCode.WORKFLOW_MAX_DEPTH_EXCEEDED:
      return ExitCode.WorkflowInvalid;
    case ErrorCode.PROVIDER_UNAVAILABLE:
      return ExitCode.ProviderUnavailable;
    case ErrorCode.SECURITY_POLICY_VIOLATION:
    case ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION:
      return ExitCode.SecurityPolicyViolation;
    case ErrorCode.USER_CANCELLED:
      return ExitCode.UserCancelled;
    case ErrorCode.PROCESS_TIMEOUT:
    case ErrorCode.WORKFLOW_TIMEOUT:
      return ExitCode.Timeout;
    case ErrorCode.PROVIDER_PROCESS_FAILED:
    case ErrorCode.SCHEMA_VALIDATION_FAILED:
    case ErrorCode.UNSUPPORTED_CAPABILITY:
    case ErrorCode.SHARED_AGENT_RUNTIME_FAILED:
    case ErrorCode.WORKFLOW_RESULT_SERIALIZATION_FAILED:
    case ErrorCode.TOOL_EXECUTION_FAILED:
    case ErrorCode.TOOL_CANCELLED:
    case ErrorCode.TOOL_TIMEOUT:
    case ErrorCode.TOOL_INVALID_OUTPUT:
    case ErrorCode.TOOL_ARTIFACT_WRITE_FAILED:
    case ErrorCode.TOOL_SERIALIZATION_FAILED:
      return ExitCode.WorkflowFailed;

    default:
      return ExitCode.InternalError;
  }
}
