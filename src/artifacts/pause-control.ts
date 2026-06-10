import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ArtifactStore } from "../types/artifacts.js";
import type { JsonSchema } from "../types/common.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export interface WorkflowPause {
  id: string;
  message: string;
  data?: unknown;
  schema?: JsonSchema;
  createdAt: string;
  artifacts?: {
    pausePath: string;
    resumeInputPath?: string;
  };
}

export interface PauseIndexEntry {
  id: string;
  status: "pending" | "resolved";
  pausePath: string;
  resumeInputPath?: string;
  updatedAt: string;
}

export interface PauseIndex {
  schemaVersion: "openflow.pause-index.v1";
  pauses: Record<string, PauseIndexEntry>;
}

export function assertValidPauseId(id: string): void {
  if (typeof id !== "string" || id.trim() === "") {
    throw new OpenFlowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, "pause() id must be a non-empty string.");
  }
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new OpenFlowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, "pause() id must not contain path separators or '..'.");
  }
}

export async function writePendingPause(input: {
  store: ArtifactStore;
  pause: WorkflowPause;
}): Promise<WorkflowPause> {
  const pausePath = pauseArtifactPath(input.pause.id, "pause.json");
  const pause: WorkflowPause = {
    ...input.pause,
    artifacts: {
      pausePath
    }
  };
  await input.store.writeJson(pausePath, pause);
  await writePauseIndexEntry(input.store, {
    id: input.pause.id,
    status: "pending",
    pausePath,
    updatedAt: new Date().toISOString()
  });
  return pause;
}

export async function writePauseResumeInput(input: {
  store: ArtifactStore;
  pauseId: string;
  value: unknown;
}): Promise<string> {
  const resumeInputPath = pauseArtifactPath(input.pauseId, "resume-input.json");
  await input.store.writeJson(resumeInputPath, {
    pauseId: input.pauseId,
    value: input.value,
    createdAt: new Date().toISOString()
  });
  await writePauseIndexEntry(input.store, {
    id: input.pauseId,
    status: "resolved",
    pausePath: pauseArtifactPath(input.pauseId, "pause.json"),
    resumeInputPath,
    updatedAt: new Date().toISOString()
  });
  return resumeInputPath;
}

export async function readPauseIndex(runRoot: string): Promise<PauseIndex> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(runRoot, "pause-index.json"), "utf8"));
    return {
      schemaVersion: "openflow.pause-index.v1",
      pauses: parsed?.pauses && typeof parsed.pauses === "object" ? parsed.pauses : {}
    };
  } catch {
    return { schemaVersion: "openflow.pause-index.v1", pauses: {} };
  }
}

export async function readPause(runRoot: string, pauseId: string): Promise<WorkflowPause | undefined> {
  const pausePath = path.join(runRoot, pauseArtifactPath(pauseId, "pause.json"));
  try {
    return JSON.parse(await fs.readFile(pausePath, "utf8"));
  } catch {
    return undefined;
  }
}

export async function readPauseResponses(runRoot: string): Promise<Record<string, unknown>> {
  const index = await readPauseIndex(runRoot);
  const responses: Record<string, unknown> = {};
  for (const entry of Object.values(index.pauses)) {
    if (entry.status !== "resolved" || !entry.resumeInputPath) continue;
    const resumePath = resolveInsideRun(runRoot, entry.resumeInputPath);
    try {
      const parsed = JSON.parse(await fs.readFile(resumePath, "utf8"));
      responses[entry.id] = parsed?.value;
    } catch {
      // Ignore damaged resume inputs; the next pending pause will request input again.
    }
  }
  return responses;
}

export async function listPendingPauses(runRoot: string): Promise<WorkflowPause[]> {
  const index = await readPauseIndex(runRoot);
  const pauses: WorkflowPause[] = [];
  for (const entry of Object.values(index.pauses)) {
    if (entry.status !== "pending") continue;
    const pause = await readPause(runRoot, entry.id);
    if (pause) pauses.push(pause);
  }
  return pauses;
}

async function writePauseIndexEntry(store: ArtifactStore, entry: PauseIndexEntry): Promise<void> {
  let existing: PauseIndex = { schemaVersion: "openflow.pause-index.v1", pauses: {} };
  try {
    const artifacts = store.getRunArtifacts();
    existing = await readPauseIndex(artifacts.rootDir);
  } catch {
    // Store may not be fully initialized in unit tests; write a fresh index.
  }
  existing.pauses[entry.id] = entry;
  await store.writeJson("pause-index.json", existing);
}

function pauseArtifactPath(pauseId: string, fileName: "pause.json" | "resume-input.json"): string {
  assertValidPauseId(pauseId);
  return `pauses/${pauseId}/${fileName}`;
}

function resolveInsideRun(runRoot: string, relativePath: string): string {
  const fullPath = path.resolve(runRoot, relativePath);
  const root = path.resolve(runRoot);
  if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
    throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, `Pause artifact path escapes run directory: ${relativePath}`);
  }
  return fullPath;
}
