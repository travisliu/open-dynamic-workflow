import type { RunManifest } from "../types/artifacts.js";

export interface CreateManifestInput {
  runId: string;
  workflowPath: string;
  workflowHash: string;
  execflowVersion: string;
  cwd: string;
  configPath?: string | undefined;
  now?: Date;
}

export function createInitialManifest(input: CreateManifestInput): RunManifest {
  const timestamp = (input.now || new Date()).toISOString();
  return {
    schemaVersion: "execflow.manifest.v1",
    runId: input.runId,
    status: "running",
    createdAt: timestamp,
    updatedAt: timestamp,
    workflowPath: input.workflowPath,
    workflowHash: input.workflowHash,
    execflowVersion: input.execflowVersion,
    cwd: input.cwd,
    configPath: input.configPath
  };
}

export function updateManifestStatus(
  manifest: RunManifest,
  status: "succeeded" | "failed" | "cancelled",
  now?: Date
): RunManifest {
  const timestamp = (now || new Date()).toISOString();
  return {
    ...manifest,
    status,
    updatedAt: timestamp
  };
}
