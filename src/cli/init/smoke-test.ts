import { validateWorkflowService } from "../commands/validate.js";
import { runWorkflowService, type RunCommandDeps } from "../commands/run.js";
import { InitReportMode, InitSmokeTestResult } from "./types.js";

export interface RunInitSmokeTestInput {
  cwd: string;
  workflowPath: string;
  report: InitReportMode;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  deps?: {
    validateWorkflowService?: typeof validateWorkflowService;
    runWorkflowService?: typeof runWorkflowService;
  };
}

export async function runInitSmokeTest(
  input: RunInitSmokeTestInput
): Promise<InitSmokeTestResult> {
  const validate = input.deps?.validateWorkflowService || validateWorkflowService;
  const run = input.deps?.runWorkflowService || runWorkflowService;

  const result: InitSmokeTestResult = {
    requested: true,
    reportMode: input.report
  };

  try {
    await validate({
      workflowFile: input.workflowPath,
      rawOptions: { cwd: input.cwd }
    });
    result.validateStatus = "succeeded";
  } catch (error) {
    result.validateStatus = "failed";
    result.error = error;
    // We return the result so the summary can be printed.
    // Coordination: Developer B's initCommand should handle the error after summary.
    return result;
  }

  try {
    const runDeps: Partial<RunCommandDeps> = {};
    if (input.stdout) runDeps.stdout = input.stdout;
    if (input.stderr) runDeps.stderr = input.stderr;

    await run({
      workflowFile: input.workflowPath,
      rawOptions: {
        cwd: input.cwd,
        provider: "mock",
        report: input.report
      },
      deps: runDeps
    });
    result.runStatus = "succeeded";
  } catch (error) {
    result.runStatus = "failed";
    result.error = error;
  }

  return result;
}
