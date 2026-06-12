import type { ArtifactStore } from "../types/artifacts.js";
import { safeFileName } from "../artifacts/run-store.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { SerializedError } from "../types/errors.js";

export function getToolRelativeDir(toolCallId: string): string {
  return `tools/${safeFileName(toolCallId)}`;
}

async function writeToolJson(
  artifactStore: ArtifactStore,
  toolCallId: string,
  fileName: string,
  data: unknown
): Promise<string> {
  const relativePath = `${getToolRelativeDir(toolCallId)}/${fileName}`;
  try {
    return await artifactStore.writeJson(relativePath, data);
  } catch (error) {
    throw new OpenFlowError(
      ErrorCode.TOOL_ARTIFACT_WRITE_FAILED,
      `Failed to write tool artifact ${fileName} for ${toolCallId}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export async function writeToolMetadata(
  artifactStore: ArtifactStore,
  toolCallId: string,
  metadata: Record<string, unknown>
): Promise<string> {
  return writeToolJson(artifactStore, toolCallId, "metadata.json", metadata);
}

export async function writeToolInput(
  artifactStore: ArtifactStore,
  toolCallId: string,
  input: unknown
): Promise<string> {
  return writeToolJson(artifactStore, toolCallId, "input.json", input);
}

export async function writeToolOutput(
  artifactStore: ArtifactStore,
  toolCallId: string,
  output: unknown
): Promise<string> {
  return writeToolJson(artifactStore, toolCallId, "output.json", output);
}

export async function writeToolInvalidOutput(
  artifactStore: ArtifactStore,
  toolCallId: string,
  output: unknown,
  errors: any
): Promise<string> {
  return writeToolJson(artifactStore, toolCallId, "invalid-output.json", { output, errors });
}

export async function writeToolError(
  artifactStore: ArtifactStore,
  toolCallId: string,
  error: SerializedError
): Promise<string> {
  return writeToolJson(artifactStore, toolCallId, "error.json", error);
}
