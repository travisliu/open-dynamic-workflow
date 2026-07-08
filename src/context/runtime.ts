import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { parseContextPath, joinContextPath } from "./path.js";
import { validateJsonValue, cloneJsonValue } from "./json.js";
import { CONTEXT_LIMITS } from "./limits.js";
import {
  contextGet,
  contextHas,
  contextSet,
  contextDelete,
  contextMerge,
  contextAppend,
} from "./operations.js";
import type {
  NormalizedContextPath,
  WorkflowContext,
  WorkflowContextRuntime,
  WorkflowContextSnapshot,
  ContextOperationName,
} from "./types.js";
import type { JsonObject, JsonValue } from "../types/common.js";

function resolvePath(
  prefixStack: string[],
  path: string,
  operation: ContextOperationName
): NormalizedContextPath {
  if (prefixStack.length === 0) {
    return parseContextPath(path, { operation });
  }
  const rootSegment = prefixStack[0];
  if (path === rootSegment || path.startsWith(rootSegment + ".")) {
    return parseContextPath(path, { operation });
  }
  const prefix = prefixStack.join(".");
  return joinContextPath(prefix, path, { operation });
}

export function createWorkflowContextRuntime(options: { runId: string }): WorkflowContextRuntime {
  const { runId } = options;
  const store: JsonObject = {};
  const prefixStack: string[] = [];

  const facade: WorkflowContext = {
    get<T = unknown>(path: string): T | undefined {
      const { normalized, segments } = resolvePath(prefixStack, path, "get");
      return contextGet(store, segments, "get", normalized) as T;
    },

    has(path: string): boolean {
      const { normalized, segments } = resolvePath(prefixStack, path, "has");
      return contextHas(store, segments, "has", normalized);
    },

    set(path: string, value: JsonValue): void {
      const { normalized, segments } = resolvePath(prefixStack, path, "set");
      const { value: validatedValue } = validateJsonValue(value, {
        operation: "set",
        path: normalized,
        maxBytes: CONTEXT_LIMITS.maxValueBytes,
      });
      contextSet(store, segments, validatedValue, "set", normalized);
    },

    delete(path: string): boolean {
      const { normalized, segments } = resolvePath(prefixStack, path, "delete");
      return contextDelete(store, segments, "delete", normalized);
    },

    merge(path: string, value: JsonObject): void {
      const { normalized, segments } = resolvePath(prefixStack, path, "merge");
      const { value: validatedValue } = validateJsonValue(value, {
        operation: "merge",
        path: normalized,
        maxBytes: CONTEXT_LIMITS.maxValueBytes,
      });
      contextMerge(store, segments, validatedValue as JsonObject, "merge", normalized);
    },

    append(path: string, value: JsonValue): void {
      const { normalized, segments } = resolvePath(prefixStack, path, "append");
      const { value: validatedValue } = validateJsonValue(value, {
        operation: "append",
        path: normalized,
        maxBytes: CONTEXT_LIMITS.maxValueBytes,
      });
      contextAppend(store, segments, validatedValue, "append", normalized);
    },

    snapshot(options?: { metadata: boolean }): any {
      const clonedStore = cloneJsonValue(store) as JsonObject;
      const sizeBytes = Buffer.byteLength(JSON.stringify(clonedStore), "utf8");

      if (sizeBytes > CONTEXT_LIMITS.maxSnapshotBytes) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED,
          `Context operation 'snapshot' failed: snapshot size of ${sizeBytes} bytes exceeds the limit of ${CONTEXT_LIMITS.maxSnapshotBytes} bytes`
        );
      }

      if (options?.metadata) {
        return {
          values: clonedStore,
          metadata: {
            scopeId: runId,
            visibleScopes: [runId],
            sourcePaths: {},
            deletedPaths: [],
            serializedBytes: sizeBytes,
            limitBytes: CONTEXT_LIMITS.maxSnapshotBytes,
          },
        } as WorkflowContextSnapshot;
      }

      return clonedStore;
    },

    async scope<T>(pathPrefix: string, fn: () => Promise<T> | T): Promise<T> {
      const { normalized } = parseContextPath(pathPrefix, { operation: "scope" });
      prefixStack.push(normalized);
      try {
        const result = await fn();
        return result;
      } finally {
        prefixStack.pop();
      }
    },
  };

  return {
    createFacade() {
      return facade;
    },
  };
}
