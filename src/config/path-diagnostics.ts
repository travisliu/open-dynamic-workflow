import type {
  ConfigDiagnostic,
  ConfigDiagnosticContext,
} from "./types.js";

/**
 * Defines whether a configuration diagnostic context enforces strict checking.
 * Strict contexts are 'run', 'validate', and 'list-strict'.
 * Non-strict contexts are 'list' and 'doctor'.
 */
export function isStrictConfigDiagnosticContext(
  context: ConfigDiagnosticContext
): boolean {
  return context === "run" || context === "validate" || context === "list-strict";
}

/**
 * Returns only the diagnostics that are fatal in the given context.
 * In a non-strict context, no diagnostics are fatal (returns empty array).
 * In a strict context, only diagnostics with fatalInStrictContext: true are fatal.
 */
export function getFatalConfigDiagnostics(
  diagnostics: ConfigDiagnostic[],
  context: ConfigDiagnosticContext
): ConfigDiagnostic[] {
  if (!isStrictConfigDiagnosticContext(context)) {
    return [];
  }
  return diagnostics.filter((d) => d.fatalInStrictContext);
}

/**
 * Checks if there are any fatal diagnostics in the given context.
 */
export function hasFatalConfigDiagnostics(
  diagnostics: ConfigDiagnostic[],
  context: ConfigDiagnosticContext
): boolean {
  return getFatalConfigDiagnostics(diagnostics, context).length > 0;
}

/**
 * Plain identity helper constructor for config diagnostics to ensure object structure.
 * Does not throw, keeps helper output as plain data.
 */
export function createConfigDiagnostic(input: ConfigDiagnostic): ConfigDiagnostic {
  return {
    ...input,
  };
}
