import { describe, expect, it } from "vitest";
import { exitCodeForError, ExitCode } from "../../../src/errors/exit-codes.js";
import { ExecflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("Exit Codes Mapping", () => {
  it("maps CLI_USAGE_ERROR to CliUsage (2)", () => {
    const err = new ExecflowError(ErrorCode.CLI_USAGE_ERROR, "usage error");
    expect(exitCodeForError(err)).toBe(ExitCode.CliUsage);
  });

  it("maps CONFIG_VALIDATION_ERROR to CliUsage (2)", () => {
    const err = new ExecflowError(ErrorCode.CONFIG_VALIDATION_ERROR, "invalid config");
    expect(exitCodeForError(err)).toBe(ExitCode.CliUsage);
  });

  it("maps WORKFLOW_PARSE_ERROR to WorkflowInvalid (3)", () => {
    const err = new ExecflowError(ErrorCode.WORKFLOW_PARSE_ERROR, "syntax error");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
  });

  it("maps WORKFLOW_VALIDATION_ERROR to WorkflowInvalid (3)", () => {
    const err = new ExecflowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, "invalid features used");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
  });

  it("maps PROVIDER_UNAVAILABLE to ProviderUnavailable (4)", () => {
    const err = new ExecflowError(ErrorCode.PROVIDER_UNAVAILABLE, "provider missing");
    expect(exitCodeForError(err)).toBe(ExitCode.ProviderUnavailable);
  });

  it("maps SECURITY_POLICY_VIOLATION to SecurityPolicyViolation (5)", () => {
    const err = new ExecflowError(ErrorCode.SECURITY_POLICY_VIOLATION, "unauthorized access");
    expect(exitCodeForError(err)).toBe(ExitCode.SecurityPolicyViolation);
  });

  it("maps USER_CANCELLED to UserCancelled (6)", () => {
    const err = new ExecflowError(ErrorCode.USER_CANCELLED, "user cancelled");
    expect(exitCodeForError(err)).toBe(ExitCode.UserCancelled);
  });

  it("maps PROCESS_TIMEOUT to Timeout (7)", () => {
    const err = new ExecflowError(ErrorCode.PROCESS_TIMEOUT, "timed out");
    expect(exitCodeForError(err)).toBe(ExitCode.Timeout);
  });

  it("maps PROVIDER_PROCESS_FAILED to WorkflowFailed (1)", () => {
    const err = new ExecflowError(ErrorCode.PROVIDER_PROCESS_FAILED, "provider process failed");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowFailed);
  });

  it("maps SCHEMA_VALIDATION_FAILED to WorkflowFailed (1)", () => {
    const err = new ExecflowError(ErrorCode.SCHEMA_VALIDATION_FAILED, "json schema failed");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowFailed);
  });

  it("maps unknown or standard error to InternalError (8)", () => {
    const stdErr = new Error("something went wrong");
    expect(exitCodeForError(stdErr)).toBe(ExitCode.InternalError);

    const plainObj = {};
    expect(exitCodeForError(plainObj)).toBe(ExitCode.InternalError);
  });
});
