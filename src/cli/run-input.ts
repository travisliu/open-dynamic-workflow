import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { OutDirResolutionSource } from "../config/types.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { RecordedRunProfileInput } from "../types/artifacts.js";
import { parseRecordedRunProfile } from "./run-input-profile.js";

export interface RunInputV2 {
  schemaVersion: "open-dynamic-workflow.run-input.v2";
  runId: string;
  workflowFile: string;
  requestedTarget: string;
  targetKind: "workflow-name" | "workflow-file";
  workflowName: string;
  cwd: string;
  configPath?: string;
  output: {
    effectiveRunsRoot: string;
    source: OutDirResolutionSource;
    selectedProfile?: string;
    explicitCliOut?: string;
  };
  invocation: Invocation;
  profile?: RecordedRunProfileInput;
}

export interface Invocation {
  provider?: string;
  model?: string;
  args: string[];
  report?: "pretty" | "json" | "jsonl";
  concurrency?: string | number;
  timeoutMs?: string | number;
  maxAgentCalls?: string | number;
  noCache?: boolean;
  failFast?: boolean;
  verbose?: boolean;
  thinkingEffort?: string;
  strict?: boolean;
  retryMaxAttempts?: string | number;
  retryDelayMs?: string | number;
  retryMaxDelayMs?: string | number;
  retryBackoff?: "fixed" | "exponential";
  retryDisableDelay?: boolean;
  noRetry?: boolean;
}

export interface NormalizedRunInput {
  runId?: string;
  workflowFile: string;
  requestedTarget?: string;
  targetKind?: "workflow-name" | "workflow-file";
  workflowName?: string;
  cwd?: string;
  configPath?: string;
  invocation: Invocation;
  output?: {
    effectiveRunsRoot?: string;
    source?: OutDirResolutionSource;
    selectedProfile?: string;
    explicitCliOut?: string;
  };
  recordedProfileName?: string;
  recordedProfile?: RecordedRunProfileInput;
}

type RecordValue = Record<string, unknown>;
const SOURCES = ["cli", "profile", "config", "built-in-default"] as const;

function usage(message: string, cause?: unknown): OpenDynamicWorkflowError {
  return new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, message, cause === undefined ? undefined : { cause });
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw usage(`Invalid run-input.json: '${field}' must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw usage(`Invalid run-input.json: '${field}' must be a boolean.`);
  return value;
}

function optionalReplayValue(value: unknown, field: string): string | number | undefined {
  if (value === undefined) return undefined;
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && !Number.isFinite(value))) {
    throw usage(`Invalid run-input.json: '${field}' must be a string or finite number.`);
  }
  return value;
}

function optionalEnum<T extends string>(value: unknown, field: string, values: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw usage(`Invalid run-input.json: '${field}' has an unsupported value.`);
  }
  return value as T;
}

function readArgs(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw usage(`Invalid run-input.json: '${field}' must be an array of strings.`);
  }
  return [...value];
}

function legacyArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return readArgs(value, "rawOptions.arg");
  if (!isRecord(value)) return [];
  const result: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (key.trim() === "" || key.includes("=") || typeof entry !== "string") return [];
    result.push(`${key}=${entry}`);
  }
  return result;
}

function invocationFrom(record: RecordValue, requireBooleans: boolean): Invocation {
  const args = readArgs(record.args, "invocation.args");
  const invocation: Invocation = { args };
  for (const key of ["provider", "model", "thinkingEffort"] as const) {
    const value = optionalString(record[key], `invocation.${key}`);
    if (value !== undefined) invocation[key] = value;
  }
  const report = optionalEnum(record.report, "invocation.report", ["pretty", "json", "jsonl"]);
  if (report !== undefined) invocation.report = report;
  for (const key of ["concurrency", "timeoutMs", "maxAgentCalls", "retryMaxAttempts", "retryDelayMs", "retryMaxDelayMs"] as const) {
    const value = optionalReplayValue(record[key], `invocation.${key}`);
    if (value !== undefined) invocation[key] = value;
  }
  const retryBackoff = optionalEnum(record.retryBackoff, "invocation.retryBackoff", ["fixed", "exponential"]);
  if (retryBackoff !== undefined) invocation.retryBackoff = retryBackoff;
  for (const key of ["noCache", "failFast", "verbose", "strict", "retryDisableDelay", "noRetry"] as const) {
    const value = optionalBoolean(record[key], `invocation.${key}`);
    if (requireBooleans && ["noCache", "failFast", "verbose"].includes(key) && value === undefined) {
      throw usage(`Invalid run-input.json: 'invocation.${key}' must be a boolean.`);
    }
    if (value !== undefined) invocation[key] = value;
  }
  return invocation;
}

function profileFrom(record: RecordValue): { recordedProfile?: RecordedRunProfileInput; recordedProfileName?: string } {
  if (record.profile === undefined) return {};
  const recordedProfile = parseRecordedRunProfile(record.profile);
  return recordedProfile === undefined ? {} : { recordedProfile, recordedProfileName: recordedProfile.selected };
}

function normalizeV1(raw: RecordValue): NormalizedRunInput {
  if (raw.schemaVersion !== "open-dynamic-workflow.run-input.v1") throw usage("Invalid run-input.json schema version.");
  const workflowFile = requiredString(raw.workflowFile, "workflowFile");
  const rawOptions = raw.rawOptions === undefined ? {} : raw.rawOptions;
  if (!isRecord(rawOptions)) throw usage("Invalid run-input.json: 'rawOptions' must be an object.");
  // Older v1 artifacts did not consistently persist an argument collection.
  // Treat its absence as the empty replayable argument set.
  const argsValue = rawOptions.arg !== undefined ? rawOptions.arg : raw.args === undefined ? [] : legacyArgs(raw.args);
  const invocation = invocationFrom({
    args: argsValue,
    provider: rawOptions.provider,
    model: rawOptions.model,
    report: rawOptions.report,
    concurrency: rawOptions.concurrency,
    timeoutMs: rawOptions.timeoutMs,
    maxAgentCalls: rawOptions.maxAgentCalls,
    noCache: rawOptions.noCache,
    failFast: rawOptions.failFast,
    verbose: rawOptions.verbose,
    thinkingEffort: rawOptions.thinkingEffort,
    strict: rawOptions.strict,
    retryMaxAttempts: rawOptions.retryMaxAttempts,
    retryDelayMs: rawOptions.retryDelayMs,
    retryMaxDelayMs: rawOptions.retryMaxDelayMs,
    retryBackoff: rawOptions.retryBackoff,
    retryDisableDelay: rawOptions.retryDisableDelay,
    noRetry: rawOptions.noRetry,
  }, false);
  const profile = profileFrom(raw);
  const effectiveRunsRoot = raw.outDir ?? rawOptions.out;
  const output = effectiveRunsRoot === undefined ? undefined : { effectiveRunsRoot: requiredString(effectiveRunsRoot, "outDir") };
  return {
    ...(raw.runId === undefined ? {} : { runId: requiredString(raw.runId, "runId") }),
    workflowFile,
    ...(raw.requestedTarget === undefined ? {} : { requestedTarget: requiredString(raw.requestedTarget, "requestedTarget") }),
    ...(raw.targetKind === undefined ? {} : { targetKind: optionalEnum(raw.targetKind, "targetKind", ["workflow-name", "workflow-file"])! }),
    ...(raw.workflowName === undefined ? {} : { workflowName: requiredString(raw.workflowName, "workflowName") }),
    ...(raw.cwd === undefined ? {} : { cwd: requiredString(raw.cwd, "cwd") }),
    ...(raw.configPath !== undefined
      ? { configPath: requiredString(raw.configPath, "configPath") }
      : rawOptions.config !== undefined
        ? { configPath: requiredString(rawOptions.config, "rawOptions.config") }
        : {}),
    invocation,
    ...(output === undefined ? {} : { output }),
    ...profile,
  };
}

function normalizeV2(raw: RecordValue): NormalizedRunInput {
  if (raw.schemaVersion !== "open-dynamic-workflow.run-input.v2") throw usage("Invalid run-input.json schema version.");
  if (!isRecord(raw.output)) throw usage("Invalid run-input.json: 'output' must be an object.");
  if (!isRecord(raw.invocation)) throw usage("Invalid run-input.json: 'invocation' must be an object.");
  const output: NormalizedRunInput["output"] = {
    effectiveRunsRoot: requiredString(raw.output.effectiveRunsRoot, "output.effectiveRunsRoot"),
    source: optionalEnum(raw.output.source, "output.source", SOURCES)!,
  };
  const selectedProfile = optionalString(raw.output.selectedProfile, "output.selectedProfile");
  const explicitCliOut = optionalString(raw.output.explicitCliOut, "output.explicitCliOut");
  if (selectedProfile !== undefined) output.selectedProfile = selectedProfile;
  if (explicitCliOut !== undefined) output.explicitCliOut = explicitCliOut;
  const profile = profileFrom(raw);
  if (selectedProfile !== undefined && profile.recordedProfileName !== undefined && selectedProfile !== profile.recordedProfileName) {
    throw usage("Invalid run-input.json: output.selectedProfile disagrees with profile.selected.");
  }
  return {
    runId: requiredString(raw.runId, "runId"),
    workflowFile: requiredString(raw.workflowFile, "workflowFile"),
    requestedTarget: requiredString(raw.requestedTarget, "requestedTarget"),
    targetKind: optionalEnum(raw.targetKind, "targetKind", ["workflow-name", "workflow-file"])!,
    workflowName: requiredString(raw.workflowName, "workflowName"),
    cwd: requiredString(raw.cwd, "cwd"),
    ...(raw.configPath === undefined ? {} : { configPath: requiredString(raw.configPath, "configPath") }),
    invocation: invocationFrom(raw.invocation, true),
    output,
    ...profile,
    ...(selectedProfile === undefined ? {} : { recordedProfileName: selectedProfile }),
  };
}

/** Filesystem-free normalization of the supported persisted run-input formats. */
export function normalizeRunInput(input: unknown): NormalizedRunInput {
  if (!isRecord(input)) throw usage("Invalid run-input.json: expected an object.");
  if (input.schemaVersion === "open-dynamic-workflow.run-input.v1") return normalizeV1(input);
  if (input.schemaVersion === "open-dynamic-workflow.run-input.v2") return normalizeV2(input);
  throw usage("Invalid run-input.json schema version.");
}

/** Reads exactly the input artifact belonging to an already resolved run directory. */
export async function readRunInput(previousRunDir: string): Promise<NormalizedRunInput> {
  if (!path.isAbsolute(previousRunDir)) {
    throw usage("Cannot read run-input.json: previous run directory must be an absolute path.");
  }
  const runInputPath = path.join(previousRunDir, "run-input.json");
  try {
    return normalizeRunInput(JSON.parse(await fs.readFile(runInputPath, "utf8")));
  } catch (error) {
    if (error instanceof OpenDynamicWorkflowError && error.code === ErrorCode.PROFILE_VALIDATION_ERROR) throw error;
    if (typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw usage(`Cannot read run-input.json: missing '${runInputPath}' for run directory '${previousRunDir}'.`, error);
    }
    throw usage(`Cannot read valid run-input.json at '${runInputPath}' for run directory '${previousRunDir}'.`, error);
  }
}
