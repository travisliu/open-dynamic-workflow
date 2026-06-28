import { resolve, relative, isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { createDiscoveryService } from "../discovery/service.js";
import { loadWorkflow } from "./load.js";
import { parseWorkflow } from "./parse.js";
import type { ResolvedOpenDynamicWorkflowConfig } from "../config/types.js";
import type { ListedWorkflow } from "../discovery/types.js";

export type WorkflowTargetKind = "workflow-name" | "workflow-file";

export type WorkflowDiscoverySource =
  | "list-discovery"
  | "file-path"
  | "resume-recorded-file";

export interface WorkflowTargetMetadata {
  name: string;
  description: string;
  phases?: string[] | undefined;
  version?: string | undefined;
  tags?: string[] | undefined;
  inputSchema?: unknown;
}

export interface ResolvedWorkflowTarget {
  requestedTarget: string;
  targetKind: WorkflowTargetKind;
  workflowName: string;
  workflowFile: string;
  workflowFileRelative: string;
  cwd: string;
  configPath?: string | undefined;
  discoverySource: WorkflowDiscoverySource;
  metadata: WorkflowTargetMetadata;
  candidatePaths?: string[] | undefined;
}

export interface ResolveWorkflowTargetInput {
  target: string;
  cwd: string;
  config: ResolvedOpenDynamicWorkflowConfig;
  mode: "run" | "validate";
  allowPathLikeFastPath?: boolean | undefined;
}

export interface ResolveWorkflowFileTargetInput {
  target: string;
  cwd: string;
  config: ResolvedOpenDynamicWorkflowConfig;
  fallbackFromName?: boolean | undefined;
}

export interface ResolveWorkflowNameTargetInput {
  name: string;
  cwd: string;
  config: ResolvedOpenDynamicWorkflowConfig;
}

export function isPathLikeWorkflowTarget(target: string): boolean {
  if (isAbsolute(target)) return true;
  if (target.includes("/") || target.includes("\\")) return true;
  if (target.startsWith("./") || target.startsWith("../")) return true;
  const lower = target.toLowerCase();
  return (
    lower.endsWith(".ts") ||
    lower.endsWith(".js") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cts") ||
    lower.endsWith(".cjs")
  );
}

export async function resolveWorkflowTarget(
  input: ResolveWorkflowTargetInput
): Promise<ResolvedWorkflowTarget> {
  const { target, cwd, config, allowPathLikeFastPath = true } = input;

  if (!target || target.trim() === "") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_TARGET_NOT_FOUND,
      "Workflow target is required."
    );
  }

  // 1. Path-like fast-path
  if (allowPathLikeFastPath && isPathLikeWorkflowTarget(target)) {
    return resolveWorkflowFileTarget({ target, cwd, config });
  }

  // 2. Bare name lookup
  const resolvedByName = await resolveWorkflowNameTarget({
    name: target,
    cwd,
    config,
  });

  if (resolvedByName) {
    return resolvedByName;
  }

  // 3. Fallback to file target if bare name didn't match anything
  try {
    return await resolveWorkflowFileTarget({
      target,
      cwd,
      config,
      fallbackFromName: true,
    });
  } catch (err) {
    // If fallback fails, throw a target-not-found error that suggests list
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_TARGET_NOT_FOUND,
      `Workflow "${target}" not found by name or file path. Try "open-dynamic-workflow list workflows" to see available workflows.`,
      { cause: err }
    );
  }
}

export async function resolveWorkflowFileTarget(
  input: ResolveWorkflowFileTargetInput
): Promise<ResolvedWorkflowTarget> {
  const { target, cwd, config } = input;
  const absolutePath = resolve(cwd, target);

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(absolutePath);
  } catch (cause) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_FILE_NOT_FOUND,
      `Workflow file not found: ${absolutePath}`,
      { cause }
    );
  }

  const canonicalCwd = await realpath(resolve(cwd)).catch(() => resolve(cwd));
  const rel = relative(canonicalCwd, canonicalPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.SECURITY_POLICY_VIOLATION,
      `Workflow file outside project root: ${canonicalPath}`
    );
  }

  const loaded = await loadWorkflow(absolutePath, cwd);
  const parsed = parseWorkflow(loaded);

  return {
    requestedTarget: target,
    targetKind: "workflow-file",
    workflowName: parsed.meta.name,
    workflowFile: absolutePath,
    workflowFileRelative: relative(cwd, absolutePath),
    cwd,
    configPath: config.configPath,
    discoverySource: "file-path",
    metadata: {
      name: parsed.meta.name,
      description: parsed.meta.description,
      phases: parsed.meta.phases,
      version: parsed.meta.version,
      tags: parsed.meta.tags,
      inputSchema: parsed.meta.inputSchema,
    },
  };
}

export async function resolveWorkflowNameTarget(
  input: ResolveWorkflowNameTargetInput
): Promise<ResolvedWorkflowTarget | null> {
  const { name, cwd, config } = input;
  let workflowPatterns = config._normalizedDiscovery?.workflow;
  if (!workflowPatterns) {
    const { normalizeDiscoveryConfig } = await import("../config/path-discovery.js");
    const normalized = normalizeDiscoveryConfig({ config, cwd, rawConfig: config });
    workflowPatterns = normalized.discovery.workflow;
  }
  const patterns = {
    workflow: {
      include: workflowPatterns.include,
      exclude: workflowPatterns.exclude,
      compatibilityMode: workflowPatterns.compatibilityMode,
      includeSource: workflowPatterns.includeSource,
      excludeSource: workflowPatterns.excludeSource,
    },
    agent: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" as const },
    tool: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" as const },
  };

  const discoveryService = createDiscoveryService();
  const discoveryResult = await discoveryService.discover({
    cwd,
    resourceTypes: ["workflow"],
    patterns,
    verbose: false,
    strict: false,
  });

  if (discoveryResult.status === "failed") {
    const allDiags = [...discoveryResult.errors, ...discoveryResult.warnings];
    const errorDetails = allDiags.length > 0
      ? allDiags.map((e) => `- ${e.path || "unknown"}: ${e.message}`).join("\n")
      : "- unknown error during directory scan";
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_DISCOVERY_FAILED,
      `Could not resolve workflow target "${name}" because workflow discovery failed.\n\nDiscovery errors:\n${errorDetails}\n\nCheck --cwd, --config, and workflow.include (note: legacy workflow.discovery.include is still supported during migration).`
    );
  }

  const matches = discoveryResult.resources.filter(
    (r): r is ListedWorkflow => r.type === "workflow" && r.name === name
  );

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    const paths = matches.map((m) => m.path).join(", ");
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_DUPLICATE_NAME,
      `Multiple workflows found with name "${name}": ${paths}`
    );
  }

  const match = matches[0]!;
  const absolutePath = isAbsolute(match.path) ? match.path : resolve(cwd, match.path);

  // Build candidatePaths from valid statically discovered workflows.
  // We only include workflows with unique names to avoid registry collisions,
  // unless it's the specific workflow we matched (which is unique anyway if we reached here).
  const nameCounts = new Map<string, number>();
  for (const r of discoveryResult.resources) {
    if (r.type === "workflow" && r.valid) {
      nameCounts.set(r.name, (nameCounts.get(r.name) || 0) + 1);
    }
  }

  const candidatePaths = discoveryResult.resources
    .filter((r): r is ListedWorkflow => {
      if (r.type !== "workflow" || !r.valid) return false;
      // Include it if it's the one we matched, or if its name is unique
      return r.name === name || (nameCounts.get(r.name) || 0) === 1;
    })
    .map((r) => (isAbsolute(r.path) ? r.path : resolve(cwd, r.path)));

  return {
    requestedTarget: name,
    targetKind: "workflow-name",
    workflowName: match.name,
    workflowFile: absolutePath,
    workflowFileRelative: relative(cwd, absolutePath),
    cwd,
    configPath: config.configPath,
    discoverySource: "list-discovery",
    metadata: {
      name: match.name,
      description: match.description,
      phases: match.phases,
      version: match.version,
      tags: match.tags,
      inputSchema: match.inputSchema,
    },
    candidatePaths,
  };
}
