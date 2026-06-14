import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ErrorCode } from "../../errors/codes.js";
import { OpenFlowError } from "../../errors/types.js";
import { defaultRunsDir } from "../../artifacts/run-store.js";
import { parseReportMode } from "../args.js";
import { resolveUserPath } from "../paths.js";
import { runCommand } from "./run.js";

export interface ResumeCommandInput {
  runIdOrPath: string;
  rawOptions: any;
}

export async function resumeCommand(input: ResumeCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();
  const previousRunRoot = resolveRunRoot(input.runIdOrPath, rawOptions.out, cwd);
  const runInputPath = path.join(previousRunRoot, "run-input.json");

  let runInput: any;
  try {
    runInput = JSON.parse(await fs.readFile(runInputPath, "utf8"));
  } catch (err) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Cannot resume '${input.runIdOrPath}' because run-input.json is missing or unreadable. Use 'openflow run <workflow> --resume <run-id>' for older runs.`,
      { cause: err }
    );
  }

  if (runInput.schemaVersion !== "openflow.run-input.v1" || typeof runInput.workflowFile !== "string") {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Cannot resume '${input.runIdOrPath}' because run-input.json is invalid.`
    );
  }

  const storedOptions = runInput.rawOptions && typeof runInput.rawOptions === "object" ? runInput.rawOptions : {};
  
  // Resolve noCache: command line overrides stored options
  let noCache = storedOptions.noCache;
  if (rawOptions.cache === false || rawOptions.noCache === true) {
    noCache = true;
  } else if (rawOptions.cache === true) {
    noCache = false;
  }

  const resumeOptions = {
    ...storedOptions,
    resume: previousRunRoot,
    cwd: runInput.cwd ?? storedOptions.cwd ?? cwd,
    out: rawOptions.out ? resolveUserPath(rawOptions.out, cwd) : storedOptions.out,
    noCache,
    report: rawOptions.report !== undefined ? parseReportMode(rawOptions.report) : storedOptions.report
  };

  await runCommand({
    workflowFile: runInput.workflowFile,
    rawOptions: resumeOptions
  });
}

function resolveRunRoot(runIdOrPath: string, outDir: string | undefined, cwd: string): string {
  if (!runIdOrPath || typeof runIdOrPath !== "string" || runIdOrPath.trim() === "") {
    throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, "resume requires a run id or run directory path.");
  }
  if (path.isAbsolute(runIdOrPath)) {
    return runIdOrPath;
  }
  const root = outDir ? resolveUserPath(outDir, cwd) : defaultRunsDir(cwd);
  return path.resolve(root, runIdOrPath);
}
