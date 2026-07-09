import type { JsonObject } from "../types/common.js";
import type { WorkflowContextSnapshot } from "./types.js";
import { cloneJsonValue } from "./json.js";
import { CONTEXT_LIMITS } from "./limits.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export interface RootStoreSnapshotInput {
  scopeId: string;
  data: JsonObject;
  tombstones: Set<string>;
}

export function buildSourcePaths(scopeId: string, data: JsonObject): Record<string, string> {
  const sourcePaths: Record<string, string> = {};

  function collectPaths(obj: any, currentPath: string) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        const nextPath = currentPath ? `${currentPath}.${k}` : k;
        sourcePaths[nextPath] = scopeId;
        collectPaths(v, nextPath);
      }
    }
  }
  collectPaths(data, "");

  return sourcePaths;
}

export function materializeSnapshot(
  input: RootStoreSnapshotInput,
  options?: { metadata: boolean }
): JsonObject | WorkflowContextSnapshot {
  const clonedStore = cloneJsonValue(input.data) as JsonObject;
  const sizeBytes = Buffer.byteLength(JSON.stringify(clonedStore), "utf8");

  if (sizeBytes > CONTEXT_LIMITS.maxSnapshotBytes) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED,
      `Context operation 'snapshot' failed: snapshot size of ${sizeBytes} bytes exceeds the limit of ${CONTEXT_LIMITS.maxSnapshotBytes} bytes`
    );
  }

  if (options?.metadata) {
    const sourcePaths = buildSourcePaths(input.scopeId, clonedStore);
    const deletedPaths = Array.from(input.tombstones);

    return {
      values: clonedStore,
      metadata: {
        scopeId: input.scopeId,
        visibleScopes: [input.scopeId],
        sourcePaths,
        deletedPaths,
        serializedBytes: sizeBytes,
        limitBytes: CONTEXT_LIMITS.maxSnapshotBytes,
      },
    };
  }

  return clonedStore;
}
