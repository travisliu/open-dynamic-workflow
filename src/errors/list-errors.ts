import { ExitCode } from "./exit-codes.js";
import type { ListResult } from "../discovery/types.js";

export function mapListExitCode(result: ListResult, options: { strict: boolean }): number {
  if (result.errors.some((e) => e.code === "LIST_INTERNAL_ERROR")) {
    return ExitCode.InternalError;
  }

  if (options.strict && result.summary.errorCount > 0) {
    return ExitCode.WorkflowInvalid;
  }

  return ExitCode.Success;
}
