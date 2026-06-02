import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";

export type CommandName = "run" | "validate" | "doctor";
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
  dryRun: boolean;
  failFast: boolean;
  verbose: boolean;
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
      throw new ExecflowError(
        ErrorCode.CLI_USAGE_ERROR,
        `Invalid argument format: '${val}'. Arguments must be in key=value format.`
      );
    }
    const key = val.substring(0, index).trim();
    const value = val.substring(index + 1);
    if (!key) {
      throw new ExecflowError(
        ErrorCode.CLI_USAGE_ERROR,
        `Invalid argument format: '${val}'. Key cannot be empty.`
      );
    }
    result[key] = value;
  }
  return result;
}

export function parsePositiveInteger(value: string, optionName: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0 || String(num) !== value) {
    throw new ExecflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Invalid option value for '${optionName}': '${value}'. Must be a positive integer.`
    );
  }
  return num;
}

export function parseReportMode(value: string): ReportMode {
  if (value !== "pretty" && value !== "json" && value !== "jsonl") {
    throw new ExecflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Invalid report mode: '${value}'. Must be one of: pretty, json, jsonl.`
    );
  }
  return value;
}
