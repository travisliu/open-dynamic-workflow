import { describe, expect, it } from "vitest";
import {
  isStrictConfigDiagnosticContext,
  getFatalConfigDiagnostics,
  hasFatalConfigDiagnostics,
  createConfigDiagnostic,
} from "../../../src/config/path-diagnostics.js";
import type { ConfigDiagnostic } from "../../../src/config/types.js";

describe("Path Diagnostics Helpers", () => {
  it("should identify strict and non-strict contexts", () => {
    expect(isStrictConfigDiagnosticContext("run")).toBe(false);
    expect(isStrictConfigDiagnosticContext("run-strict")).toBe(true);
    expect(isStrictConfigDiagnosticContext("validate")).toBe(false);
    expect(isStrictConfigDiagnosticContext("validate-strict")).toBe(true);
    expect(isStrictConfigDiagnosticContext("list-strict")).toBe(true);
    expect(isStrictConfigDiagnosticContext("list")).toBe(false);
    expect(isStrictConfigDiagnosticContext("doctor")).toBe(false);
  });

  it("should return fatal diagnostics only in strict contexts", () => {
    const fatalDiag: ConfigDiagnostic = {
      resource: "workflow",
      path: "workflow.include[0]",
      severity: "error",
      code: "CONFIG_PATH_OUTSIDE_WORKSPACE",
      message: "outside",
      fatalInStrictContext: true,
    };
    const warningDiag: ConfigDiagnostic = {
      resource: "workflow",
      path: "workflow.include[1]",
      severity: "warning",
      code: "CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX",
      message: "warning",
      fatalInStrictContext: false,
    };

    const diagnostics = [fatalDiag, warningDiag];

    // Non-strict contexts: no fatals
    expect(getFatalConfigDiagnostics(diagnostics, "list")).toEqual([]);
    expect(getFatalConfigDiagnostics(diagnostics, "doctor")).toEqual([]);
    expect(getFatalConfigDiagnostics(diagnostics, "run")).toEqual([]);
    expect(getFatalConfigDiagnostics(diagnostics, "validate")).toEqual([]);

    // Strict contexts: only the fatal one
    expect(getFatalConfigDiagnostics(diagnostics, "run-strict")).toEqual([fatalDiag]);
    expect(getFatalConfigDiagnostics(diagnostics, "validate-strict")).toEqual([fatalDiag]);
    expect(getFatalConfigDiagnostics(diagnostics, "list-strict")).toEqual([fatalDiag]);
  });

  it("should correctly report hasFatalConfigDiagnostics", () => {
    const fatalDiag = createConfigDiagnostic({
      resource: "tools",
      path: "tools.include[0]",
      severity: "error",
      code: "CONFIG_PATH_EMPTY_PATTERN",
      message: "empty",
      fatalInStrictContext: true,
    });
    const warningDiag = createConfigDiagnostic({
      resource: "tools",
      path: "tools.include[1]",
      severity: "warning",
      code: "CONFIG_PATH_LEGACY_KEY_USED",
      message: "legacy",
      fatalInStrictContext: false,
    });

    expect(hasFatalConfigDiagnostics([warningDiag], "run-strict")).toBe(false);
    expect(hasFatalConfigDiagnostics([fatalDiag], "run")).toBe(false);
    expect(hasFatalConfigDiagnostics([fatalDiag, warningDiag], "run-strict")).toBe(true);
  });
});
