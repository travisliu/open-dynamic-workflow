import { ErrorCode } from "../../errors/codes.js";
import { OpenFlowError } from "../../errors/types.js";
import { loadConfig } from "../../config/load.js";
import { discoverWorkflowRegistry } from "../../workflow/discovery.js";
import { loadSharedAgentRegistry } from "../../shared-agents/load.js";
import { loadToolRegistry } from "../../tools/load.js";
import { printValidationSuccess, printValidationIssues } from "../print.js";
import { resolveUserPath } from "../paths.js";

export interface ValidateCommandInput {
  workflowFile: string;
  rawOptions: any;
}

export async function validateCommand(input: ValidateCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();

  const workflowPath = resolveUserPath(input.workflowFile, cwd);

  // Load config (resolves paths, merges defaults, etc.)
  const config = await loadConfig({
    cwd,
    configPath: rawOptions.config,
    cli: {
      verbose: rawOptions.verbose
    }
  });

  // Load shared agent registry
  const sharedAgentRegistry = await loadSharedAgentRegistry({
    cwd: config.cwd,
    dir: config.sharedAgents?.dir,
    maxDefinitions: config.sharedAgents?.maxDefinitions,
    strictPromptTemplateVariables: config.sharedAgents?.strictPromptTemplateVariables
  });

  // Load tool registry
  const toolRegistry = await loadToolRegistry({
    cwd: config.cwd,
    dir: config.tools?.dir,
    maxDefinitions: config.tools?.maxDefinitions ?? 100
  });

  // Discover and validate workflow registry (this performs full validation)
  const workflowRegistry = await discoverWorkflowRegistry({
    rootWorkflowPath: workflowPath,
    cwd: config.cwd,
    include: config.workflow.discovery.include,
    sharedAgentRegistry,
    toolRegistry,
    allowDynamicSharedAgentIds: config.sharedAgents?.allowDynamicIds
  });

  // Find root workflow name for success message
  const rootWorkflowName = (await import("node:path")).basename(workflowPath, (await import("node:path")).extname(workflowPath));
  // Better: find it in registry by path
  const absoluteRootPath = (await import("node:path")).resolve(config.cwd, workflowPath);
  const rootDefinition = workflowRegistry.list().find(d => d.sourcePath === absoluteRootPath);

  printValidationSuccess(rootDefinition?.name || rootWorkflowName);
}
