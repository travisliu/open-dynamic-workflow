import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { mergeConfig, type ConfigCliOverrides } from "./merge.js";
import { validateConfig } from "./schema.js";
import type { ResolvedOpenDynamicWorkflowConfig, ConfigDiagnosticContext, DiscoveryCliOverrides } from "./types.js";
import { resolveUserPath, resolveProjectPath } from "../cli/paths.js";
import { normalizeDiscoveryConfig } from "./path-discovery.js";
import { getFatalConfigDiagnostics } from "./path-diagnostics.js";

export interface LoadConfigInput {
  cwd: string;
  configPath?: string;
  outDir?: string;
  cli: ConfigCliOverrides;
  diagnosticContext?: ConfigDiagnosticContext;
  discoveryCliOverrides?: DiscoveryCliOverrides;
}

export function defaultConfigPath(cwd = process.cwd()): string {
  return resolveProjectPath(".open-dynamic-workflow/config.yaml", cwd);
}

export async function loadConfig(input: LoadConfigInput): Promise<ResolvedOpenDynamicWorkflowConfig> {
  const absoluteCwd = resolveProjectPath(input.cwd);
  let resolvedConfigPath: string | undefined;
  let fileConfig: any = undefined;

  if (input.configPath) {
    resolvedConfigPath = resolveUserPath(input.configPath, absoluteCwd);
    try {
      const content = await readFile(resolvedConfigPath, "utf8");
      try {
        fileConfig = parse(content);
        if (typeof fileConfig !== "object" || fileConfig === null) {
          fileConfig = {};
        }
      } catch (err: any) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Invalid YAML in config file: ${resolvedConfigPath}. ${err.message}`,
          { cause: err }
        );
      }
    } catch (err: any) {
      if (err instanceof OpenDynamicWorkflowError) {
        throw err;
      }
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Unable to read config file: ${resolvedConfigPath}`,
        { cause: err }
      );
    }
  } else {
    // Try to load default config location: .open-dynamic-workflow/config.yaml
    const defPath = defaultConfigPath(absoluteCwd);
    try {
      const content = await readFile(defPath, "utf8");
      resolvedConfigPath = defPath;
      try {
        fileConfig = parse(content);
        if (typeof fileConfig !== "object" || fileConfig === null) {
          fileConfig = {};
        }
      } catch (err: any) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Invalid YAML in config file: ${defPath}. ${err.message}`,
          { cause: err }
        );
      }
    } catch {
      // If default config doesn't exist, ignore and use defaults
    }
  }

  const merged = mergeConfig(DEFAULT_CONFIG, fileConfig || {}, input.cli);
  validateConfig(merged);

  const context = input.diagnosticContext ?? "list";

  const { discovery, diagnostics } = normalizeDiscoveryConfig({
    config: merged,
    cwd: absoluteCwd,
    ...(input.discoveryCliOverrides ? { cliOverrides: input.discoveryCliOverrides } : {}),
    ...(fileConfig !== undefined ? { rawConfig: fileConfig } : {}),
  });

  const fatalDiagnostics = getFatalConfigDiagnostics(diagnostics, context);
  if (fatalDiagnostics.length > 0) {
    const messages = fatalDiagnostics.map(
      (d) => `- ${d.path} ${d.code}: ${d.message}`
    );
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Invalid path configuration:\n${messages.join("\n")}`
    );
  }

  const resolvedOutDir = input.outDir 
    ? resolveUserPath(input.outDir, absoluteCwd) 
    : resolveProjectPath(".open-dynamic-workflow/runs", absoluteCwd);

  const result: ResolvedOpenDynamicWorkflowConfig = {
    ...merged,
    sharedAgents: {
      ...merged.sharedAgents,
      include: discovery.sharedAgents.include,
      exclude: discovery.sharedAgents.exclude,
      dir: (merged.sharedAgents.dir as string) ?? ".open-dynamic-workflow/agents",
      allowDynamicIds: merged.sharedAgents.allowDynamicIds ?? false,
      maxDefinitions: merged.sharedAgents.maxDefinitions ?? 100,
      strictPromptTemplateVariables: merged.sharedAgents.strictPromptTemplateVariables ?? true,
    },
    tools: {
      include: discovery.tools.include,
      exclude: discovery.tools.exclude,
      dir: (merged.tools?.dir as string) ?? ".open-dynamic-workflow/tools",
      concurrency: merged.tools?.concurrency ?? 4,
      maxDefinitions: merged.tools?.maxDefinitions ?? 100,
    },
    workflow: {
      ...merged.workflow,
      include: discovery.workflow.include,
      exclude: discovery.workflow.exclude,
      discovery: {
        include: ((merged.workflow as any).discovery?.include as string[]) || [],
        exclude: ((merged.workflow as any).discovery?.exclude as string[]) || undefined,
      },
      maxDepth: merged.workflow.maxDepth ?? 8,
      maxLoopRounds: merged.workflow.maxLoopRounds ?? 20,
    },
    cwd: absoluteCwd,
    outDir: resolvedOutDir,
    _normalizedDiscovery: discovery,
    _configDiagnostics: diagnostics,
  };
  if (resolvedConfigPath !== undefined) {
    result.configPath = resolvedConfigPath;
  }
  return result;
}
