import type { ArtifactStore } from "../types/artifacts.js";
import type { SerializedError } from "../types/errors.js";
import { sanitizeMetadata } from "../security/metadata.js";

export interface BeginWorkflowInvocationArtifactInput {
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  workflowName: string;
  depth: number;
  args: unknown;
  metadata?: Record<string, unknown> | undefined;
  startedAt: string;
}

export interface WorkflowInvocationSuccessArtifactInput {
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  workflowName: string;
  depth: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: unknown;
  artifactPath?: string | undefined;
}

export interface WorkflowInvocationFailureArtifactInput {
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  workflowName: string;
  depth: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "failed" | "timed_out" | "cancelled";
  error: SerializedError;
  artifactPath?: string | undefined;
}

export interface WorkflowInvocationArtifactWriter {
  begin(input: BeginWorkflowInvocationArtifactInput): Promise<{ artifactPath?: string | undefined }>;
  writeSuccess(input: WorkflowInvocationSuccessArtifactInput): Promise<void>;
  writeFailure(input: WorkflowInvocationFailureArtifactInput): Promise<void>;
}

function safeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._:-]/g, "_");
}

const REDACT_KEYS = ["password", "token", "secret", "key", "apikey"];

function redactValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  
  if (Array.isArray(value)) {
    return value.map(v => redactValue(v));
  }
  
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.some(rk => key.toLowerCase().includes(rk))) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactValue(val);
    }
  }
  return result;
}

function previewValue(value: unknown, maxLength = 2048): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  
  const redacted = redactValue(value);
  const json = JSON.stringify(redacted);
  if (json.length <= maxLength) return redacted;
  
  return {
    _type: "preview",
    _truncated: true,
    _length: json.length,
    data: json.substring(0, maxLength) + "..."
  };
}

export function createWorkflowInvocationArtifactWriter(
  artifactStore: ArtifactStore | undefined
): WorkflowInvocationArtifactWriter {
  return {
    async begin(input: BeginWorkflowInvocationArtifactInput) {
      if (!artifactStore) return { artifactPath: undefined };

      const safeId = safeFileName(input.workflowInvocationId);
      const baseDir = `workflows/${safeId}`;

      const inputPath = `${baseDir}/input.json`;
      const summaryPath = `${baseDir}/summary.json`;

      await artifactStore.writeJson(inputPath, {
        workflowName: input.workflowName,
        workflowInvocationId: input.workflowInvocationId,
        parentWorkflowInvocationId: input.parentWorkflowInvocationId,
        depth: input.depth,
        startedAt: input.startedAt,
        args: previewValue(input.args),
        metadata: sanitizeMetadata(input.metadata),
      });

      // Initial summary
      await artifactStore.writeJson(summaryPath, {
        workflowInvocationId: input.workflowInvocationId,
        parentWorkflowInvocationId: input.parentWorkflowInvocationId,
        workflowName: input.workflowName,
        status: "running",
        depth: input.depth,
        startedAt: input.startedAt,
      });

      return { artifactPath: baseDir };
    },

    async writeSuccess(input: WorkflowInvocationSuccessArtifactInput) {
      if (!artifactStore) return;
      const safeId = safeFileName(input.workflowInvocationId);
      const baseDir = `workflows/${safeId}`;

      const resultPath = `${baseDir}/result.json`;
      const summaryPath = `${baseDir}/summary.json`;

      await artifactStore.writeJson(resultPath, {
        status: "succeeded",
        result: previewValue(input.result),
      });

      await artifactStore.writeJson(summaryPath, {
        workflowInvocationId: input.workflowInvocationId,
        parentWorkflowInvocationId: input.parentWorkflowInvocationId,
        workflowName: input.workflowName,
        status: "succeeded",
        depth: input.depth,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
        artifactPath: input.artifactPath,
      });
    },

    async writeFailure(input: WorkflowInvocationFailureArtifactInput) {
      if (!artifactStore) return;
      const safeId = safeFileName(input.workflowInvocationId);
      const baseDir = `workflows/${safeId}`;

      const errorPath = `${baseDir}/error.json`;
      const summaryPath = `${baseDir}/summary.json`;

      await artifactStore.writeJson(errorPath, input.error);

      await artifactStore.writeJson(summaryPath, {
        workflowInvocationId: input.workflowInvocationId,
        parentWorkflowInvocationId: input.parentWorkflowInvocationId,
        workflowName: input.workflowName,
        status: input.status,
        depth: input.depth,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
        artifactPath: input.artifactPath,
        error: input.error,
      });
    },
  };
}
