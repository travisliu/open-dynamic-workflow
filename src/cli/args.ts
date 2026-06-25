import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { ListCliResourceType } from "../discovery/types.js";
import type { InitCliOptions, InitReportMode } from "./init/types.js";
import type { ThinkingEffort } from "../types/index.js";
import { isThinkingEffort, THINKING_EFFORT_VALUES } from "../types/index.js";


export type CommandName = "run" | "validate" | "doctor" | "list" | "init";
export type ReportMode = "pretty" | "json" | "jsonl";

export interface RunCliOptions {
  workflowFile: string;
  provider?: string;
  model?: string;
  args: Record<string, string>;
  configPath?: string;
  cwd: string;
  outDir?: string;
  report: ReportMode;
  concurrency?: number;
  timeoutMs?: number;
  maxAgentCalls?: number;
  dryRun: boolean;
  failFast: boolean;
  verbose: boolean;
  thinkingEffort?: ThinkingEffort;
}

export interface ValidateCliOptions {
  workflowFile: string;
  configPath?: string;
  cwd: string;
  verbose: boolean;
}

export interface DoctorCliOptions {
  configPath?: string;
  cwd: string;
  verbose: boolean;
}

export function parseKeyValueArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!values) return result;
  for (const val of values) {
    const index = val.indexOf("=");
    if (index === -1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CLI_USAGE_ERROR,
        `Invalid argument format: '${val}'. Arguments must be in key=value format.`
      );
    }
    const key = val.substring(0, index).trim();
    const value = val.substring(index + 1);
    if (!key) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CLI_USAGE_ERROR,
        `Invalid argument format: '${val}'. Key cannot be empty.`
      );
    }
    result[key] = value;
  }
  return result;
}

export function parsePositiveInteger(value: string | number, optionName: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0 || String(num) !== String(value)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Invalid option value for '${optionName}': '${value}'. Must be a positive integer.`
    );
  }
  return num;
}

export function parseReportMode(value: string): ReportMode {
  if (value !== "pretty" && value !== "json" && value !== "jsonl") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Invalid report mode: '${value}'. Must be one of: pretty, json, jsonl.`
    );
  }
  return value;
}

export function parseInitReportMode(value: string): InitReportMode {
  if (value !== "pretty" && value !== "json") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Invalid report mode for init: '${value}'. Must be one of: pretty, json.`
    );
  }
  return value;
}

export function parseListResourceType(value?: string): ListCliResourceType {
  if (value === undefined) return "all";
  if (value === "workflows") return "workflow";
  if (value === "agents") return "agent";
  if (value === "tools") return "tool";
  throw new OpenDynamicWorkflowError(
    ErrorCode.CLI_USAGE_ERROR,
    `Invalid list resource type: '${value}'. Must be one of: workflows, agents, tools.`
  );
}

export function parseThinkingEffort(value: unknown): ThinkingEffort {
  if (!isThinkingEffort(value)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Invalid option value for '--thinking-effort': '${value}'. Must be one of: ${THINKING_EFFORT_VALUES.join(", ")}.`
    );
  }
  return value;
}


export function parseInitOptions(raw: any): InitCliOptions {
  const options: InitCliOptions = {
    cwd: raw.cwd,
    yes: !!raw.yes,
    provider: raw.provider,
    force: !!raw.force,
    strict: !!raw.strict,
    runSmokeTest: !!raw.runSmokeTest,
    workflowsDir: raw.workflowsDir,
    agentsDir: raw.agentsDir,
    toolsDir: raw.toolsDir,
  };

  if (raw.report) {
    options.report = parseInitReportMode(raw.report);
  }

  return options;
}
