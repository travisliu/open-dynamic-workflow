import { promises as fs } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { loadWorkflow } from "./load.js";
import { parseWorkflow } from "./parse.js";
import { assertWorkflowValid, validateRegistryDependencies } from "./validate.js";
import { createWorkflowRegistry, type WorkflowDefinition, type WorkflowRegistry } from "./registry.js";
import type { SharedAgentRegistry } from "../shared-agents/registry.js";
import type { ToolRegistry } from "../types/tool.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { walk, matchGlob, getGlobBaseDir } from "../discovery/file-patterns.js";
import type { ResourceDiscoveryPatterns, PrecollectedResourceLoadInput } from "../discovery/types.js";
import { collectResourceCandidateFiles } from "../discovery/collect-files.js";

export { walk, matchGlob, getGlobBaseDir };

export interface DiscoverWorkflowRegistryInput {
  rootWorkflowPath: string;
  cwd: string;
  include?: string[];
  discovery?: ResourceDiscoveryPatterns;
  sharedAgentRegistry?: SharedAgentRegistry;
  candidatePaths?: string[] | undefined;
  precollected?: PrecollectedResourceLoadInput;
  allowDynamicSharedAgentIds?: boolean;
  toolRegistry?: ToolRegistry;
  maxLoopRounds?: number;
}

export async function discoverWorkflowRegistry(input: DiscoverWorkflowRegistryInput): Promise<WorkflowRegistry> {
  const { rootWorkflowPath, cwd, include, discovery, sharedAgentRegistry, candidatePaths, precollected, maxLoopRounds } = input;
  const absoluteCwd = resolve(cwd);
  const absoluteRootPath = resolve(absoluteCwd, rootWorkflowPath);

  const canonicalCwd = await fs.realpath(absoluteCwd).catch(() => absoluteCwd);

  const pathsToProcess = new Set<string>();
  const strictPaths = new Set<string>();

  pathsToProcess.add(absoluteRootPath);
  strictPaths.add(absoluteRootPath);

  if (precollected) {
    const workflowCandidates = precollected.candidateFiles
      .filter((c) => c.resourceType === "workflow")
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    if (candidatePaths) {
      const resolvedNarrowingSet = new Set(candidatePaths.map((p) => resolve(absoluteCwd, p)));
      for (const candidate of workflowCandidates) {
        const pathToAdd = candidate.realPath || candidate.absolutePath;
        const candidateAbs = resolve(absoluteCwd, candidate.absolutePath);
        const candidateReal = resolve(absoluteCwd, candidate.realPath);
        if (resolvedNarrowingSet.has(candidateAbs) || resolvedNarrowingSet.has(candidateReal)) {
          pathsToProcess.add(pathToAdd);
          strictPaths.add(pathToAdd);
        }
      }
    } else {
      for (const candidate of workflowCandidates) {
        const pathToAdd = candidate.realPath || candidate.absolutePath;
        pathsToProcess.add(pathToAdd);
        if (candidate.source !== "legacy-discovery" && candidate.source !== "legacy-dir") {
          strictPaths.add(pathToAdd);
        }
      }
    }
  } else if (candidatePaths) {
    for (const p of candidatePaths) {
      const pathToAdd = resolve(absoluteCwd, p);
      pathsToProcess.add(pathToAdd);
      strictPaths.add(pathToAdd);
    }
  } else if (discovery) {
    const res = await collectResourceCandidateFiles({
      cwd,
      resourceType: "workflow",
      include: discovery.include,
      exclude: discovery.exclude,
      compatibilityMode: discovery.compatibilityMode,
      includeSource: discovery.includeSource,
      excludeSource: discovery.excludeSource,
      strict: false,
    });
    const escapeDiag = res.configDiagnostics.find(d => d.code === "CONFIG_PATH_SYMLINK_ESCAPE");
    if (escapeDiag) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.SECURITY_POLICY_VIOLATION,
        `Workflow file outside project root: ${resolve(absoluteCwd, escapeDiag.value as string)}`
      );
    }
    for (const file of res.files) {
      pathsToProcess.add(file.absolutePath);
    }
  } else if (include) {
    for (const pattern of include) {
      // Basic support for "dir/**/*.ts" or "dir/*.ts"
      let baseDir = getGlobBaseDir(pattern);
      if (baseDir.startsWith("./")) {
        baseDir = baseDir.slice(2);
      }
      const absoluteBaseDir = resolve(absoluteCwd, baseDir);
      
      const globPattern = isAbsolute(pattern) ? relative(absoluteCwd, pattern) : pattern;
      
      for await (const p of walk(absoluteBaseDir)) {
        if (p.endsWith(".ts") || p.endsWith(".js")) {
          const relPath = relative(absoluteCwd, p);
          if (matchGlob(relPath, globPattern)) {
            pathsToProcess.add(p);
          }
        }
      }
    }
  }

  const definitionsByName = new Map<string, WorkflowDefinition>();
  const seenCanonicalPaths = new Set<string>();
  const ambiguousIncludeNames = new Set<string>();

  for (const p of pathsToProcess) {
    const absolutePath = resolve(absoluteCwd, p);
    let canonicalPath: string;
    try {
      canonicalPath = await fs.realpath(absolutePath);
    } catch {
      canonicalPath = absolutePath;
    }
    
    // Safety check: ensure path is within CWD
    const rel = relative(canonicalCwd, canonicalPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.SECURITY_POLICY_VIOLATION,
        `Workflow file outside project root: ${canonicalPath}`
      );
    }

    if (seenCanonicalPaths.has(canonicalPath)) {
      continue;
    }
    seenCanonicalPaths.add(canonicalPath);

    let parsed;
    try {
      const loaded = await loadWorkflow(absolutePath, absoluteCwd);
      parsed = parseWorkflow(loaded);
    } catch (err) {
      // If we are scanning from 'include', we might hit files that are not workflows.
      // We should only throw if it's a strict path.
      if (strictPaths.has(absolutePath)) {
        throw err;
      }
      continue;
    }
    
    // First pass validation (standalone) - only run immediately for the root workflow.
    // Reachable child workflows will be validated during transitive validation in validateRegistryDependencies.
    const isRoot = absolutePath === absoluteRootPath;
    if (isRoot) {
      assertWorkflowValid(parsed, {
        allowImports: false,
        sharedAgentRegistry,
        allowDynamicSharedAgentIds: input.allowDynamicSharedAgentIds,
        toolRegistry: input.toolRegistry,
        maxLoopRounds
      });
    }

    const def: WorkflowDefinition = {
      name: parsed.meta.name,
      description: parsed.meta.description,
      sourcePath: parsed.sourcePath,
      meta: parsed.meta,
      parsedWorkflow: parsed,
      inputSchema: parsed.meta.inputSchema
    };

    if (definitionsByName.has(def.name)) {
      const existing = definitionsByName.get(def.name)!;
      if (absolutePath === absoluteRootPath) {
        // Root wins
        definitionsByName.set(def.name, def);
      } else if (existing.sourcePath === absoluteRootPath) {
        // Root already won
        continue;
      } else {
        // Unrelated duplicates. If we have candidatePaths, discovery service should have narrowed it,
        // so finding a duplicate here is a hard error. If we are scanning include, be lenient.
        if (candidatePaths) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.WORKFLOW_DUPLICATE_DEFINITION,
            `Duplicate workflow name '${def.name}' found in:\n  - ${existing.sourcePath}\n  - ${absolutePath}`
          );
        }
        // Mark as ambiguous by removing it. 
        definitionsByName.delete(def.name);
        ambiguousIncludeNames.add(def.name);
      }
    } else {
      // If we are not the root, and the name is already marked ambiguous, skip it.
      if (ambiguousIncludeNames.has(def.name) && absolutePath !== absoluteRootPath) {
        continue;
      }
      definitionsByName.set(def.name, def);
    }
  }

  const registry = createWorkflowRegistry(Array.from(definitionsByName.values()));

  // Second validation pass (cross-references & dependency graph/cycles)
  validateRegistryDependencies(registry, {
    sharedAgentRegistry,
    allowDynamicSharedAgentIds: input.allowDynamicSharedAgentIds,
    toolRegistry: input.toolRegistry,
    rootWorkflowPath: absoluteRootPath,
    maxLoopRounds
  });

  return registry;
}
