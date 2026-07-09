import { AsyncLocalStorage } from "node:async_hooks";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { parseContextPath, joinContextPath } from "./path.js";
import { validateJsonValue } from "./json.js";
import { CONTEXT_LIMITS } from "./limits.js";
import { contextMergeConflict } from "./errors.js";
import type {
  NormalizedContextPath,
  WorkflowContext,
  WorkflowContextRuntime,
  ContextOverlayOptions,
  ContextOverlayResult,
  ContextMergeSummary,
  ContextRuntimeSummary,
  ContextOverlayPatchArtifact,
  ContextOperationName,
} from "./types.js";
import type { JsonObject, JsonValue } from "../types/common.js";
import {
  ContextScopeFrame,
  createRootFrame,
  createChildFrame,
  frameGet,
  frameHas,
  frameSet,
  frameDelete,
  frameMerge,
  frameAppend,
} from "./overlay.js";
import { normalizeInheritRules, applyInheritedPaths } from "./inheritance.js";
import { mergeSingleFrame, detectGroupConflicts } from "./merge.js";
import { materializeSnapshot } from "./snapshot.js";
import {
  emitOverlayCreated,
  emitPathSet,
  emitPathMerge,
  emitPathAppend,
  emitPathDelete,
  emitMergeApplied,
  emitMergeRejected,
  emitMergeConflict,
  createPreview,
} from "./events.js";

function resolvePath(
  frame: ContextScopeFrame,
  path: string,
  operation: ContextOperationName
): NormalizedContextPath {
  if (frame.prefixStack.length === 0) {
    return parseContextPath(path, { operation });
  }
  const rootSegment = frame.prefixStack[0]!;
  if (path === rootSegment || path.startsWith(rootSegment + ".")) {
    return parseContextPath(path, { operation });
  }
  const prefix = frame.prefixStack.join(".");
  return joinContextPath(prefix, path, { operation });
}

export function createWorkflowContextRuntime(options: {
  runId: string;
  emitEvent?: (type: string, payload: Record<string, any>) => void;
  artifactStore?: any;
}): WorkflowContextRuntime {
  const { runId, emitEvent } = options;

  const rootFrame = createRootFrame(runId);
  const activeScopeStorage = new AsyncLocalStorage<ContextScopeFrame>();
  const framesMap = new Map<string, ContextScopeFrame>();
  framesMap.set(runId, rootFrame);

  const completedPatches: ContextOverlayPatchArtifact[] = [];

  let totalOverlays = 0;
  let mergedOverlays = 0;
  let conflictCount = 0;
  let rejectionCount = 0;
  let operationSeq = 0;

  function getActiveScope(): ContextScopeFrame {
    return activeScopeStorage.getStore() ?? rootFrame;
  }

  function recordPatchOperation(
    frame: ContextScopeFrame,
    op: ContextOperationName,
    path: string,
    value?: unknown
  ): void {
    operationSeq++;
    const { valuePreview, truncated } = createPreview(value, CONTEXT_LIMITS.maxPatchPreviewBytes);
    const patchOp = {
      id: `op_${operationSeq}`,
      sequence: operationSeq,
      path,
      op,
      valuePreview,
      truncated: truncated ? true : undefined,
    };
    Object.defineProperty(patchOp, "rawValue", {
      value,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    frame.operationLog.push(patchOp);
  }

  const facade: WorkflowContext = {
    get<T = unknown>(path: string): T | undefined {
      const frame = getActiveScope();
      const { normalized, segments } = resolvePath(frame, path, "get");
      return frameGet(frame, segments, normalized) as T;
    },

    has(path: string): boolean {
      const frame = getActiveScope();
      const { normalized, segments } = resolvePath(frame, path, "has");
      return frameHas(frame, segments, normalized);
    },

    set(path: string, value: JsonValue): void {
      const frame = getActiveScope();
      const { normalized, segments } = resolvePath(frame, path, "set");
      const { value: validatedValue } = validateJsonValue(value, {
        operation: "set",
        path: normalized,
        maxBytes: CONTEXT_LIMITS.maxValueBytes,
      });
      frameSet(frame, segments, validatedValue, normalized);
      recordPatchOperation(frame, "set", normalized, validatedValue);
      if (emitEvent) {
        emitPathSet(emitEvent, frame.scopeId, normalized, validatedValue);
      }
    },

    delete(path: string): boolean {
      const frame = getActiveScope();
      const { normalized, segments } = resolvePath(frame, path, "delete");
      const deleted = frameDelete(frame, segments, normalized);
      if (deleted) {
        recordPatchOperation(frame, "delete", normalized);
        if (emitEvent) {
          emitPathDelete(emitEvent, frame.scopeId, normalized);
        }
      }
      return deleted;
    },

    merge(path: string, value: JsonObject): void {
      const frame = getActiveScope();
      const { normalized, segments } = resolvePath(frame, path, "merge");
      const { value: validatedValue } = validateJsonValue(value, {
        operation: "merge",
        path: normalized,
        maxBytes: CONTEXT_LIMITS.maxValueBytes,
      });
      frameMerge(frame, segments, validatedValue as JsonObject, normalized);
      recordPatchOperation(frame, "merge", normalized, validatedValue);
      if (emitEvent) {
        emitPathMerge(emitEvent, frame.scopeId, normalized, validatedValue);
      }
    },

    append(path: string, value: JsonValue): void {
      const frame = getActiveScope();
      const { normalized, segments } = resolvePath(frame, path, "append");
      const { value: validatedValue } = validateJsonValue(value, {
        operation: "append",
        path: normalized,
        maxBytes: CONTEXT_LIMITS.maxValueBytes,
      });
      frameAppend(frame, segments, validatedValue, normalized);
      recordPatchOperation(frame, "append", normalized, validatedValue);
      if (emitEvent) {
        emitPathAppend(emitEvent, frame.scopeId, normalized, validatedValue);
      }
    },

    snapshot(options?: { metadata: boolean }): any {
      const frame = getActiveScope();
      return materializeSnapshot(frame, options);
    },

    async scope<T>(pathPrefix: string, fn: () => Promise<T> | T): Promise<T> {
      const frame = getActiveScope();
      const { normalized } = parseContextPath(pathPrefix, { operation: "scope" });
      frame.prefixStack.push(normalized);
      try {
        return await fn();
      } finally {
        frame.prefixStack.pop();
      }
    },
  };

  return {
    async runWithRootScope<T>(fn: () => Promise<T> | T): Promise<T> {
      return activeScopeStorage.run(rootFrame, async () => {
        return await fn();
      });
    },

    async runWithOverlay<T>(
      options: ContextOverlayOptions,
      fn: () => Promise<T> | T
    ): Promise<ContextOverlayResult<T>> {
      totalOverlays++;
      const parent = activeScopeStorage.getStore() ?? rootFrame;
      const childFrame = createChildFrame(options, parent);
      framesMap.set(options.scopeId, childFrame);

      let startupError: any = null;
      try {
        const normalizedInherit = normalizeInheritRules(options.inherit, `scope ${options.scopeId}`);
        applyInheritedPaths(parent, childFrame, normalizedInherit);
      } catch (err) {
        startupError = err;
      }

      const patch: ContextOverlayPatchArtifact = {
        scopeId: childFrame.scopeId,
        scopeType: childFrame.scopeType,
        parentScopeId: parent.scopeId,
        metadata: childFrame.metadata,
        inheritedPaths: childFrame.inheritedPaths,
        patchOperations: childFrame.operationLog,
        mergeSummary: undefined,
        merged: false,
      };

      if (startupError) {
        const result: ContextOverlayResult<T> = {
          scopeId: options.scopeId,
          success: false,
          error: startupError,
          patch,
        };
        completedPatches.push(patch);
        return result;
      }

      if (emitEvent) {
        emitOverlayCreated(
          emitEvent,
          childFrame.scopeId,
          childFrame.scopeType,
          parent.scopeId,
          childFrame.metadata
        );
      }

      let success = false;
      let fnResult: T | undefined;
      let fnError: any;

      try {
        fnResult = await activeScopeStorage.run(childFrame, async () => {
          return await fn();
        });
        success = true;
      } catch (err) {
        fnError = err;
      }

      let mergeSummary: ContextMergeSummary | undefined;
      if (success) {
        if (childFrame.mergeMode === "immediate") {
          mergeSummary = mergeSingleFrame(parent, childFrame);
          if (mergeSummary.conflictPaths.length > 0) {
            conflictCount += mergeSummary.conflictPaths.length;
            rejectionCount += mergeSummary.rejectedPaths.length;
            patch.mergeSummary = mergeSummary;
            patch.merged = false;
            completedPatches.push(patch);

            const earliestConflict = mergeSummary.conflictPaths.sort()[0]!;
            const mergeConflictError = contextMergeConflict(
              earliestConflict,
              childFrame.scopeId,
              parent.scopeId,
              mergeSummary.details?.[earliestConflict]?.reason ?? "conflict"
            );
            if (emitEvent) {
              emitMergeConflict(emitEvent, childFrame.scopeId, parent.scopeId, mergeSummary);
            }
            throw mergeConflictError;
          } else {
            mergedOverlays++;
            rejectionCount += mergeSummary.rejectedPaths.length;
            patch.mergeSummary = mergeSummary;
            patch.merged = true;
            if (emitEvent) {
              if (mergeSummary.rejectedPaths.length > 0) {
                emitMergeRejected(emitEvent, childFrame.scopeId, parent.scopeId, mergeSummary);
              } else {
                emitMergeApplied(emitEvent, childFrame.scopeId, parent.scopeId, mergeSummary);
              }
            }
          }
        }
      }

      const overlayResult: ContextOverlayResult<T> = {
        scopeId: options.scopeId,
        success,
        result: fnResult,
        error: fnError,
        patch,
        mergeSummary,
      };

      completedPatches.push(patch);
      return overlayResult;
    },

    mergeOverlayResults(
      results: ContextOverlayResult<unknown>[],
      options?: { groupId?: string }
    ): ContextMergeSummary {
      const successfulResults = results.filter((res) => {
        if (!res.success) return false;
        const frame = framesMap.get(res.scopeId);
        return frame && frame.mergeMode === "deferred";
      });

      if (successfulResults.length === 0) {
        return {
          mergedPaths: [],
          rejectedPaths: [],
          conflictPaths: [],
        };
      }

      const orderKeysSeen = new Set<string | number>();
      for (const res of successfulResults) {
        const frame = framesMap.get(res.scopeId);
        if (frame && frame.orderKey !== undefined) {
          if (orderKeysSeen.has(frame.orderKey)) {
            throw new Error(`Duplicate orderKey '${frame.orderKey}' found in deferred merge group`);
          }
          orderKeysSeen.add(frame.orderKey);
        }
      }

      successfulResults.sort((a, b) => {
        const frameA = framesMap.get(a.scopeId);
        const frameB = framesMap.get(b.scopeId);
        const keyA = frameA?.orderKey;
        const keyB = frameB?.orderKey;

        if (keyA === undefined && keyB === undefined) {
          return a.scopeId.localeCompare(b.scopeId);
        }
        if (keyA === undefined) return 1;
        if (keyB === undefined) return -1;

        if (typeof keyA === "number" && typeof keyB === "number") {
          return keyA - keyB;
        }
        return String(keyA).localeCompare(String(keyB));
      });

      const parent = framesMap.get(successfulResults[0]!.scopeId)?.parent;
      if (!parent) {
        throw new Error("Parent scope not found for group merge");
      }

      const successfulFrames = successfulResults
        .map((res) => framesMap.get(res.scopeId)!)
        .filter(Boolean);

      const conflictPaths = detectGroupConflicts(parent, successfulFrames);
      if (conflictPaths.length > 0) {
        conflictCount += conflictPaths.length;
        const earliestConflict = conflictPaths.sort()[0]!;
        const mergeSummary: ContextMergeSummary = {
          mergedPaths: [],
          rejectedPaths: [],
          conflictPaths,
          details: {},
        };
        for (const path of conflictPaths) {
          mergeSummary.details![path] = {
            strategy: "rejectOnConflict",
            status: "conflict",
            reason: "group_merge_conflict",
          };
        }

        for (const res of successfulResults) {
          res.patch.mergeSummary = mergeSummary;
          res.patch.merged = false;
        }

        if (emitEvent) {
          emitMergeConflict(emitEvent, successfulResults[0]!.scopeId, parent.scopeId, mergeSummary);
        }

        throw contextMergeConflict(
          earliestConflict,
          successfulResults[0]!.scopeId,
          parent.scopeId,
          "group_merge_conflict"
        );
      }

      const combinedSummary: ContextMergeSummary = {
        mergedPaths: [],
        rejectedPaths: [],
        conflictPaths: [],
        details: {},
      };

      let conflictFound = false;
      let earliestConflictPath = "";
      let conflictFrameId = "";

      for (let i = 0; i < successfulResults.length; i++) {
        const res = successfulResults[i]!;
        const frame = framesMap.get(res.scopeId)!;

        if (conflictFound) {
          res.patch.mergeSummary = {
            mergedPaths: [],
            rejectedPaths: [],
            conflictPaths: [],
            details: {}
          };
          res.patch.merged = false;
          res.mergeSummary = res.patch.mergeSummary;
          continue;
        }

        const singleSummary = mergeSingleFrame(parent, frame);

        if (singleSummary.conflictPaths.length > 0) {
          conflictFound = true;
          conflictCount += singleSummary.conflictPaths.length;
          earliestConflictPath = singleSummary.conflictPaths.sort()[0]!;
          conflictFrameId = frame.scopeId;

          combinedSummary.conflictPaths.push(...singleSummary.conflictPaths);
          if (singleSummary.details) {
            Object.assign(combinedSummary.details!, singleSummary.details);
          }

          res.patch.mergeSummary = singleSummary;
          res.patch.merged = false;
          res.mergeSummary = singleSummary;

          if (emitEvent) {
            emitMergeConflict(emitEvent, frame.scopeId, parent.scopeId, singleSummary);
          }
          continue;
        }

        mergedOverlays++;
        rejectionCount += singleSummary.rejectedPaths.length;

        res.patch.mergeSummary = singleSummary;
        res.patch.merged = true;
        res.mergeSummary = singleSummary;

        if (emitEvent) {
          if (singleSummary.rejectedPaths.length > 0) {
            emitMergeRejected(emitEvent, frame.scopeId, parent.scopeId, singleSummary);
          } else {
            emitMergeApplied(emitEvent, frame.scopeId, parent.scopeId, singleSummary);
          }
        }

        combinedSummary.mergedPaths.push(...singleSummary.mergedPaths);
        combinedSummary.rejectedPaths.push(...singleSummary.rejectedPaths);
        if (singleSummary.details) {
          Object.assign(combinedSummary.details!, singleSummary.details);
        }
      }

      combinedSummary.mergedPaths = Array.from(new Set(combinedSummary.mergedPaths));
      combinedSummary.rejectedPaths = Array.from(new Set(combinedSummary.rejectedPaths));
      combinedSummary.conflictPaths = Array.from(new Set(combinedSummary.conflictPaths));

      if (conflictFound) {
        throw contextMergeConflict(
          earliestConflictPath,
          conflictFrameId,
          parent.scopeId,
          combinedSummary.details?.[earliestConflictPath]?.reason ?? "group_merge_conflict"
        );
      }

      return combinedSummary;
    },

    getActiveScopeId(): string {
      return getActiveScope().scopeId;
    },

    getSummary(): ContextRuntimeSummary {
      return {
        totalOverlays,
        mergedOverlays,
        conflictCount,
        rejectionCount,
      };
    },

    getCompletedPatches(): ContextOverlayPatchArtifact[] {
      return completedPatches;
    },

    createFacade() {
      return facade;
    },

    getRootFrame() {
      return rootFrame;
    },
  };
}
