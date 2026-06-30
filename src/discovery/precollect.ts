import type { NormalizedResourceDiscovery, NormalizedDiscoveryConfig, ConfigDiagnosticContext, ConfigDiagnostic } from "../config/types.js";
import { compileResourceDiscovery } from "./compile-patterns.js";
import { collectResourceCandidateFiles } from "./collect-files.js";
import type { PrecollectedResourceLoadInput, DiscoveryCollectionResult, DiscoveryRawResult, DiscoveryRawSummary } from "./types.js";

export interface PrecollectResourceResult {
  loadInput: PrecollectedResourceLoadInput;
  collectionResult: DiscoveryCollectionResult;
}

export interface PrecollectResourceInput {
  cwd: string;
  resourceType: "workflow" | "agent" | "tool";
  discovery: NormalizedResourceDiscovery;
  strict: boolean;
}

export async function precollectResourceForLoad(input: PrecollectResourceInput): Promise<PrecollectResourceResult> {
  const { cwd, resourceType, discovery, strict } = input;
  const compiled = compileResourceDiscovery({ cwd, discovery });
  const collectionResult = await collectResourceCandidateFiles({
    cwd,
    resourceType,
    include: discovery.include,
    exclude: discovery.exclude,
    compatibilityMode: discovery.compatibilityMode,
    includeSource: discovery.includeSource,
    excludeSource: discovery.excludeSource,
    strict,
  });

  return {
    loadInput: {
      candidateFiles: collectionResult.files,
      discoveryPolicy: {
        exclude: compiled.discovery.exclude,
      },
    },
    collectionResult,
  };
}

export async function precollectAllResourcesForLoad(input: {
  cwd: string;
  discovery: NormalizedDiscoveryConfig;
  strict: boolean;
}): Promise<{
  workflow: PrecollectResourceResult;
  sharedAgents: PrecollectResourceResult;
  tools: PrecollectResourceResult;
}> {
  const { cwd, discovery, strict } = input;
  const workflow = await precollectResourceForLoad({
    cwd,
    resourceType: "workflow",
    discovery: discovery.workflow,
    strict,
  });
  const sharedAgents = await precollectResourceForLoad({
    cwd,
    resourceType: "agent",
    discovery: discovery.sharedAgents,
    strict,
  });
  const tools = await precollectResourceForLoad({
    cwd,
    resourceType: "tool",
    discovery: discovery.tools,
    strict,
  });

  return {
    workflow,
    sharedAgents,
    tools,
  };
}

export async function checkDiscoveryPolicy(
  context: ConfigDiagnosticContext,
  configDiagnostics: any[],
  precollected: {
    workflow: PrecollectResourceResult;
    sharedAgents: PrecollectResourceResult;
    tools: PrecollectResourceResult;
  },
  cwd?: string
): Promise<void> {
  const { applyDiscoveryPolicy } = await import("./policy.js");
  const { OpenDynamicWorkflowError } = await import("../errors/types.js");
  const { ErrorCode } = await import("../errors/codes.js");
  const { resolve } = await import("node:path");

  const collectionDiagnostics = [
    ...(precollected.workflow.collectionResult.configDiagnostics || []),
    ...(precollected.sharedAgents.collectionResult.configDiagnostics || []),
    ...(precollected.tools.collectionResult.configDiagnostics || []),
  ];

  const listWarnings = [
    ...(precollected.workflow.collectionResult.diagnostics?.filter(d => d.severity === "warning") || []),
    ...(precollected.sharedAgents.collectionResult.diagnostics?.filter(d => d.severity === "warning") || []),
    ...(precollected.tools.collectionResult.diagnostics?.filter(d => d.severity === "warning") || []),
  ];

  const listErrors = [
    ...(precollected.workflow.collectionResult.diagnostics?.filter(d => d.severity === "error") || []),
    ...(precollected.sharedAgents.collectionResult.diagnostics?.filter(d => d.severity === "error") || []),
    ...(precollected.tools.collectionResult.diagnostics?.filter(d => d.severity === "error") || []),
  ];

  const summary: DiscoveryRawSummary = {
    discoveredCount:
      precollected.workflow.collectionResult.files.length +
      precollected.sharedAgents.collectionResult.files.length +
      precollected.tools.collectionResult.files.length,
    validCount:
      precollected.workflow.collectionResult.files.length +
      precollected.sharedAgents.collectionResult.files.length +
      precollected.tools.collectionResult.files.length,
    warningCount: listWarnings.length,
    errorCount: listErrors.length,
    configWarningCount: 0,
    configErrorCount: 0,
    countsByType: {
      workflow: precollected.workflow.collectionResult.files.length,
      agent: precollected.sharedAgents.collectionResult.files.length,
      tool: precollected.tools.collectionResult.files.length,
    },
  };

  const rawResult: DiscoveryRawResult = {
    schemaVersion: "open-dynamic-workflow.list.v1",
    resourceTypes: ["workflow", "agent", "tool"],
    resources: [],
    warnings: listWarnings,
    errors: listErrors,
    configDiagnostics: collectionDiagnostics,
    summary,
  };

  const policy = applyDiscoveryPolicy({
    context,
    rawResult,
    configDiagnostics,
    collectionDiagnostics,
  });

  if (policy.shouldFailBeforeLoad) {
    const allDiags = [...policy.fatalDiagnostics, ...policy.allConfigDiagnostics, ...policy.result.errors];
    
    const escapeDiag = allDiags.find((d) => d.code === "CONFIG_PATH_SYMLINK_ESCAPE") as ConfigDiagnostic | undefined;
    if (escapeDiag) {
      const rawVal = escapeDiag.value as string;
      const resolvePath = cwd ? resolve(cwd, rawVal) : rawVal;
      if (escapeDiag.resource === "sharedAgents") {
        throw new OpenDynamicWorkflowError(
          ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION,
          `Shared agent symlink '${resolvePath}' points outside the workspace.`
        );
      } else {
        throw new OpenDynamicWorkflowError(
          ErrorCode.SECURITY_POLICY_VIOLATION,
          `Workflow file outside project root: ${resolvePath}`
        );
      }
    }

    const details = allDiags
      .map((d) => `[${d.severity || "error"}] ${d.code}: ${d.message}`)
      .join("\n");
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_DISCOVERY_FAILED,
      `Discovery policy blocked loading. Reason:\n${details || "Discovery policy failure"}`
    );
  }
}
