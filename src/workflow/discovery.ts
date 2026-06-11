import { promises as fs } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import { loadWorkflow } from "./load.js";
import { parseWorkflow } from "./parse.js";
import { assertWorkflowValid, validateRegistryDependencies } from "./validate.js";
import { createWorkflowRegistry, type WorkflowDefinition, type WorkflowRegistry } from "./registry.js";
import type { SharedAgentRegistry } from "../shared-agents/registry.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export interface DiscoverWorkflowRegistryInput {
  rootWorkflowPath: string;
  cwd: string;
  include: string[];
  sharedAgentRegistry?: SharedAgentRegistry;
  candidatePaths?: string[];
  allowDynamicSharedAgentIds?: boolean;
}

async function* walk(dir: string): AsyncGenerator<string> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const res = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walk(res);
      } else {
        yield res;
      }
    }
  } catch (err) {
    // Directory might not exist
  }
}

function matchGlob(path: string, pattern: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  let normalizedPattern = pattern.replace(/\\/g, "/");
  if (normalizedPattern.startsWith("./")) {
    normalizedPattern = normalizedPattern.slice(2);
  }

  if (normalizedPattern === "." || normalizedPattern === "") {
    return true;
  }

  if (!normalizedPattern.includes("*")) {
    return normalizedPath === normalizedPattern || normalizedPath.startsWith(normalizedPattern + "/");
  }

  const pathParts = normalizedPath.split("/");
  const patternParts = normalizedPattern.split("/");

  function matchParts(pathIdx: number, patternIdx: number): boolean {
    if (patternIdx === patternParts.length) {
      return pathIdx === pathParts.length;
    }

    const patternPart = patternParts[patternIdx];
    if (patternPart === undefined) {
      return false;
    }

    if (patternPart === "**") {
      for (let skip = 0; pathIdx + skip <= pathParts.length; skip++) {
        if (matchParts(pathIdx + skip, patternIdx + 1)) {
          return true;
        }
      }
      return false;
    }

    if (pathIdx === pathParts.length) {
      return false;
    }

    const pathPart = pathParts[pathIdx];
    if (pathPart === undefined) {
      return false;
    }
    let regexStr = "^";
    for (let i = 0; i < patternPart.length; i++) {
      const char = patternPart[i];
      if (char === undefined) continue;
      if (char === "*") {
        regexStr += ".*";
      } else if (/[.+^${}()|[\]\\\-]/.test(char)) {
        regexStr += "\\" + char;
      } else {
        regexStr += char;
      }
    }
    regexStr += "$";
    const regex = new RegExp(regexStr);
    if (!regex.test(pathPart)) {
      return false;
    }

    return matchParts(pathIdx + 1, patternIdx + 1);
  }

  return matchParts(0, 0);
}

function getGlobBaseDir(pattern: string): string {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  const baseParts: string[] = [];

  for (const part of parts) {
    if (part.includes("*")) {
      break;
    }
    baseParts.push(part);
  }

  return baseParts.length > 0 ? baseParts.join("/") : ".";
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
      allowShell: false,
      sharedAgentRegistry,
      allowDynamicSharedAgentIds: input.allowDynamicSharedAgentIds
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
    allowDynamicSharedAgentIds: input.allowDynamicSharedAgentIds
  });

  return registry;
}
