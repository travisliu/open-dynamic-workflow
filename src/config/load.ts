import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { mergeConfig, type ConfigCliOverrides } from "./merge.js";
import { validateConfig } from "./schema.js";
import type { ResolvedExecflowConfig } from "./types.js";

export interface LoadConfigInput {
  cwd: string;
  configPath?: string;
  outDir?: string;
  cli: ConfigCliOverrides;
}

export async function loadConfig(input: LoadConfigInput): Promise<ResolvedExecflowConfig> {
  const absoluteCwd = resolve(process.cwd(), input.cwd);
  let resolvedConfigPath: string | undefined;
  let fileConfig: any = {};

  if (input.configPath) {
    resolvedConfigPath = resolve(absoluteCwd, input.configPath);
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
    const defaultConfigPath = resolve(absoluteCwd, ".execflow/config.yaml");
    try {
      const content = await readFile(defaultConfigPath, "utf8");
      resolvedConfigPath = defaultConfigPath;
      try {
        fileConfig = parse(content);
        if (typeof fileConfig !== "object" || fileConfig === null) {
          fileConfig = {};
        }
      } catch (err: any) {
        throw new ExecflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Invalid YAML in config file: ${defaultConfigPath}. ${err.message}`,
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
    ? resolve(absoluteCwd, input.outDir) 
    : resolve(absoluteCwd, ".execflow/runs");

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
