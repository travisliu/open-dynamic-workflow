import { ErrorCode } from "../../errors/codes.js";
import { OpenFlowError } from "../../errors/types.js";
import { loadConfig } from "../../config/load.js";
import { loadWorkflow } from "../../workflow/load.js";
import { parseWorkflow } from "../../workflow/parse.js";
import { validateWorkflow } from "../../workflow/validate.js";
import { loadSharedAgentRegistry } from "../../shared-agents/load.js";
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

  // Load workflow
  const loaded = await loadWorkflow(workflowPath, config.cwd);

  // Parse workflow metadata
  const parsed = parseWorkflow(loaded);

  // Load shared agent registry
  const registry = await loadSharedAgentRegistry({
    cwd: config.cwd,
    dir: config.sharedAgents?.dir,
    maxDefinitions: config.sharedAgents?.maxDefinitions,
    strictPromptTemplateVariables: config.sharedAgents?.strictPromptTemplateVariables
  });

  // Validate restrictions
  const issues = validateWorkflow(parsed, {
    allowImports: false,
    allowShell: false,
    allowDynamicSharedAgentIds: config.sharedAgents?.allowDynamicIds,
    knownSharedAgentIds: new Set(registry.list().map(entry => entry.id)),
    sharedAgentRegistry: registry
  });

  if (issues.length > 0) {
    printValidationIssues(issues);
    const summary = issues.map((issue) => issue.message).join("\n");
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_VALIDATION_ERROR,
      `Workflow validation failed:\n${summary}`
    );
  }

  printValidationSuccess(parsed.meta.name);
}
