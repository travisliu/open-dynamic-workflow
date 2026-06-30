import { readFile, readdir, stat, realpath } from "node:fs/promises";
import { resolve, relative, join, extname, isAbsolute } from "node:path";
import * as vm from "node:vm";
import * as ts from "typescript";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { SharedAgentRegistry } from "./registry.js";
import { validateSharedAgentDefinition, validateSharedAgentSource } from "./validate.js";
import { isDefinedSharedAgent } from "./define-agent.js";
import type { PrecollectedResourceLoadInput } from "../discovery/types.js";

export interface LoadSharedAgentRegistryInput {
  cwd: string;
  dir?: string;
  precollected?: PrecollectedResourceLoadInput;
  maxDefinitions?: number;
  strictPromptTemplateVariables?: boolean;
}

const SUPPORTED_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"];

export async function loadSharedAgentRegistry(
  input: LoadSharedAgentRegistryInput
): Promise<SharedAgentRegistry> {
  const registry = new SharedAgentRegistry();
  const realCwd = await realpath(resolve(input.cwd));
  const maxDefinitions = input.maxDefinitions ?? 100;

  const discoveredFiles: string[] = [];

  if (input.precollected) {
    const agentCandidates = input.precollected.candidateFiles
      .filter((c) => c.resourceType === "agent")
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const candidate of agentCandidates) {
      const fullPath = resolve(realCwd, candidate.realPath || candidate.absolutePath);
      try {
        const realTarget = await realpath(fullPath);
        const relativeToCwd = relative(realCwd, realTarget);
        if (relativeToCwd.startsWith("..") || isAbsolute(relativeToCwd)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION,
            `Shared agent symlink '${fullPath}' points outside the workspace.`
          );
        }
        discoveredFiles.push(realTarget);
      } catch (err) {
        if (err instanceof OpenDynamicWorkflowError) throw err;
        discoveredFiles.push(fullPath);
      }
    }
  } else if (input.dir) {
    // Compatibility path: legacy directory scanner
    const absolutePath = resolve(realCwd, input.dir);

    try {
      const entries = await readdir(absolutePath, { withFileTypes: true });
      const sortedNames = entries.map(e => e.name).sort();

      for (const name of sortedNames) {
        const fullPath = join(absolutePath, name);
        const entry = entries.find(e => e.name === name)!;
        
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          const realTarget = await realpath(fullPath);
          const relativeToCwd = relative(realCwd, realTarget);
          const relativeToDir = relative(absolutePath, realTarget);
          if (relativeToCwd.startsWith("..") && relativeToDir.startsWith("..")) {
            throw new OpenDynamicWorkflowError(
              ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION,
              `Shared agent symlink '${fullPath}' points outside the workspace.`
            );
          }
          const targetStat = await stat(realTarget);
          isFile = targetStat.isFile();
        }

        if (isFile && SUPPORTED_EXTENSIONS.includes(extname(name))) {
          discoveredFiles.push(fullPath);
        }
      }
    } catch (err) {
      if (err instanceof OpenDynamicWorkflowError) throw err;
      // Ignore missing files/dirs if they were part of the default paths
    }
  }

  if (discoveredFiles.length > maxDefinitions) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
      `Discovered ${discoveredFiles.length} shared agent definitions, which exceeds the limit of ${maxDefinitions}.`
    );
  }

  for (const filePath of discoveredFiles) {
    const ext = extname(filePath);
    const sourceText = await readFile(filePath, "utf8");
    let definition: any;

    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      validateSharedAgentSource(sourceText, filePath);
      
      let codeToRun = sourceText;
      if (ext === ".ts" || ext === ".js" || ext === ".mjs") {
        codeToRun = transpileTs(sourceText, filePath);
      }

      definition = evaluateJsDefinition(codeToRun, filePath);
    } else {
        continue;
    }

    const validatedDefinition = validateSharedAgentDefinition(definition, filePath, {
      strictPromptTemplateVariables: input.strictPromptTemplateVariables ?? true,
    });

    registry.register({
      id: validatedDefinition.id,
      sourcePath: filePath,
      definition: validatedDefinition,
      validatedAt: new Date().toISOString(),
    });
  }

  return registry;
}

function evaluateJsDefinition(sourceText: string, filePath: string): any {
    const moduleExports = {};
    const sandbox = {
        defineAgent: (def: any) => {
            const SHARED_AGENT_MARKER = Symbol.for("open-dynamic-workflow.sharedAgentDefinition");
            Object.defineProperty(def, SHARED_AGENT_MARKER, {
                value: true,
                enumerable: false,
                configurable: false
            });
            return def;
        },
        console: {
            log: () => {},
            error: () => {},
            warn: () => {},
        },
        exports: moduleExports,
        module: { exports: moduleExports },
        require: (mod: string) => {
            if (mod.includes("define-agent") || mod.includes("open-dynamic-workflow")) {
                return {
                    defineAgent: sandbox.defineAgent,
                    default: sandbox.defineAgent
                };
            }
            throw new Error(`Cannot require module ${mod}`);
        }
    };
    
    let codeToRun = sourceText;
    if (codeToRun.includes("export default")) {
        codeToRun = codeToRun.replace("export default", "sandboxDefault = ");
    }
    
    const context = vm.createContext(sandbox);
    try {
        const script = new vm.Script(codeToRun, { filename: filePath });
        script.runInContext(context, { timeout: 250 });
    } catch (err: any) {
        throw new OpenDynamicWorkflowError(
            ErrorCode.SHARED_AGENT_RUNTIME_FAILED,
            `Failed to evaluate shared agent ${filePath}: ${err.message}`
        );
    }
    
    const result = (sandbox as any).sandboxDefault || (sandbox.module.exports as any).default;
    
    if (!isDefinedSharedAgent(result)) {
        throw new OpenDynamicWorkflowError(
            ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
            `Shared agent file ${filePath} does not export a valid definition using defineAgent() as the default export.`
        );
    }
    
    return result;
}

function transpileTs(sourceText: string, filePath: string): string {
  try {
    const transpile = (ts as any).default?.transpileModule ?? ts.transpileModule;
    const result = transpile(sourceText, {
      compilerOptions: {
        target: (ts as any).ScriptTarget?.ES2022 ?? 9,
        module: (ts as any).ModuleKind?.CommonJS ?? 1,
      }
    });
    return result.outputText;
  } catch (err: any) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.SHARED_AGENT_RUNTIME_FAILED,
      `TypeScript transpilation failed for ${filePath}: ${err.message}`
    );
  }
}
