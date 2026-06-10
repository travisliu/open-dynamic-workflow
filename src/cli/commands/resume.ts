import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defaultRunsDir } from "../../artifacts/run-store.js";
import { resolveRunRoot } from "../../artifacts/run-control.js";
import { listPendingPauses, readPauseResponses, type WorkflowPause } from "../../artifacts/pause-control.js";
import { validateJson } from "../../structured/validate-json.js";
import { ErrorCode } from "../../errors/codes.js";
import { OpenFlowError } from "../../errors/types.js";
import { resolveUserPath } from "../paths.js";
import { parseReportMode } from "../args.js";
import { runCommand } from "./run.js";

export interface ResumeCommandInput {
  runIdOrPath: string;
  inputValue?: string | undefined;
  rawOptions: any;
}

export async function resumeCommand(input: ResumeCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();
  const outDir = rawOptions.out ? resolveUserPath(rawOptions.out, cwd) : defaultRunsDir(cwd);
  const previousRunRoot = resolveRunRoot(outDir, input.runIdOrPath);

  const manifest = await readRequiredJson(path.join(previousRunRoot, "manifest.json"), `Run '${input.runIdOrPath}' has no manifest.json.`);
  const resolvedConfig = await readRequiredJson(path.join(previousRunRoot, "config.resolved.json"), `Run '${input.runIdOrPath}' has no config.resolved.json.`);
  const pendingPauses = await listPendingPauses(previousRunRoot);

  if (pendingPauses.length === 0) {
    throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, `Run '${input.runIdOrPath}' has no pending pause.`);
  }

  const pause = choosePause(pendingPauses, rawOptions.pause);
  const resumeValue = await parseResumeValue({
    pause,
    positional: input.inputValue,
    input: rawOptions.input,
    inputFile: rawOptions.inputFile,
    cwd
  });

  const previousResponses = await readPauseResponses(previousRunRoot);
  const pauseResponses = {
    ...previousResponses,
    [pause.id]: resumeValue
  };

  const runRawOptions: any = {
    cwd: resolvedConfig.cwd || manifest.cwd || cwd,
    out: resolvedConfig.outDir || path.dirname(previousRunRoot),
    config: manifest.configPath,
    resolvedConfig,
    resume: previousRunRoot,
    pauseResponses,
    report: rawOptions.report,
    verbose: rawOptions.verbose,
    failFast: rawOptions.failFast
  };
  if (rawOptions.report !== undefined) {
    runRawOptions.report = parseReportMode(rawOptions.report);
  }

  await runCommand({
    workflowFile: manifest.workflowPath,
    rawOptions: runRawOptions
  });
}

function choosePause(pauses: WorkflowPause[], pauseId?: string | undefined): WorkflowPause {
  if (pauseId) {
    const pause = pauses.find((item) => item.id === pauseId);
    if (!pause) {
      throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, `Pending pause '${pauseId}' was not found.`);
    }
    return pause;
  }
  if (pauses.length > 1) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Run has multiple pending pauses. Specify one with --pause.`
    );
  }
  return pauses[0]!;
}

async function parseResumeValue(input: {
  pause: WorkflowPause;
  positional?: string | undefined;
  input?: string | undefined;
  inputFile?: string | undefined;
  cwd: string;
}): Promise<unknown> {
  const provided = [
    input.positional !== undefined ? "positional" : undefined,
    input.input !== undefined ? "--input" : undefined,
    input.inputFile !== undefined ? "--input-file" : undefined
  ].filter(Boolean);
  if (provided.length !== 1) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      "Resume requires exactly one input source: positional input, --input, or --input-file."
    );
  }

  const raw = input.inputFile !== undefined
    ? await fs.readFile(resolveUserPath(input.inputFile, input.cwd), "utf8")
    : input.input !== undefined
    ? input.input
    : input.positional ?? "";

  if (raw.trim() === "") {
    throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, "Resume input must not be empty.");
  }

  if (!input.pause.schema) {
    return raw;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Resume input for pause '${input.pause.id}' must be valid JSON because the pause has a schema.`,
      { cause: err }
    );
  }

  const validation = validateJson(parsed, input.pause.schema);
  if (!validation.ok) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Resume input for pause '${input.pause.id}' does not match schema: ${validation.message}`,
      { cause: validation.errors }
    );
  }
  return validation.value;
}

async function readRequiredJson(filePath: string, message: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, message, { cause: err });
  }
}
