import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { ErrorCode } from "../../errors/codes.js";
import { OpenFlowError } from "../../errors/types.js";
import type { InitPlan, InitWriteResult } from "./types.js";

export async function applyInitPlan(plan: InitPlan): Promise<InitWriteResult> {
  const result = emptyWriteResult();

  for (const target of plan.targets) {
    try {
      switch (target.action) {
        case "create":
          if (target.kind === "directory") {
            await mkdir(target.path, { recursive: true });
            result.created.push(target.displayPath);
          } else {
            await mkdir(dirname(target.path), { recursive: true });
            await writeFile(target.path, target.content ?? "", { flag: "wx" });
            result.created.push(target.displayPath);
          }
          break;

        case "overwrite":
          if (target.kind === "file") {
            await mkdir(dirname(target.path), { recursive: true });
            await writeFile(target.path, target.content ?? "", { flag: "w" });
            result.overwritten.push(target.displayPath);
          }
          break;

        case "skip":
          result.skipped.push(target.displayPath);
          break;

        case "reuse-directory":
          const stats = await stat(target.path);
          if (!stats.isDirectory()) {
            throw new Error(`Path "${target.displayPath}" is not a directory.`);
          }
          result.reusedDirectories.push(target.displayPath);
          break;
      }
    } catch (error: any) {
      if (error.code === "EEXIST" && target.action === "create") {
        throw new OpenFlowError(
          ErrorCode.ARTIFACT_WRITE_FAILED,
          `Failed to create "${target.displayPath}": file already exists (write race).`,
          { cause: error }
        );
      }
      throw new OpenFlowError(
        ErrorCode.ARTIFACT_WRITE_FAILED,
        `Failed to ${target.action} ${target.kind} at "${target.displayPath}": ${error.message}`,
        { cause: error }
      );
    }
  }

  return result;
}

export function emptyWriteResult(): InitWriteResult {
  return {
    created: [],
    skipped: [],
    overwritten: [],
    reusedDirectories: []
  };
}
