import { EXIT_CODES } from "../../types/errors.js";

export interface ValidateCommandArgs {
  workflowFile: string | undefined;
}

export async function validateCommand(args: ValidateCommandArgs): Promise<number> {
  if (!args.workflowFile) {
    console.error("error: missing <workflow-file>");
    return EXIT_CODES.CLI_USAGE_ERROR;
  }

  console.error(`[phase0] validate command routed for ${args.workflowFile}`);
  console.error("[phase0] parser/validator implementation is intentionally not included yet.");
  return EXIT_CODES.SUCCESS;
}
