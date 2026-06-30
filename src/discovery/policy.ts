import type { ConfigDiagnostic, ConfigDiagnosticContext } from "../config/types.js";
import { getFatalConfigDiagnostics } from "../config/path-diagnostics.js";
import type { DiscoveryRawResult, ListResult, ListSummary, ListDiagnostic } from "./types.js";
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

function checkAllPathsFailed(rawResult: DiscoveryRawResult): boolean {
  if (!Array.isArray(rawResult.resourceTypes) || rawResult.resourceTypes.length === 0) {
    return false;
  }
  return rawResult.resourceTypes.every(rt =>
    [...rawResult.errors, ...rawResult.warnings].some(
      d => d.resourceType === rt && d.code === LIST_DIRECTORY_NOT_FOUND
    ) &&
    !rawResult.resources.some(r => r.type === rt)
  );
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

  const allPathsFailed = checkAllPathsFailed(rawResult);

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

  // Determine if this is a strict context
  const isStrict =
    context === "run-strict" ||
    context === "validate-strict" ||
    context === "list-strict";

  // Determine if this is an execution context
  const isExecutionContext =
    context === "run" ||
    context === "run-strict" ||
    context === "validate" ||
    context === "validate-strict";

  // Check for any actual hard config errors (excluding warnings and strict-fatal errors in non-strict contexts)
  const hasHardConfigErrors = allConfigDiagnostics.some(
    d => d.severity === "error" && (!d.fatalInStrictContext || isStrict)
  );

  // Check for any hard collection/discovery errors
  const hasHardCollectionErrors = rawResult.errors.length > 0;

  // Compute central block/fail decision
  const shouldFailBeforeLoad =
    fatalDiagnostics.length > 0 ||
    (isStrict && status === "failed") ||
    (isExecutionContext &&
      (hasHardConfigErrors ||
       hasHardCollectionErrors ||
       allPathsFailed));

  return {
    result,
    allConfigDiagnostics,
    fatalDiagnostics,
    configWarningCount,
    configErrorCount,
    shouldFailBeforeLoad
  };
}

export interface DiscoveryLoadPolicyDecision {
  policy: DiscoveryPolicyResult;
  shouldBlockLoad: boolean;
  blockingDiagnostics: Array<ConfigDiagnostic | ListDiagnostic>;
  symlinkEscapeDiagnostic?: ConfigDiagnostic | undefined;
}

export function evaluateDiscoveryLoadPolicy(input: DiscoveryPolicyInput): DiscoveryLoadPolicyDecision {
  const policy = applyDiscoveryPolicy(input);
  const context = input.context;

  // Determine if this is a strict context
  const isStrict =
    context === "run-strict" ||
    context === "validate-strict" ||
    context === "list-strict";

  // Check for any actual hard config errors (excluding warnings and strict-fatal errors in non-strict contexts)
  const hasHardConfigErrors = policy.allConfigDiagnostics.some(
    d => d.severity === "error" && (!d.fatalInStrictContext || isStrict)
  );

  // Check for all-paths-failed condition
  const rawResult = input.rawResult;
  const allPathsFailed = checkAllPathsFailed(rawResult);

  // Trust the policy-owned decision directly
  const shouldBlockLoad = policy.shouldFailBeforeLoad;

  const blockingDiagnostics: Array<ConfigDiagnostic | ListDiagnostic> = [
    ...policy.fatalDiagnostics,
    ...policy.result.errors
  ];

  if (hasHardConfigErrors) {
    const hardConfigErrors = policy.allConfigDiagnostics.filter(
      d => d.severity === "error" && (!d.fatalInStrictContext || isStrict)
    );
    for (const d of hardConfigErrors) {
      if (!blockingDiagnostics.includes(d)) {
        blockingDiagnostics.push(d);
      }
    }
  }

  if (allPathsFailed) {
    const allPathsFailedDiagnostics = [...policy.result.errors, ...policy.result.warnings].filter(
      d => d.code === LIST_DIRECTORY_NOT_FOUND
    );
    for (const d of allPathsFailedDiagnostics) {
      if (!blockingDiagnostics.includes(d)) {
        blockingDiagnostics.push(d);
      }
    }
  }

  const symlinkEscapeDiagnostic = (
    policy.fatalDiagnostics.find(d => d.code === "CONFIG_PATH_SYMLINK_ESCAPE") ||
    policy.allConfigDiagnostics.find(d => d.code === "CONFIG_PATH_SYMLINK_ESCAPE") ||
    policy.result.errors.find(d => d.code === "CONFIG_PATH_SYMLINK_ESCAPE")
  ) as ConfigDiagnostic | undefined;

  return {
    policy,
    shouldBlockLoad,
    blockingDiagnostics,
    symlinkEscapeDiagnostic
  };
}
