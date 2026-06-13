import { promises as fs } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import { loadWorkflow } from "./load.js";
import { parseWorkflow } from "./parse.js";
import { assertWorkflowValid, validateRegistryDependencies } from "./validate.js";
import { createWorkflowRegistry, type WorkflowDefinition, type WorkflowRegistry } from "./registry.js";
import type { SharedAgentRegistry } from "../shared-agents/registry.js";
import type { ToolRegistry } from "../types/tool.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { walk, matchGlob, getGlobBaseDir } from "../discovery/file-patterns.js";

export { walk, matchGlob, getGlobBaseDir };

export interface DiscoverWorkflowRegistryInput {
  rootWorkflowPath: string;
  cwd: string;
  include: string[];
  sharedAgentRegistry?: SharedAgentRegistry;
  candidatePaths?: string[];
  allowDynamicSharedAgentIds?: boolean;
  toolRegistry?: ToolRegistry;
}

export async function discoverWorkflowRegistry(input: DiscoverWorkflowRegistryInput): Promise<WorkflowRegistry> {
  const { rootWorkflowPath, cwd, include, sharedAgentRegistry, candidatePaths } = input;
  const absoluteCwd = resolve(cwd);
  const absoluteRootPath = resolve(absoluteCwd, rootWorkflowPath);

  const canonicalCwd = await fs.realpath(absoluteCwd).catch(() => absoluteCwd);

  const pathsToProcess = new Set<string>();
  pathsToProcess.add(absoluteRootPath);

  if (candidatePaths) {
    for (const p of candidatePaths) {
      pathsToProcess.add(resolve(absoluteCwd, p));
    }
  } else {
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

  const definitions: WorkflowDefinition[] = [];
  const seenCanonicalPaths = new Set<string>();

  for (const p of pathsToProcess) {
    const absolutePath = resolve(absoluteCwd, p);
    let canonicalPath: string;
    try {
      canonicalPath = await fs.realpath(absolutePath);
    } catch (err) {
      canonicalPath = absolutePath;
    }
    
    // Safety check: ensure path is within CWD
    const rel = relative(canonicalCwd, canonicalPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new OpenFlowError(
        ErrorCode.SECURITY_POLICY_VIOLATION,
        `Workflow file outside project root: ${canonicalPath}`
      );
    }

    if (seenCanonicalPaths.has(canonicalPath)) {
      continue;
    }
    seenCanonicalPaths.add(canonicalPath);

    const loaded = await loadWorkflow(absolutePath, absoluteCwd);
    const parsed = parseWorkflow(loaded);
    
    // First pass validation (standalone)
    assertWorkflowValid(parsed, {
      allowImports: false,
      sharedAgentRegistry,
      allowDynamicSharedAgentIds: input.allowDynamicSharedAgentIds,
      toolRegistry: input.toolRegistry
    });

    definitions.push({
      name: parsed.meta.name,
      description: parsed.meta.description,
      sourcePath: parsed.sourcePath,
      meta: parsed.meta,
      parsedWorkflow: parsed,
      inputSchema: parsed.meta.inputSchema
    });
  }

  const registry = createWorkflowRegistry(definitions);

  // Second validation pass (cross-references & dependency graph/cycles)
  validateRegistryDependencies(registry, {
    sharedAgentRegistry,
    allowDynamicSharedAgentIds: input.allowDynamicSharedAgentIds,
    toolRegistry: input.toolRegistry
  });

  return registry;
}
