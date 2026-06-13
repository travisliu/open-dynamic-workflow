import { ListDiagnostic } from "./types.js";

export const LIST_DIRECTORY_NOT_FOUND = "LIST_DIRECTORY_NOT_FOUND";
export const LIST_FILE_UNREADABLE = "LIST_FILE_UNREADABLE";
export const WORKFLOW_METADATA_MISSING = "WORKFLOW_METADATA_MISSING";
export const WORKFLOW_METADATA_INVALID = "WORKFLOW_METADATA_INVALID";
export const WORKFLOW_DUPLICATE_NAME = "WORKFLOW_DUPLICATE_NAME";
export const AGENT_DEFINITION_MISSING = "AGENT_DEFINITION_MISSING";
export const AGENT_DEFINITION_INVALID = "AGENT_DEFINITION_INVALID";
export const AGENT_DUPLICATE_ID = "AGENT_DUPLICATE_ID";
export const TOOL_DEFINITION_MISSING = "TOOL_DEFINITION_MISSING";
export const TOOL_DEFINITION_INVALID = "TOOL_DEFINITION_INVALID";
export const TOOL_DUPLICATE_ID = "TOOL_DUPLICATE_ID";
export const LIST_INTERNAL_ERROR = "LIST_INTERNAL_ERROR";

export function listDiagnostic(input: Omit<ListDiagnostic, "severity"> & {
  severity?: "warning" | "error";
}): ListDiagnostic {
  return {
    severity: input.severity ?? "warning",
    resourceType: input.resourceType,
    path: input.path,
    code: input.code,
    message: input.message,
    ...(input.details ? { details: input.details } : {})
  };
}

export function normalizeDiagnosticSeverity(
  diagnostic: ListDiagnostic,
  strict: boolean
): ListDiagnostic {
  if (diagnostic.code === LIST_INTERNAL_ERROR) {
    return { ...diagnostic, severity: "error" };
  }
  if (strict && diagnostic.severity === "warning") {
    return { ...diagnostic, severity: "error" };
  }
  return diagnostic;
}
