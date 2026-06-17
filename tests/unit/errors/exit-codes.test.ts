import { describe, expect, it } from "vitest";
import { exitCodeForError, ExitCode } from "../../../src/errors/exit-codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("Exit Codes Mapping", () => {
  it("maps CLI_USAGE_ERROR to CLI_USAGE_ERROR (2)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, "usage error");
    expect(exitCodeForError(err)).toBe(ExitCode.CLI_USAGE_ERROR);
  });

  it("maps CONFIG_VALIDATION_ERROR to CLI_USAGE_ERROR (2)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.CONFIG_VALIDATION_ERROR, "invalid config");
    expect(exitCodeForError(err)).toBe(ExitCode.CLI_USAGE_ERROR);
  });

  it("maps WORKFLOW_PARSE_ERROR to WorkflowInvalid (3)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_PARSE_ERROR, "syntax error");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
  });

  it("maps WORKFLOW_VALIDATION_ERROR to WorkflowInvalid (3)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, "invalid features used");
    expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
  });

  it("maps nested workflow validation/setup errors to WorkflowInvalid (3)", () => {
    const codes = [
      ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND,
      ErrorCode.WORKFLOW_DUPLICATE_DEFINITION,
      ErrorCode.WORKFLOW_INVALID_CALL,
      ErrorCode.WORKFLOW_INPUT_VALIDATION_FAILED,
      ErrorCode.WORKFLOW_RECURSION_DETECTED,
      ErrorCode.WORKFLOW_MAX_DEPTH_EXCEEDED,
      ErrorCode.WORKFLOW_DUPLICATE_NAME,
      ErrorCode.WORKFLOW_DISCOVERY_FAILED,
      ErrorCode.WORKFLOW_INVALID_METADATA,
      ErrorCode.WORKFLOW_RESUME_TARGET_CHANGED
    ];

    for (const code of codes) {
      const err = new OpenDynamicWorkflowError(code, "test error");
      expect(exitCodeForError(err)).toBe(ExitCode.WorkflowInvalid);
    }
  });

  it("maps workflow target and file not found to ResourceNotFound (4)", () => {
    const codes = [
      ErrorCode.WORKFLOW_TARGET_NOT_FOUND,
      ErrorCode.WORKFLOW_FILE_NOT_FOUND
    ];

    for (const code of codes) {
      const err = new OpenDynamicWorkflowError(code, "test error");
      expect(exitCodeForError(err)).toBe(ExitCode.ResourceNotFound);
    }
  });

  it("maps WORKFLOW_RESULT_SERIALIZATION_FAILED to ExecutionFailed (5)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_RESULT_SERIALIZATION_FAILED, "serialization failed");
    expect(exitCodeForError(err)).toBe(ExitCode.ExecutionFailed);
  });

  it("maps WORKFLOW_TIMEOUT to Timeout (7)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_TIMEOUT, "workflow timed out");
    expect(exitCodeForError(err)).toBe(ExitCode.Timeout);
  });

  it("maps PROVIDER_UNAVAILABLE to ResourceNotFound (4)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.PROVIDER_UNAVAILABLE, "provider missing");
    expect(exitCodeForError(err)).toBe(ExitCode.ResourceNotFound);
  });

  it("maps SECURITY_POLICY_VIOLATION to SecurityViolation (9)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.SECURITY_POLICY_VIOLATION, "unauthorized access");
    expect(exitCodeForError(err)).toBe(ExitCode.SecurityViolation);
  });

  it("maps USER_CANCELLED to Cancelled (6)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.USER_CANCELLED, "user cancelled");
    expect(exitCodeForError(err)).toBe(ExitCode.Cancelled);
  });

  it("maps PROCESS_TIMEOUT to Timeout (7)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.PROCESS_TIMEOUT, "timed out");
    expect(exitCodeForError(err)).toBe(ExitCode.Timeout);
  });

  it("maps PROVIDER_PROCESS_FAILED to GeneralError (1)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.PROVIDER_PROCESS_FAILED, "provider process failed");
    expect(exitCodeForError(err)).toBe(ExitCode.GeneralError);
  });

  it("maps BUDGET_EXCEEDED to GeneralError (1)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.BUDGET_EXCEEDED, "budget exceeded");
    expect(exitCodeForError(err)).toBe(ExitCode.GeneralError);
  });

  it("maps SCHEMA_VALIDATION_FAILED to GeneralError (1)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.SCHEMA_VALIDATION_FAILED, "json schema failed");
    expect(exitCodeForError(err)).toBe(ExitCode.GeneralError);
  });

  it("maps TOOL_INVALID_OUTPUT to GeneralError (1)", () => {
    const err = new OpenDynamicWorkflowError(ErrorCode.TOOL_INVALID_OUTPUT, "tool output validation failed");
    expect(exitCodeForError(err)).toBe(ExitCode.GeneralError);
  });

  it("maps unknown or standard error to InternalError (8)", () => {
    const stdErr = new Error("something went wrong");
    expect(exitCodeForError(stdErr)).toBe(ExitCode.InternalError);

    const plainObj = {};
    expect(exitCodeForError(plainObj)).toBe(ExitCode.InternalError);
  });
});
