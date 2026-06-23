import { ErrorCode } from "../../errors/codes.js";
import { OpenDynamicWorkflowError } from "../../errors/types.js";
import { loadConfig } from "../../config/load.js";
import { discoverWorkflowRegistry } from "../../workflow/discovery.js";
import { resolveWorkflowTarget } from "../../workflow/resolve-target.js";
import { loadSharedAgentRegistry } from "../../shared-agents/load.js";
import { loadToolRegistry } from "../../tools/load.js";
import { printValidationSuccess } from "../print.js";
import * as path from "node:path";
import { detectProjectInitHintContext, attachHintToError } from "../../errors/project-init-hint.js";

export interface ValidateCommandInput {
  workflowFile: string;
  rawOptions: any;
}

export interface ValidateWorkflowServiceInput {
  workflowFile: string;
  rawOptions?: any;
}

export interface ValidateWorkflowServiceResult {
  workflowName: string;
  workflowFileRelative: string;
}

export async function validateWorkflowService(
  input: ValidateWorkflowServiceInput
): Promise<ValidateWorkflowServiceResult> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();

  // Load config (resolves paths, merges defaults, etc.)
  const config = await loadConfig({
    cwd,
    configPath: rawOptions.config,
    cli: {
      verbose: rawOptions.verbose
    }
  });

  // Resolve workflow target
  const resolved = await resolveWorkflowTarget({
    target: input.workflowFile,
    cwd: config.cwd,
    config,
    mode: "validate"
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
    rootWorkflowPath: resolved.workflowFile,
    cwd: config.cwd,
    include: config.workflow.discovery.include,
    candidatePaths: resolved.candidatePaths,
    sharedAgentRegistry,
    toolRegistry,
    allowDynamicSharedAgentIds: config.sharedAgents?.allowDynamicIds,
    maxLoopRounds: config.workflow.maxLoopRounds
  });

  // Find root workflow in registry by path
  const absoluteRootPath = path.resolve(config.cwd, resolved.workflowFile);
  const rootDefinition = workflowRegistry.list().find(d => d.sourcePath === absoluteRootPath);

  if (!rootDefinition) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND,
      `Root workflow definition not found in discovery: ${absoluteRootPath}`
    );
  }

  return {
    workflowName: rootDefinition.name,
    workflowFileRelative: resolved.workflowFileRelative
  };
}

export async function validateCommand(input: ValidateCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();
  const resolvedCwd = path.resolve(cwd);
  const hintContext = detectProjectInitHintContext({
    cwd: resolvedCwd,
    configPath: rawOptions.config,
    invokedBinaryName: rawOptions.__invokedBinaryName,
  });

  try {
    const result = await validateWorkflowService(input);
    printValidationSuccess(result.workflowName, result.workflowFileRelative);
  } catch (error) {
    throw attachHintToError(error, hintContext);
  }
}

