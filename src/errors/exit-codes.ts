import { ErrorCode } from "./codes.js";
import { ExecflowError } from "./types.js";

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
  if (!(error instanceof ExecflowError)) return ExitCode.InternalError;

  switch (error.code) {
    case ErrorCode.CLI_USAGE_ERROR:
    case ErrorCode.CONFIG_VALIDATION_ERROR:
      return ExitCode.CliUsage;
    case ErrorCode.WORKFLOW_PARSE_ERROR:
    case ErrorCode.WORKFLOW_VALIDATION_ERROR:
      return ExitCode.WorkflowInvalid;
    case ErrorCode.PROVIDER_UNAVAILABLE:
      return ExitCode.ProviderUnavailable;
    case ErrorCode.SECURITY_POLICY_VIOLATION:
      return ExitCode.SecurityPolicyViolation;
    case ErrorCode.USER_CANCELLED:
      return ExitCode.UserCancelled;
    case ErrorCode.PROCESS_TIMEOUT:
      return ExitCode.Timeout;
    case ErrorCode.PROVIDER_PROCESS_FAILED:
    case ErrorCode.SCHEMA_VALIDATION_FAILED:
      return ExitCode.WorkflowFailed;
    default:
      return ExitCode.InternalError;
  }
}
