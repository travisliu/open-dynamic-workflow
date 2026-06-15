import { join, isAbsolute, relative, normalize } from "node:path";
import { ErrorCode } from "../../errors/codes.js";
import { OpenFlowError } from "../../errors/types.js";
import type { SupportedInitProvider, ProviderCandidate } from "./types.js";

export const SUPPORTED_INIT_PROVIDERS: SupportedInitProvider[] = [
  "mock",
  "codex",
  "gemini",
  "copilot",
  "opencode",
  "antigravity",
  "pi"
];

export const RECOMMENDATION_ORDER: SupportedInitProvider[] = [
  "codex",
  "gemini",
  "copilot",
  "opencode",
  "antigravity",
  "pi",
  "mock"
];

export const PROVIDER_CANDIDATES: Omit<ProviderCandidate, "detected">[] = [
  { name: "mock", command: null, builtIn: true, recommendedRank: 6 },
  { name: "codex", command: "codex", builtIn: false, recommendedRank: 0 },
  { name: "gemini", command: "gemini", builtIn: false, recommendedRank: 1 },
  { name: "copilot", command: "copilot", builtIn: false, recommendedRank: 2 },
  { name: "opencode", command: "opencode", builtIn: false, recommendedRank: 3 },
  { name: "antigravity", command: "agy", builtIn: false, recommendedRank: 4 },
  { name: "pi", command: "pi", builtIn: false, recommendedRank: 5 }
];

export const DEFAULT_INIT_WORKFLOWS_DIR = "workflows";
export const DEFAULT_INIT_AGENTS_DIR = ".openflow/agents";
export const DEFAULT_INIT_TOOLS_DIR = ".openflow/tools";
export const DEFAULT_INIT_CONFIG_PATH = ".openflow/config.yaml";
export const DEFAULT_INIT_EXAMPLE_FILE = "example.ts";

export function toDisplayPath(cwd: string, absolutePath: string): string {
  const rel = relative(cwd, absolutePath);
  return rel.split(/[\\/]/).join("/") || ".";
}

export function resolveProjectPath(cwd: string, value: string, optionName: string): string {
  if (!value) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Option "${optionName}" cannot be empty.`
    );
  }

  const absolute = isAbsolute(value) ? normalize(value) : join(cwd, value);
  const rel = relative(cwd, absolute);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Path "${value}" for "${optionName}" must be inside the project directory "${cwd}".`
    );
  }

  return absolute;
}

export function workflowIncludePattern(workflowsDirDisplay: string): string {
  return `${workflowsDirDisplay}/**/*.ts`;
}
