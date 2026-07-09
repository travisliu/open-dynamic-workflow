import { AsyncLocalStorage } from "node:async_hooks";
import { parseContextPath, joinContextPath, isAncestorPath } from "./path.js";
import { validateJsonValue, cloneJsonValue } from "./json.js";
import { CONTEXT_LIMITS } from "./limits.js";
import type {
  NormalizedContextPath,
  WorkflowContext,
  WorkflowContextRuntime,
  ContextRuntimeSummary,
  ContextOperationName,
} from "./types.js";
import type { JsonObject, JsonValue } from "../types/common.js";
import { materializeSnapshot } from "./snapshot.js";
import {
  contextGet,
  contextHas,
  contextSet,
  contextDelete,
  contextMerge,
  contextAppend,
} from "./operations.js";
import {
  emitPathSet,
  emitPathMerge,
  emitPathAppend,
  emitPathDelete,
} from "./events.js";

function resolvePath(
  prefixStack: string[],
  path: string,
  operation: ContextOperationName
): NormalizedContextPath {
  if (prefixStack.length === 0) {
    return parseContextPath(path, { operation });
  }
  const rootSegment = prefixStack[0]!;
  if (path === rootSegment || path.startsWith(rootSegment + ".")) {
    return parseContextPath(path, { operation });
  }
  const prefix = prefixStack.join(".");
  return joinContextPath(prefix, path, { operation });
}

export function createWorkflowContextRuntime(options: {
  runId: string;
  emitEvent?: (type: string, payload: Record<string, any>) => void;
  artifactStore?: any;
}): WorkflowContextRuntime {
  const { runId, emitEvent } = options;

  const data: JsonObject = {};
  const tombstones = new Set<string>();
  const prefixStorage = new AsyncLocalStorage<string[]>();

  function getActivePrefixStack(): string[] {
    return prefixStorage.getStore() ?? [];
  }

  function clearMatchingTombstones(normalizedPath: string): void {
    for (const tombstone of tombstones) {
      if (
        tombstone === normalizedPath ||
        isAncestorPath(tombstone, normalizedPath) ||
        isAncestorPath(normalizedPath, tombstone)
      ) {
        tombstones.delete(tombstone);
      }
    }
  }

  function createFacadeInstance(facadeOptions?: { suppressEvents?: boolean }): WorkflowContext {
    const suppress = facadeOptions?.suppressEvents ?? false;
    return {
      get<T = unknown>(path: string): T | undefined {
        const prefixStack = getActivePrefixStack();
        const { normalized, segments } = resolvePath(prefixStack, path, "get");
        return contextGet(data, segments, "get", normalized) as T;
      },

      has(path: string): boolean {
        const prefixStack = getActivePrefixStack();
        const { normalized, segments } = resolvePath(prefixStack, path, "has");
        return contextHas(data, segments, "has", normalized);
      },

      set(path: string, value: JsonValue): void {
        const prefixStack = getActivePrefixStack();
        const { normalized, segments } = resolvePath(prefixStack, path, "set");
        const { value: validatedValue } = validateJsonValue(value, {
          operation: "set",
          path: normalized,
          maxBytes: CONTEXT_LIMITS.maxValueBytes,
        });
        clearMatchingTombstones(normalized);
        contextSet(data, segments, validatedValue, "set", normalized);
        if (emitEvent && !suppress) {
          emitPathSet(emitEvent, runId, normalized, validatedValue);
        }
      },

      delete(path: string): boolean {
        const prefixStack = getActivePrefixStack();
        const { normalized, segments } = resolvePath(prefixStack, path, "delete");
        const deleted = contextDelete(data, segments, "delete", normalized);
        if (deleted) {
          tombstones.add(normalized);
          if (emitEvent && !suppress) {
            emitPathDelete(emitEvent, runId, normalized);
          }
        }
        return deleted;
      },

      merge(path: string, value: JsonObject): void {
        const prefixStack = getActivePrefixStack();
        const { normalized, segments } = resolvePath(prefixStack, path, "merge");
        const { value: validatedValue } = validateJsonValue(value, {
          operation: "merge",
          path: normalized,
          maxBytes: CONTEXT_LIMITS.maxValueBytes,
        });
        clearMatchingTombstones(normalized);
        contextMerge(data, segments, validatedValue as JsonObject, "merge", normalized);
        if (emitEvent && !suppress) {
          emitPathMerge(emitEvent, runId, normalized, validatedValue);
        }
      },

      append(path: string, value: JsonValue): void {
        const prefixStack = getActivePrefixStack();
        const { normalized, segments } = resolvePath(prefixStack, path, "append");
        const { value: validatedValue } = validateJsonValue(value, {
          operation: "append",
          path: normalized,
          maxBytes: CONTEXT_LIMITS.maxValueBytes,
        });
        clearMatchingTombstones(normalized);
        contextAppend(data, segments, validatedValue, "append", normalized);
        if (emitEvent && !suppress) {
          emitPathAppend(emitEvent, runId, normalized, validatedValue);
        }
      },

      snapshot(options?: { metadata: boolean }): any {
        return materializeSnapshot({ scopeId: runId, data, tombstones }, options);
      },

      async scope<T>(pathPrefix: string, fn: () => Promise<T> | T): Promise<T> {
        const prefixStack = getActivePrefixStack();
        const { normalized } = parseContextPath(pathPrefix, { operation: "scope" });
        const nextStack = [...prefixStack, normalized];
        return prefixStorage.run(nextStack, async () => {
          return await fn();
        });
      },
    };
  }

  const defaultFacade = createFacadeInstance();

  return {
    async runWithRootScope<T>(fn: () => Promise<T> | T): Promise<T> {
      return prefixStorage.run([], async () => {
        return await fn();
      });
    },

    getActiveScopeId(): string {
      return runId;
    },

    getSummary(): ContextRuntimeSummary {
      return {
        scopeId: runId,
      };
    },

    createFacade(facadeOptions?: { suppressEvents?: boolean }) {
      if (facadeOptions?.suppressEvents) {
        return createFacadeInstance(facadeOptions);
      }
      return defaultFacade;
    },

    getRootSnapshotData() {
      return cloneJsonValue(data) as JsonObject;
    },
  };
}
