import type { ConfigDiagnostic, ConfigDiagnosticContext } from "../config/types.js";
import { getFatalConfigDiagnostics } from "../config/path-diagnostics.js";
import type { DiscoveryRawResult, ListResult, ListSummary } from "./types.js";
import { LIST_DIRECTORY_NOT_FOUND } from "./diagnostics.js";

export interface DiscoveryPolicyInput {
  context: ConfigDiagnosticContext;
  rawResult: DiscoveryRawResult;
  configDiagnostics?: ConfigDiagnostic[];
  collectionDiagnostics?: ConfigDiagnostic[];
}

export interface DiscoveryPolicyResult {
  result: ListResult;
  allConfigDiagnostics: ConfigDiagnostic[];
  fatalDiagnostics: ConfigDiagnostic[];
  configWarningCount: number;
  configErrorCount: number;
  shouldFailBeforeLoad: boolean;
}

export function applyDiscoveryPolicy(input: DiscoveryPolicyInput): DiscoveryPolicyResult {
  const context = input.context;
  const rawResult = input.rawResult;
  const configDiagnostics = input.configDiagnostics ?? [];
  const collectionDiagnostics = input.collectionDiagnostics ?? rawResult.configDiagnostics ?? [];

  // Merge config diagnostics in deterministic order
  const allConfigDiagnostics = [...configDiagnostics, ...collectionDiagnostics];

  // Compute fatal diagnostics
  const fatalDiagnostics = getFatalConfigDiagnostics(allConfigDiagnostics, context);

  // Compute config specific warning and error counts
  const configWarningCount = allConfigDiagnostics.filter(d => d.severity === "warning").length;
  const configErrorCount = allConfigDiagnostics.filter(d => d.severity === "error").length;

  // Recompute final summary counts
  const warningCount = rawResult.warnings.length + configWarningCount;
  const errorCount = rawResult.errors.length + configErrorCount;

  const summary: ListSummary = {
    ...rawResult.summary,
    warningCount,
    errorCount,
    configWarningCount,
    configErrorCount
  };

  // Compute final status
  let status: "succeeded" | "partially_succeeded" | "failed" = "succeeded";

  const allPathsFailed = rawResult.resourceTypes.length > 0 && 
    rawResult.resourceTypes.every(rt => 
      [...rawResult.errors, ...rawResult.warnings].some(
        d => d.resourceType === rt && d.code === LIST_DIRECTORY_NOT_FOUND
      ) &&
      !rawResult.resources.some(r => r.type === rt)
    );

  if (rawResult.errors.length > 0 || configErrorCount > 0 || fatalDiagnostics.length > 0 || allPathsFailed) {
    status = "failed";
  } else if (rawResult.warnings.length > 0 || configWarningCount > 0) {
    status = "partially_succeeded";
  }

  const result: ListResult = {
    schemaVersion: rawResult.schemaVersion,
    status,
    resourceTypes: rawResult.resourceTypes,
    resources: rawResult.resources,
    warnings: rawResult.warnings,
    errors: rawResult.errors,
    summary,
    configDiagnostics: allConfigDiagnostics
  };

  const shouldFailBeforeLoad = fatalDiagnostics.length > 0;

  return {
    result,
    allConfigDiagnostics,
    fatalDiagnostics,
    configWarningCount,
    configErrorCount,
    shouldFailBeforeLoad
  };
}
