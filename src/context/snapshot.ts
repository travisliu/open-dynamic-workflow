import type { JsonObject } from "../types/common.js";
import type { ContextScopeFrame } from "./overlay.js";
import type { WorkflowContextSnapshot } from "./types.js";
import { cloneJsonValue } from "./json.js";
import { CONTEXT_LIMITS } from "./limits.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { isAncestorPath } from "./path.js";

export function buildSourcePaths(frame: ContextScopeFrame): Record<string, string> {
  const sourcePaths: Record<string, string> = {};

  function collectPaths(obj: any, currentPath: string) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        const nextPath = currentPath ? `${currentPath}.${k}` : k;
        sourcePaths[nextPath] = frame.scopeId;
        collectPaths(v, nextPath);
      }
    }
  }
  collectPaths(frame.data, "");

  if (frame.parent) {
    const parentSources = buildSourcePaths(frame.parent);
    for (const rule of frame.inheritedPaths) {
      if (rule.found) {
        for (const path of Object.keys(sourcePaths)) {
          if (path === rule.path || isAncestorPath(rule.path, path)) {
            const overwritten = frame.operationLog.some(
              (op) => op.path === path || isAncestorPath(op.path, path)
            );
            if (!overwritten) {
              sourcePaths[path] = parentSources[path] ?? frame.parent.scopeId;
            }
          }
        }
      }
    }
  }

  return sourcePaths;
}

export function materializeSnapshot(
  frame: ContextScopeFrame,
  options?: { metadata: boolean }
): JsonObject | WorkflowContextSnapshot {
  const clonedStore = cloneJsonValue(frame.data) as JsonObject;
  const sizeBytes = Buffer.byteLength(JSON.stringify(clonedStore), "utf8");

  if (sizeBytes > CONTEXT_LIMITS.maxSnapshotBytes) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED,
      `Context operation 'snapshot' failed: snapshot size of ${sizeBytes} bytes exceeds the limit of ${CONTEXT_LIMITS.maxSnapshotBytes} bytes`
    );
  }

  if (options?.metadata) {
    const visibleScopes: string[] = [];
    let curr: ContextScopeFrame | undefined = frame;
    while (curr) {
      visibleScopes.push(curr.scopeId);
      curr = curr.parent;
    }
    visibleScopes.reverse();

    const sourcePaths = buildSourcePaths(frame);
    const deletedPaths = Array.from(frame.tombstones);

    return {
      values: clonedStore,
      metadata: {
        scopeId: frame.scopeId,
        visibleScopes,
        sourcePaths,
        deletedPaths,
        serializedBytes: sizeBytes,
        limitBytes: CONTEXT_LIMITS.maxSnapshotBytes,
      },
    };
  }

  return clonedStore;
}
