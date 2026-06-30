import { describe, expect, it } from "vitest";
import { mapListExitCode } from "../../../src/errors/list-errors.js";
import { ExitCode } from "../../../src/errors/exit-codes.js";
import type { ListResult } from "../../../src/discovery/types.js";

describe("List Errors Exit Code Mapping", () => {
  it("maps internal discovery error to ExitCode.InternalError (8) even in non-strict mode", () => {
    const result: Partial<ListResult> = {
      errors: [{ code: "LIST_INTERNAL_ERROR", message: "internal error" } as any],
      summary: {
        errorCount: 1,
        warningCount: 0,
        configErrorCount: 1,
        configWarningCount: 0,
        discoveredCount: 0,
        validCount: 0,
        countsByType: {}
      }
    };
    expect(mapListExitCode(result as ListResult, { strict: false })).toBe(ExitCode.InternalError);
    expect(mapListExitCode(result as ListResult, { strict: true })).toBe(ExitCode.InternalError);
  });

  it("non-strict warning-only result exits success (0)", () => {
    const result: Partial<ListResult> = {
      errors: [],
      warnings: [{ code: "SOME_WARNING", message: "warning" } as any],
      status: "partially_succeeded",
      summary: {
        errorCount: 0,
        warningCount: 1,
        configErrorCount: 0,
        configWarningCount: 1,
        discoveredCount: 1,
        validCount: 1,
        countsByType: {}
      }
    };
    expect(mapListExitCode(result as ListResult, { strict: false })).toBe(ExitCode.Success);
  });

  it("strict warning-only result exits success (0)", () => {
    const result: Partial<ListResult> = {
      errors: [],
      warnings: [{ code: "SOME_WARNING", message: "warning" } as any],
      status: "partially_succeeded",
      summary: {
        errorCount: 0,
        warningCount: 1,
        configErrorCount: 0,
        configWarningCount: 1,
        discoveredCount: 1,
        validCount: 1,
        countsByType: {}
      }
    };
    expect(mapListExitCode(result as ListResult, { strict: true })).toBe(ExitCode.Success);
  });

  it("strict error result exits ExitCode.WorkflowInvalid (3)", () => {
    const result: Partial<ListResult> = {
      errors: [{ code: "SOME_ERROR", message: "error" } as any],
      status: "failed",
      summary: {
        errorCount: 1,
        warningCount: 0,
        configErrorCount: 0,
        configWarningCount: 0,
        discoveredCount: 1,
        validCount: 0,
        countsByType: {}
      }
    };
    expect(mapListExitCode(result as ListResult, { strict: true })).toBe(ExitCode.WorkflowInvalid);
  });
});
