import { resolveUserPath } from "../cli/paths.js";
import type { ResolvedOpenDynamicWorkflowConfig } from "../config/types.js";
import type { DiscoveryDirectories, ListCliResourceType } from "./types.js";

export function resolveDiscoveryDirectories(input: {
  resourceType: ListCliResourceType;
  rawOptions: any;
  config: ResolvedOpenDynamicWorkflowConfig;
  cwd: string;
}): DiscoveryDirectories {
  const workflowsDirOverride = input.resourceType === "workflow"
    ? input.rawOptions.dir ?? input.rawOptions.workflowsDir
    : input.rawOptions.workflowsDir;

  let workflowInclude: string[];
  if (workflowsDirOverride) {
    const resolvedDir = resolveUserPath(workflowsDirOverride, input.cwd);
    const normalizedDir = resolvedDir.replace(/\\/g, "/");
    workflowInclude = [
      `${normalizedDir}/**/*.ts`,
      `${normalizedDir}/**/*.js`,
      `${normalizedDir}/**/*.mjs`,
      `${normalizedDir}/**/*.cjs`,
    ];
  } else {
    workflowInclude = input.config.workflow.discovery?.include ?? input.config.workflow.include;
  }

  const agentsDir = input.resourceType === "agent"
    ? input.rawOptions.dir ?? input.rawOptions.agentsDir ?? input.config.sharedAgents.dir ?? ".open-dynamic-workflow/agents"
    : input.rawOptions.agentsDir ?? input.config.sharedAgents.dir ?? ".open-dynamic-workflow/agents";

  const toolsDir = input.resourceType === "tool"
    ? input.rawOptions.dir ?? input.rawOptions.toolsDir ?? input.config.tools.dir ?? ".open-dynamic-workflow/tools"
    : input.rawOptions.toolsDir ?? input.config.tools.dir ?? ".open-dynamic-workflow/tools";

  return {
    workflowInclude,
    agentsDir: resolveUserPath(agentsDir, input.cwd),
    toolsDir: resolveUserPath(toolsDir, input.cwd)
  };
}
