import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { defaultRunsDir } from "../artifacts/run-store.js";
import { resolveUserPath } from "./paths.js";
import { parseRecordedRunProfile } from "./run-input-profile.js";
import type { RunInputArtifactV1 } from "../types/artifacts.js";

export function resolveRunRoot(runIdOrPath: string, outDir: string | undefined, cwd: string): string {
  if (!runIdOrPath || typeof runIdOrPath !== "string" || runIdOrPath.trim() === "") {
    throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, "resume requires a run id or run directory path.");
  }
  if (path.isAbsolute(runIdOrPath)) {
    return runIdOrPath;
  }
  const root = outDir ? resolveUserPath(outDir, cwd) : defaultRunsDir(cwd);
  return path.resolve(root, runIdOrPath);
}

export interface ReadRunInputResult {
  runInput: RunInputArtifactV1;
  previousRunRoot: string;
}

export async function readRunInput(
  runIdOrPath: string,
  outDir: string | undefined,
  cwd: string
): Promise<ReadRunInputResult> {
  const previousRunRoot = resolveRunRoot(runIdOrPath, outDir, cwd);
  const runInputPath = path.join(previousRunRoot, "run-input.json");

  let runInputRaw: any;
  try {
    const content = await fs.readFile(runInputPath, "utf8");
    runInputRaw = JSON.parse(content);
  } catch (err) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Cannot resume '${runIdOrPath}' because run-input.json is missing or unreadable. Use 'open-dynamic-workflow run <workflow> --resume <run-id>' for older runs.`,
      { cause: err }
    );
  }

  if (
    !runInputRaw ||
    runInputRaw.schemaVersion !== "open-dynamic-workflow.run-input.v1" ||
    typeof runInputRaw.workflowFile !== "string"
  ) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Cannot resume '${runIdOrPath}' because run-input.json is invalid.`
    );
  }

  // Parse the profile if present. Propagate validation error if malformed.
  let profile: any = undefined;
  if ("profile" in runInputRaw) {
    profile = parseRecordedRunProfile(runInputRaw.profile);
  }

  const runInput: RunInputArtifactV1 = {
    ...runInputRaw,
    profile,
  };

  return {
    runInput,
    previousRunRoot,
  };
}
