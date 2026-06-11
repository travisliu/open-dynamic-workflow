import { describe, expect, it } from "vitest";
import { exitCodeForError, ExitCode } from "../../../src/errors/exit-codes.js";
import { OpenFlowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("Exit Codes Mapping", () => {
  it("maps CLI_USAGE_ERROR to CliUsage (2)", () => {
    const err = new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, "usage error");
    expect(exitCodeForError(err)).toBe(ExitCode.CliUsage);
  });

  it("maps CONFIG_VALIDATION_ERROR to CliUsage (2)", () => {
    const err = new OpenFlowError(ErrorCode.CONFIG_VALIDATION_ERROR, "invalid config");
    expect(exitCodeForError(err)).toBe(ExitCode.CliUsage);
  });

  it("maps WORKFLOW_PARSE_ERROR to WorkflowInvalid (3)", () => {
    const err = new OpenFlowError(ErrorCode.WORKFLOW_PARSE_ERROR, "syntax error");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
  });

  it("maps WORKFLOW_VALIDATION_ERROR to WorkflowInvalid (3)", () => {
    const err = new OpenFlowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, "invalid features used");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
  });

  it("maps nested workflow validation/setup errors to WorkflowInvalid (3)", () => {
    const codes = [
      ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND,
      ErrorCode.WORKFLOW_DUPLICATE_DEFINITION,
      ErrorCode.WORKFLOW_INVALID_CALL,
      ErrorCode.WORKFLOW_INPUT_VALIDATION_FAILED,
      ErrorCode.WORKFLOW_RECURSION_DETECTED,
      ErrorCode.WORKFLOW_MAX_DEPTH_EXCEEDED
    ];

    for (const code of codes) {
      const err = new OpenFlowError(code, "test error");
      expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
    }
  });

  it("maps WORKFLOW_RESULT_SERIALIZATION_FAILED to WorkflowFailed (1)", () => {
    const err = new OpenFlowError(ErrorCode.WORKFLOW_RESULT_SERIALIZATION_FAILED, "serialization failed");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowFailed);
  });

  it("maps WORKFLOW_TIMEOUT to Timeout (7)", () => {
    const err = new OpenFlowError(ErrorCode.WORKFLOW_TIMEOUT, "workflow timed out");
    expect(exitCodeForError(err)).toBe(ExitCode.Timeout);
  });

  it("maps PROVIDER_UNAVAILABLE to ProviderUnavailable (4)", () => {
    const err = new OpenFlowError(ErrorCode.PROVIDER_UNAVAILABLE, "provider missing");
    expect(exitCodeForError(err)).toBe(ExitCode.ProviderUnavailable);
  });

  it("maps SECURITY_POLICY_VIOLATION to SecurityPolicyViolation (5)", () => {
    const err = new OpenFlowError(ErrorCode.SECURITY_POLICY_VIOLATION, "unauthorized access");
    expect(exitCodeForError(err)).toBe(ExitCode.SecurityPolicyViolation);
  });

  it("maps USER_CANCELLED to UserCancelled (6)", () => {
    const err = new OpenFlowError(ErrorCode.USER_CANCELLED, "user cancelled");
    expect(exitCodeForError(err)).toBe(ExitCode.UserCancelled);
  });

  it("maps PROCESS_TIMEOUT to Timeout (7)", () => {
    const err = new OpenFlowError(ErrorCode.PROCESS_TIMEOUT, "timed out");
    expect(exitCodeForError(err)).toBe(ExitCode.Timeout);
  });

  it("maps PROVIDER_PROCESS_FAILED to WorkflowFailed (1)", () => {
    const err = new OpenFlowError(ErrorCode.PROVIDER_PROCESS_FAILED, "provider process failed");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowFailed);
  });

  it("maps SCHEMA_VALIDATION_FAILED to WorkflowFailed (1)", () => {
    const err = new OpenFlowError(ErrorCode.SCHEMA_VALIDATION_FAILED, "json schema failed");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowFailed);
  });

  it("maps unknown or standard error to InternalError (8)", () => {
    const stdErr = new Error("something went wrong");
    expect(exitCodeForError(stdErr)).toBe(ExitCode.InternalError);

    const plainObj = {};
    expect(exitCodeForError(plainObj)).toBe(ExitCode.InternalError);
  });
});
