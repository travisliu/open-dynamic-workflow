import { EXIT_CODES } from "../../types/errors.js";

export interface RunCommandArgs {
  workflowFile: string | undefined;
  dryRun: boolean;
}

export async function runCommand(args: RunCommandArgs): Promise<number> {
  if (!args.workflowFile) {
    console.error("error: missing <workflow-file>");
    return EXIT_CODES.CLI_USAGE_ERROR;
  }

  const mode = args.dryRun ? "dry run" : "run";
  console.error(`[phase0] ${mode} command routed for ${args.workflowFile}`);
  console.error("[phase0] runtime implementation is intentionally not included yet.");
  return EXIT_CODES.SUCCESS;
}
