import { ExitCode } from "./exit-codes.js";
import type { ListResult } from "../discovery/types.js";

export function mapListExitCode(result: ListResult, options: { strict: boolean }): number {
  if (result.errors.some((e) => e.code === "LIST_INTERNAL_ERROR")) {
    return ExitCode.InternalError;
  }

  const hasStrictFatalConfigDiag = result.configDiagnostics?.some((d) => d.fatalInStrictContext) ?? false;

  if (options.strict && (result.errors.length > 0 || result.status === "failed" || hasStrictFatalConfigDiag)) {
    return ExitCode.WorkflowInvalid;
  }

  return ExitCode.Success;
}
