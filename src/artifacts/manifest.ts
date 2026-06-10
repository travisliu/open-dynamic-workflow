import type { RunManifest } from "../types/artifacts.js";

export interface CreateManifestInput {
  runId: string;
  workflowPath: string;
  workflowHash: string;
  openflowVersion: string;
  cwd: string;
  configPath?: string | undefined;
  now?: Date;
}

export function createInitialManifest(input: CreateManifestInput): RunManifest {
  const timestamp = (input.now || new Date()).toISOString();
  return {
    schemaVersion: "openflow.manifest.v1",
    runId: input.runId,
    status: "running",
    createdAt: timestamp,
    updatedAt: timestamp,
    workflowPath: input.workflowPath,
    workflowHash: input.workflowHash,
    openflowVersion: input.openflowVersion,
    cwd: input.cwd,
    configPath: input.configPath
  };
}

export function updateManifestStatus(
  manifest: RunManifest,
  status: "succeeded" | "failed" | "cancelled" | "pending",
  error?: any,
  now?: Date
): RunManifest {
  const timestamp = (now || new Date()).toISOString();
  const res: RunManifest = {
    ...manifest,
    status,
    updatedAt: timestamp
  };
  if (error !== undefined) {
    res.error = error;
  }
  return res;
}
