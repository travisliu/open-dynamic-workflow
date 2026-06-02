import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";
import type { LoadedWorkflow } from "./types.js";

export async function loadWorkflow(pathInput: string, cwd: string): Promise<LoadedWorkflow> {
  const sourcePath = resolve(cwd, pathInput);

  try {
    const sourceText = await readFile(sourcePath, "utf8");
    return {
      sourcePath,
      sourceText: sourceText.replace(/\r\n/g, "\n")
    };
  } catch (cause) {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      `Unable to read workflow file: ${sourcePath}`,
      { cause }
    );
  }
}
