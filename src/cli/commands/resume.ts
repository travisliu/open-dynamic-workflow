import * as fs from "node:fs/promises";

import { loadConfig } from "../../config/load.js";
import { ErrorCode } from "../../errors/codes.js";
import { OpenDynamicWorkflowError } from "../../errors/types.js";
import { loadWorkflow } from "../../workflow/load.js";
import { parseWorkflow } from "../../workflow/parse.js";
import {
  parseKeyValueArgs,
  parsePositiveInteger,
  parseReportMode,
  parseRetryCliOptions,
  parseThinkingEffort,
} from "../args.js";
import { legacyRunsRoot, resolvePreviousRun, selectRunProfile } from "../artifact-paths.js";
import { resolveRunProfile } from "../profile-resolution.js";
import { readRunInput, type Invocation, type NormalizedRunInput } from "../run-input.js";
import { runCommand } from "./run.js";

export interface ResumeCommandInput {
  runIdOrPath: string;
  rawOptions: any;
}

function parseCurrentOptions(raw: any) {
  if (raw.arg !== undefined) parseKeyValueArgs(raw.arg);
  if (raw.concurrency !== undefined) parsePositiveInteger(raw.concurrency, "--concurrency");
  if (raw.timeoutMs !== undefined) parsePositiveInteger(raw.timeoutMs, "--timeout-ms");
  if (raw.maxAgentCalls !== undefined) parsePositiveInteger(raw.maxAgentCalls, "--max-agent-calls");
  if (raw.report !== undefined) parseReportMode(raw.report);
  if (raw.thinkingEffort !== undefined) parseThinkingEffort(raw.thinkingEffort);
  return parseRetryCliOptions(raw);
}

function explicitCliOverrides(raw: any, retryCliOptions: ReturnType<typeof parseRetryCliOptions>): any {
  const cli: any = {};
  for (const key of ["provider", "model"] as const) if (raw[key] !== undefined) cli[key] = raw[key];
  for (const [key, option] of [["concurrency", "--concurrency"], ["timeoutMs", "--timeout-ms"], ["maxAgentCalls", "--max-agent-calls"]] as const) {
    if (raw[key] !== undefined) cli[key] = parsePositiveInteger(raw[key], option);
  }
  if (raw.report !== undefined) cli.report = parseReportMode(raw.report);
  if (raw.thinkingEffort !== undefined) cli.thinkingEffort = parseThinkingEffort(raw.thinkingEffort);
  if (raw.verbose !== undefined) cli.verbose = !!raw.verbose;
  if (raw.failFast !== undefined) cli.failFast = typeof raw.failFast === "boolean" ? raw.failFast : !!raw.failFast;
  if (retryCliOptions.retryMaxAttempts !== undefined) cli.retryMaxAttempts = retryCliOptions.retryMaxAttempts;
  if (retryCliOptions.retryDelayMs !== undefined) cli.retryDelayMs = retryCliOptions.retryDelayMs;
  if (retryCliOptions.retryMaxDelayMs !== undefined) cli.retryMaxDelayMs = retryCliOptions.retryMaxDelayMs;
  if (retryCliOptions.retryBackoff !== undefined) cli.retryBackoff = retryCliOptions.retryBackoff;
  if (retryCliOptions.retryDisableDelay !== undefined) cli.retryDisableDelay = retryCliOptions.retryDisableDelay;
  if (retryCliOptions.noRetry !== undefined) cli.noRetry = retryCliOptions.noRetry;
  return cli;
}

async function resolveProfileConfig(baseConfig: any, cwd: string, configPath: string | undefined, raw: any, cli: any) {
  const profile = await resolveRunProfile({
    cwd: baseConfig.cwd,
    configPath: baseConfig.configPath,
    baseConfig,
    rawOptions: raw,
    explicitCliOverrides: cli,
    explicitArgs: parseKeyValueArgs(raw.arg || []),
  });
  if (!profile.selection) return { config: baseConfig, profile };
  const config = await loadConfig({
    cwd,
    ...(configPath !== undefined ? { configPath } : {}),
    ...(raw.out !== undefined ? { outDir: raw.out } : {}),
    cli: { ...profile.profileRunAsCli.config, ...cli },
    diagnosticContext: raw.strict ? "run-strict" : "run",
    ...(profile.selection ? {
      selectedProfileName: profile.selection.selected,
      selectedProfile: profile.selection.resolved,
    } : {}),
  });
  return { config, profile };
}

function invocationOptions(invocation: Invocation): any {
  const options: any = { arg: [...invocation.args] };
  for (const key of Object.keys(invocation) as (keyof Invocation)[]) {
    if (key !== "args" && invocation[key] !== undefined) options[key] = invocation[key];
  }
  return options;
}

function applyCurrentOptions(target: any, raw: any): void {
  for (const key of [
    "provider", "model", "concurrency", "timeoutMs", "maxAgentCalls", "report", "verbose", "failFast",
    "thinkingEffort", "strict", "retryMaxAttempts", "retryDelayMs", "retryMaxDelayMs", "retryBackoff", "retryDisableDelay",
  ]) if (raw[key] !== undefined) target[key] = raw[key];
  if (raw.arg !== undefined) target.arg = [...raw.arg];
  if (raw.cache === false || raw.noCache === true) target.noCache = true;
  else if (raw.cache === true) target.noCache = false;
  if (raw.retry === false || raw.noRetry === true) target.noRetry = true;
  else if (raw.retry !== undefined || raw.noRetry !== undefined) target.noRetry = false;
}

async function validateIdentity(runInput: NormalizedRunInput, fallbackCwd: string): Promise<void> {
  if (!runInput.workflowName) return;
  try {
    const parsed = parseWorkflow(await loadWorkflow(runInput.workflowFile, runInput.cwd || fallbackCwd));
    if (parsed.meta.name !== runInput.workflowName) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.WORKFLOW_RESUME_TARGET_CHANGED,
        `The recorded workflow file exists, but its meta.name changed from "${runInput.workflowName}" to "${parsed.meta.name}".`
      );
    }
  } catch (error) {
    if (error instanceof OpenDynamicWorkflowError) throw error;
    throw new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, `Failed to validate workflow identity during resume: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function resumeCommand(input: ResumeCommandInput): Promise<void> {
  const raw = input.rawOptions || {};
  const retryCliOptions = parseCurrentOptions(raw);
  const lookupCwd = raw.cwd ?? process.cwd();
  const cli = explicitCliOverrides(raw, retryCliOptions);
  const lookupBase = await loadConfig({ cwd: lookupCwd, configPath: raw.config, outDir: raw.out, cli, diagnosticContext: raw.strict ? "run-strict" : "run" });

  // An explicit profile is validated against today's catalog before touching a run directory.
  let lookupConfig = lookupBase;
  let explicitProfileName: string | undefined;
  if (raw.profile !== undefined) {
    // Inline catalog profiles can fail immediately.  An external catalog is
    // validated by resolveRunProfile below, before any run-directory I/O.
    if (raw.profiles === undefined) {
      selectRunProfile({ profiles: lookupBase.profiles || {}, explicitProfile: raw.profile, reuseRecordedProfile: false });
    }
    const resolved = await resolveProfileConfig(lookupBase, lookupCwd, raw.config, raw, cli);
    lookupConfig = resolved.config;
    explicitProfileName = resolved.profile.selection?.selected;
  }

  const previous = await resolvePreviousRun({
    target: input.runIdOrPath,
    cwd: lookupCwd,
    effectiveRunsRoot: lookupConfig.outDir,
    legacyRunsRoot: legacyRunsRoot(lookupCwd),
    fs,
  });
  const runInput = await readRunInput(previous.runDir);

  const continuationCwd = raw.cwd !== undefined || raw.config !== undefined || explicitProfileName !== undefined
    ? lookupCwd
    : runInput.cwd ?? lookupCwd;
  const continuationConfigPath = raw.config !== undefined || explicitProfileName !== undefined
    ? raw.config
    : runInput.configPath;
  let continuationRaw = { ...raw, cwd: continuationCwd, config: continuationConfigPath };
  let continuationBase = lookupConfig;
  if (continuationCwd !== lookupCwd || continuationConfigPath !== raw.config) {
    continuationBase = await loadConfig({
      cwd: continuationCwd,
      ...(continuationConfigPath !== undefined ? { configPath: continuationConfigPath } : {}),
      ...(raw.out !== undefined ? { outDir: raw.out } : {}),
      cli,
      diagnosticContext: raw.strict ? "run-strict" : "run",
    });
  }

  let effectiveProfileName = explicitProfileName;
  if (effectiveProfileName === undefined && runInput.recordedProfileName !== undefined) {
    // Snapshot fields are intentionally not passed through: only its selected name is replayed.
    if (raw.profiles === undefined) {
      selectRunProfile({ profiles: continuationBase.profiles || {}, recordedProfile: runInput.recordedProfileName, reuseRecordedProfile: true });
    }
    continuationRaw = { ...continuationRaw, profile: runInput.recordedProfileName };
    const resolved = await resolveProfileConfig(continuationBase, continuationCwd, continuationConfigPath, continuationRaw, cli);
    continuationBase = resolved.config;
    effectiveProfileName = resolved.profile.selection?.selected;
  }

  await validateIdentity(runInput, continuationCwd);
  const delegated = invocationOptions(runInput.invocation);
  applyCurrentOptions(delegated, raw);
  delegated.resume = previous.runDir;
  delegated.cwd = continuationCwd;
  if (continuationConfigPath !== undefined) delegated.config = continuationConfigPath;
  if (raw.out !== undefined) delegated.out = raw.out;
  if (effectiveProfileName !== undefined) delegated.profile = effectiveProfileName;
  if (runInput.requestedTarget !== undefined) delegated.originalRequestedTarget = runInput.requestedTarget;
  if (runInput.targetKind !== undefined) delegated.originalTargetKind = runInput.targetKind;
  if (runInput.workflowName !== undefined) delegated.originalWorkflowName = runInput.workflowName;
  await runCommand({ workflowFile: runInput.workflowFile, rawOptions: delegated });
}
