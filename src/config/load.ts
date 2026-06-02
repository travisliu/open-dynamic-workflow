import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { mergeConfig, type ConfigCliOverrides } from "./merge.js";
import { validateConfig } from "./schema.js";
import type { ResolvedExecflowConfig } from "./types.js";
import { resolveUserPath, resolveProjectPath } from "../cli/paths.js";

export interface LoadConfigInput {
  cwd: string;
  configPath?: string;
  outDir?: string;
  cli: ConfigCliOverrides;
}

export function defaultConfigPath(cwd = process.cwd()): string {
  return resolveProjectPath(".execflow/config.yaml", cwd);
}

export async function loadConfig(input: LoadConfigInput): Promise<ResolvedExecflowConfig> {
  const absoluteCwd = resolveProjectPath(input.cwd);
  let resolvedConfigPath: string | undefined;
  let fileConfig: any = {};

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
        throw new ExecflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Invalid YAML in config file: ${resolvedConfigPath}. ${err.message}`,
          { cause: err }
        );
      }
    } catch (err: any) {
      if (err instanceof ExecflowError) {
        throw err;
      }
      throw new ExecflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Unable to read config file: ${resolvedConfigPath}`,
        { cause: err }
      );
    }
  } else {
    // Try to load default config location: .execflow/config.yaml
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
        throw new ExecflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Invalid YAML in config file: ${defPath}. ${err.message}`,
          { cause: err }
        );
      }
    } catch (err) {
      // If default config doesn't exist, ignore and use defaults
    }
  }

  const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, input.cli);
  validateConfig(merged);

  const resolvedOutDir = input.outDir 
    ? resolveUserPath(input.outDir, absoluteCwd) 
    : resolveProjectPath(".execflow/runs", absoluteCwd);

  const result: ResolvedExecflowConfig = {
    ...merged,
    cwd: absoluteCwd,
    outDir: resolvedOutDir
  };
  if (resolvedConfigPath !== undefined) {
    result.configPath = resolvedConfigPath;
  }
  return result;
}
