import type { JsonObject, JsonValue } from "../types/common.js";
import type {
  ContextScopeType,
  ContextMergeStrategy,
  ContextScopeMetadata,
  ContextPatchOperation,
  ContextInheritedPathArtifact,
  ContextOverlayOptions,
  ContextOperationName,
} from "./types.js";
import { cloneJsonValue } from "./json.js";
import {
  contextGet,
  contextHas,
  contextSet,
  contextDelete,
  contextMerge,
  contextAppend,
} from "./operations.js";
import { isAncestorPath } from "./path.js";

export interface ContextScopeFrame {
  scopeId: string;
  scopeType: ContextScopeType;
  parent?: ContextScopeFrame;
  parentScopeId?: string;
  metadata: ContextScopeMetadata;
  mergeRules: Record<string, ContextMergeStrategy>;
  inheritedPaths: ContextInheritedPathArtifact[];
  data: JsonObject;
  tombstones: Set<string>;
  operationLog: ContextPatchOperation[];
  pathVersions: Record<string, number>;
  capturedVersions: Record<string, number>;
  orderKey?: string | number | undefined;
  mergeMode: "immediate" | "deferred";
  prefixStack: string[];
}

export function createRootFrame(scopeId: string, initialData?: JsonObject): ContextScopeFrame {
  return {
    scopeId,
    scopeType: "root",
    metadata: {},
    mergeRules: {},
    inheritedPaths: [],
    data: initialData ? (cloneJsonValue(initialData) as JsonObject) : {},
    tombstones: new Set<string>(),
    operationLog: [],
    pathVersions: {},
    capturedVersions: {},
    mergeMode: "immediate",
    prefixStack: [],
  };
}

export function createChildFrame(
  options: ContextOverlayOptions,
  parent: ContextScopeFrame
): ContextScopeFrame {
  const metadata = options.metadata ? (cloneJsonValue(options.metadata) as ContextScopeMetadata) : {};
  const mergeRules = options.mergeRules ? { ...options.mergeRules } : {};
  const mergeMode = options.mergeMode ?? "immediate";
  const orderKey = options.orderKey;

  // Capture parent path versions at startup
  const capturedVersions = { ...parent.pathVersions };

  return {
    scopeId: options.scopeId,
    scopeType: options.scopeType,
    parent,
    parentScopeId: parent.scopeId,
    metadata,
    mergeRules,
    inheritedPaths: [],
    data: {},
    tombstones: new Set<string>(),
    operationLog: [],
    pathVersions: {},
    capturedVersions,
    orderKey,
    mergeMode,
    prefixStack: [],
  };
}


export function isTombstoned(frame: ContextScopeFrame, normalizedPath: string): boolean {
  if (frame.tombstones.has(normalizedPath)) {
    return true;
  }
  for (const tombstone of frame.tombstones) {
    if (isAncestorPath(tombstone, normalizedPath)) {
      return true;
    }
  }
  return false;
}

export function clearMatchingTombstones(frame: ContextScopeFrame, normalizedPath: string): void {
  for (const tombstone of frame.tombstones) {
    if (
      tombstone === normalizedPath ||
      isAncestorPath(tombstone, normalizedPath) ||
      isAncestorPath(normalizedPath, tombstone)
    ) {
      frame.tombstones.delete(tombstone);
    }
  }
}

export function incrementPathVersions(frame: ContextScopeFrame, normalizedPath: string): void {
  const segments = normalizedPath.split(".");
  let current = "";
  for (const seg of segments) {
    current = current ? `${current}.${seg}` : seg;
    frame.pathVersions[current] = (frame.pathVersions[current] ?? 0) + 1;
  }
}

export function frameGet(
  frame: ContextScopeFrame,
  segments: string[],
  normalizedPath: string
): unknown {
  if (isTombstoned(frame, normalizedPath)) {
    return undefined;
  }
  const val = contextGet(frame.data, segments, "get", normalizedPath);
  return val !== undefined ? cloneJsonValue(val) : undefined;
}

export function frameHas(
  frame: ContextScopeFrame,
  segments: string[],
  normalizedPath: string
): boolean {
  if (isTombstoned(frame, normalizedPath)) {
    return false;
  }
  return contextHas(frame.data, segments, "has", normalizedPath);
}

export function frameSet(
  frame: ContextScopeFrame,
  segments: string[],
  value: JsonValue,
  normalizedPath: string
): void {
  clearMatchingTombstones(frame, normalizedPath);
  contextSet(frame.data, segments, value, "set", normalizedPath);
  incrementPathVersions(frame, normalizedPath);
}

export function frameDelete(
  frame: ContextScopeFrame,
  segments: string[],
  normalizedPath: string
): boolean {
  const deleted = contextDelete(frame.data, segments, "delete", normalizedPath);
  frame.tombstones.add(normalizedPath);
  incrementPathVersions(frame, normalizedPath);
  return deleted;
}

export function frameMerge(
  frame: ContextScopeFrame,
  segments: string[],
  value: JsonObject,
  normalizedPath: string
): void {
  clearMatchingTombstones(frame, normalizedPath);
  contextMerge(frame.data, segments, value, "merge", normalizedPath);
  incrementPathVersions(frame, normalizedPath);
}

export function frameAppend(
  frame: ContextScopeFrame,
  segments: string[],
  value: JsonValue,
  normalizedPath: string
): void {
  clearMatchingTombstones(frame, normalizedPath);
  contextAppend(frame.data, segments, value, "append", normalizedPath);
  incrementPathVersions(frame, normalizedPath);
}
