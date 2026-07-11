import { join, dirname, relative, sep } from "node:path";
import { stat } from "node:fs/promises";
import {
  toDisplayPath,
  DEFAULT_INIT_CONFIG_PATH,
  DEFAULT_INIT_EXAMPLE_FILE,
  DEFAULT_INIT_GLOBALS_PATH,
  DEFAULT_INIT_EXAMPLE_TOOL_FILE
} from "./defaults.js";
import {
  buildGeneratedConfig,
  renderGeneratedConfigYaml,
  renderExampleWorkflow,
  loadGlobalsDeclaration,
  renderExampleTool
} from "./renderer.js";
import type {
  ResolvedInitOptions,
  ProviderSelection,
  InitPlan,
  InitPlannedTarget,
  InitTarget,
  InitWriteAction
} from "./types.js";

export async function buildInitPlan(input: {
  options: ResolvedInitOptions;
  providerSelection: ProviderSelection;
}): Promise<InitPlan> {
  const { options, providerSelection } = input;
  const { cwd } = options;

  const config = buildGeneratedConfig({
    options,
    selectedProvider: providerSelection.defaultProvider
  });
  const configYaml = renderGeneratedConfigYaml(config);
  const workflowContent = renderExampleWorkflow();
  const globalsContent = await loadGlobalsDeclaration();
  const globalsPath = join(cwd, DEFAULT_INIT_GLOBALS_PATH);
  const starterToolPath = join(options.toolsDir, DEFAULT_INIT_EXAMPLE_TOOL_FILE);
  const starterToolContent = renderExampleTool(starterToolPath, globalsPath);

  const targets: InitTarget[] = [
    {
      kind: "file",
      path: join(cwd, DEFAULT_INIT_CONFIG_PATH),
      displayPath: DEFAULT_INIT_CONFIG_PATH,
      content: configYaml,
      overwrite: options.force,
      requiredForStrict: true,
      generatedFileKind: "config"
    },
    {
      kind: "directory",
      path: options.agentsDir,
      displayPath: toDisplayPath(cwd, options.agentsDir),
      overwrite: false,
      requiredForStrict: true,
      generatedFileKind: "agents-dir"
    },
    {
      kind: "directory",
      path: options.toolsDir,
      displayPath: toDisplayPath(cwd, options.toolsDir),
      overwrite: false,
      requiredForStrict: true,
      generatedFileKind: "tools-dir"
    },
    {
      kind: "directory",
      path: options.workflowsDir,
      displayPath: toDisplayPath(cwd, options.workflowsDir),
      overwrite: false,
      requiredForStrict: true,
      generatedFileKind: "workflows-dir"
    },
    {
      kind: "file",
      path: join(options.workflowsDir, DEFAULT_INIT_EXAMPLE_FILE),
      displayPath: join(toDisplayPath(cwd, options.workflowsDir), DEFAULT_INIT_EXAMPLE_FILE).split(/[\\/]/).join("/"),
      content: workflowContent,
      overwrite: options.force,
      requiredForStrict: true,
      generatedFileKind: "workflow-template"
    },
    {
      kind: "file",
      path: globalsPath,
      displayPath: DEFAULT_INIT_GLOBALS_PATH,
      content: globalsContent,
      overwrite: options.force,
      requiredForStrict: true,
      generatedFileKind: "globals"
    },
    {
      kind: "file",
      path: starterToolPath,
      displayPath: join(toDisplayPath(cwd, options.toolsDir), DEFAULT_INIT_EXAMPLE_TOOL_FILE).split(/[\\/]/).join("/"),
      content: starterToolContent,
      overwrite: options.force,
      requiredForStrict: true,
      generatedFileKind: "tool-template"
    }
  ];

  const plannedTargets: InitPlannedTarget[] = await Promise.all(
    targets.map(async (target) => {
      let exists = false;
      let existingKind: "file" | "directory" | "other" | undefined;
      try {
        const stats = await stat(target.path);
        exists = true;
        if (stats.isDirectory()) {
          existingKind = "directory";
        } else if (stats.isFile()) {
          existingKind = "file";
        } else {
          existingKind = "other";
        }
      } catch {
        // Does not exist
      }

      const action = resolveAction(target, exists, options);
      let conflictReason: string | undefined;

      if (target.kind === "directory" && exists && existingKind !== "directory") {
        conflictReason = `Cannot reuse "${target.displayPath}" as a directory because it is a ${existingKind}.`;
      } else if (target.kind === "file" && exists && existingKind !== "file") {
        conflictReason = `Cannot reuse "${target.displayPath}" as a file because it is a ${existingKind}.`;
      }

      return {
        ...target,
        exists,
        existingKind,
        action,
        conflictReason
      };
    })
  );

  // Secondary pass for all parent-path conflicts (including unplanned parents)
  for (const target of plannedTargets) {
    if (target.conflictReason) continue;

    const ancestors = getAncestors(cwd, target.path);
    for (const ancestorPath of ancestors) {
      try {
        const stats = await stat(ancestorPath);
        if (!stats.isDirectory()) {
          const kind = stats.isFile() ? "file" : "other";
          const ancestorDisplay = toDisplayPath(cwd, ancestorPath);
          target.conflictReason = `Cannot create "${target.displayPath}" because parent path "${ancestorDisplay}" is a ${kind}, not a directory.`;
          break;
        }
      } catch {
        // Parent does not exist, which is fine (it will be created)
      }
    }
  }

  const strictConflicts = options.strict
    ? plannedTargets.filter((t) => t.requiredForStrict && t.exists)
    : [];

  const pathConflicts = plannedTargets.filter((t) => !!t.conflictReason);

  const nextSteps = buildNextSteps({
    options,
    providerSelection
  });

  return {
    cwd,
    providerSelection,
    targets: plannedTargets,
    strictConflicts,
    pathConflicts,
    nextSteps
  };
}

function getAncestors(cwd: string, targetPath: string): string[] {
  const ancestors: string[] = [];
  let current = dirname(targetPath);

  while (current !== cwd && current.length < targetPath.length) {
    const rel = relative(cwd, current);
    if (rel === ".." || rel.startsWith(".." + sep)) {
      break;
    }
    ancestors.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return ancestors.reverse(); // Top-down
}

export function resolveAction(
  target: InitTarget,
  exists: boolean,
  options: ResolvedInitOptions
): InitWriteAction {
  if (target.kind === "directory") {
    if (!exists) return "create";
    return "reuse-directory";
  }

  if (!exists) return "create";
  if (options.force) return "overwrite";
  return "skip";
}

export function buildNextSteps(input: {
  options: ResolvedInitOptions;
  providerSelection: ProviderSelection;
}): string[] {
  const { options, providerSelection } = input;
  const workflowPath = toDisplayPath(
    options.cwd,
    join(options.workflowsDir, DEFAULT_INIT_EXAMPLE_FILE)
  );

  const steps = [
    "odw doctor",
    `odw validate ${workflowPath}`,
    `odw run ${workflowPath} --provider mock`
  ];

  if (providerSelection.defaultProvider !== "mock") {
    steps.push(`odw run ${workflowPath} --provider ${providerSelection.defaultProvider}`);
  }

  return steps;
}
