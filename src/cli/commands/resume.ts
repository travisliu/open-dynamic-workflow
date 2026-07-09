
import { ErrorCode } from "../../errors/codes.js";
import { OpenDynamicWorkflowError } from "../../errors/types.js";
import { parsePositiveInteger, parseReportMode } from "../args.js";
import { resolveUserPath } from "../paths.js";
import { runCommand } from "./run.js";
import { loadWorkflow } from "../../workflow/load.js";
import { parseWorkflow } from "../../workflow/parse.js";
import { readRunInput } from "../run-input.js";

export interface ResumeCommandInput {
  runIdOrPath: string;
  rawOptions: any;
}

export async function resumeCommand(input: ResumeCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();
  
  // Use shared helper to resolve, read, and parse run-input.json and validate its profile
  const { runInput, previousRunRoot } = await readRunInput(input.runIdOrPath, rawOptions.out, cwd);

  // Identity validation
  if (runInput.workflowName) {
    try {
      const loaded = await loadWorkflow(runInput.workflowFile, runInput.cwd || cwd);
      const parsed = parseWorkflow(loaded);
      if (parsed.meta.name !== runInput.workflowName) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.WORKFLOW_RESUME_TARGET_CHANGED,
          `The recorded workflow file exists, but its meta.name changed from "${runInput.workflowName}" to "${parsed.meta.name}".`
        );
      }
    } catch (err) {
      if (err instanceof OpenDynamicWorkflowError && err.code === ErrorCode.WORKFLOW_RESUME_TARGET_CHANGED) {
        throw err;
      }
      // If file is missing or unparseable, let runCommand handle it or re-throw as validation error.
      if (err instanceof OpenDynamicWorkflowError) throw err;
      throw new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, `Failed to validate workflow identity during resume: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const storedOptions = { ...(runInput.rawOptions && typeof runInput.rawOptions === "object" ? runInput.rawOptions : {}) };
  // Explicitly remove/omit old profile and profiles values from storedOptions so old paths cannot trigger a fresh load
  delete storedOptions.profile;
  delete storedOptions.profiles;
  
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
    report: rawOptions.report !== undefined ? parseReportMode(rawOptions.report) : storedOptions.report,
    maxAgentCalls: rawOptions.maxAgentCalls !== undefined ? parsePositiveInteger(rawOptions.maxAgentCalls, "--max-agent-calls") : storedOptions.maxAgentCalls,
    // Preserve target metadata for runCommand to use in artifacts
    originalRequestedTarget: runInput.requestedTarget,
    originalTargetKind: runInput.targetKind,
    originalWorkflowName: runInput.workflowName,
    // Pass verified recorded profile to runCommand through a private field
    recordedProfile: runInput.profile
  };

  await runCommand({
    workflowFile: runInput.workflowFile,
    rawOptions: resumeOptions
  });
}

