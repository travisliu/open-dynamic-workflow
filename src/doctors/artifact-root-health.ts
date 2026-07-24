import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";

export interface ArtifactRootHealthResult {
  ok: boolean;
  path: string;
  created: boolean;
  writable: boolean;
  message?: string;
}

export interface CheckArtifactRootHealthInput {
  runsRoot: string;
  createIfMissing: boolean;
}

export interface ArtifactRootHealthDependencies {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  access(path: string, mode: number): Promise<void>;
  open(path: string, flags: "wx", mode: number): Promise<{ close(): Promise<void> }>;
  unlink(path: string): Promise<void>;
  randomUUID(): string;
}

const defaultDependencies: ArtifactRootHealthDependencies = {
  stat: fs.stat,
  mkdir: fs.mkdir,
  access: fs.access,
  open: fs.open,
  unlink: fs.unlink,
  randomUUID,
};

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function failure(
  path: string,
  created: boolean,
  message: string,
): ArtifactRootHealthResult {
  return { ok: false, path, created, writable: false, message };
}

/**
 * Checks whether an already-resolved artifact runs root can accept new files.
 * This intentionally has no config or provider concerns so command callers can
 * decide when root creation is appropriate.
 */
export async function checkArtifactRootHealth(
  input: CheckArtifactRootHealthInput,
  dependencies: ArtifactRootHealthDependencies = defaultDependencies,
): Promise<ArtifactRootHealthResult> {
  const { runsRoot, createIfMissing } = input;
  if (!isAbsolute(runsRoot)) {
    throw new TypeError(`Artifact runs root must be an absolute path: ${runsRoot}`);
  }

  let created = false;
  try {
    const stat = await dependencies.stat(runsRoot);
    if (!stat.isDirectory()) {
      return failure(runsRoot, created, `Artifact runs root ${runsRoot} exists but a directory is required.`);
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      return failure(runsRoot, created, `Unable to stat artifact runs root ${runsRoot}: ${errorText(error)}`);
    }

    if (!createIfMissing) {
      return failure(runsRoot, created, `Artifact runs root ${runsRoot} does not exist.`);
    }

    try {
      await dependencies.mkdir(runsRoot, { recursive: true });
      created = true;
    } catch (mkdirError) {
      return failure(runsRoot, created, `Unable to create artifact runs root ${runsRoot}: ${errorText(mkdirError)}`);
    }
  }

  try {
    await dependencies.access(runsRoot, constants.W_OK);
  } catch (error) {
    return failure(runsRoot, created, `Artifact runs root is not writable ${runsRoot}: ${errorText(error)}`);
  }

  const probePath = join(runsRoot, `.odw-write-probe-${dependencies.randomUUID()}`);
  let handle: { close(): Promise<void> };
  try {
    handle = await dependencies.open(probePath, "wx", 0o600);
  } catch (error) {
    return failure(runsRoot, created, `Unable to create write probe ${probePath}: ${errorText(error)}`);
  }

  let closeError: unknown;
  try {
    await handle.close();
  } catch (error) {
    closeError = error;
  }

  let cleanupError: unknown;
  try {
    await dependencies.unlink(probePath);
  } catch (error) {
    cleanupError = error;
  }

  if (closeError || cleanupError) {
    const reasons = [
      ...(closeError ? [`Unable to close write probe ${probePath}: ${errorText(closeError)}`] : []),
      ...(cleanupError ? [`Unable to remove write probe ${probePath}: ${errorText(cleanupError)}`] : []),
    ];
    return failure(runsRoot, created, reasons.join("; "));
  }

  return { ok: true, path: runsRoot, created, writable: true };
}
