import type { JsonValue, JsonObject } from "../types/common.js";

export type ContextOperationName =
  | "get"
  | "has"
  | "set"
  | "delete"
  | "merge"
  | "append"
  | "snapshot"
  | "scope";

export interface NormalizedContextPath {
  raw: string;
  normalized: string;
  segments: string[];
}

export interface WorkflowContextSnapshotMetadata {
  scopeId: string;
  visibleScopes: string[];
  sourcePaths: Record<string, string>;
  deletedPaths: string[];
  serializedBytes?: number;
  limitBytes?: number;
}

export interface WorkflowContextSnapshot {
  values: JsonObject;
  metadata: WorkflowContextSnapshotMetadata;
}

export interface WorkflowContext {
  get<T = unknown>(path: string): T | undefined;
  has(path: string): boolean;
  set(path: string, value: JsonValue): void;
  delete(path: string): boolean;
  merge(path: string, value: JsonObject): void;
  append(path: string, value: JsonValue): void;
  snapshot(): JsonObject;
  snapshot(options: { metadata: true }): WorkflowContextSnapshot;
  snapshot(options?: { metadata: boolean }): JsonObject | WorkflowContextSnapshot;
  scope<T>(pathPrefix: string, fn: () => Promise<T> | T): Promise<T>;
}

export type ContextScopeType =
  | "root"
  | "workflow"
  | "loop-round"
  | "pipeline-stage"
  | "parallel-branch"
  | "manual-scope";

export type ContextMergeStrategy = "append" | "merge" | "replace" | "rejectOnConflict";

export type ContextInheritRule = string | { path: string; required?: boolean };

export interface NormalizedContextInheritRule {
  path: string;
  required: boolean;
}

export type ContextScopeMetadata = Record<string, JsonValue | undefined>;

export interface ContextPatchOperation {
  id: string;
  sequence: number;
  path: string;
  op: ContextOperationName;
  valuePreview?: JsonValue | undefined;
  valueArtifactRef?: string | undefined;
  truncated?: boolean | undefined;
}

export interface ContextInheritedPathArtifact {
  path: string;
  required: boolean;
  found: boolean;
  valuePreview?: JsonValue | undefined;
  truncated?: boolean | undefined;
}

export interface ContextMergeSummary {
  mergedPaths: string[];
  rejectedPaths: string[];
  conflictPaths: string[];
  details?: Record<
    string,
    {
      strategy: ContextMergeStrategy;
      status: "merged" | "rejected" | "conflict";
      reason?: string | undefined;
    }
  > | undefined;
}

export interface ContextOverlayPatchArtifact {
  scopeId: string;
  scopeType: ContextScopeType;
  parentScopeId?: string | undefined;
  metadata: ContextScopeMetadata;
  inheritedPaths: ContextInheritedPathArtifact[];
  patchOperations: ContextPatchOperation[];
  mergeSummary?: ContextMergeSummary | undefined;
  merged: boolean;
}

export interface ContextFinalizationSummary {
  rootFinalArtifactPath?: string | undefined;
  summaryArtifactPath?: string | undefined;
  overlayPatchArtifactPaths?: Record<string, string> | undefined;
  totalOverlays: number;
  mergedOverlays: number;
  failedOverlays: number;
  conflictCount: number;
  rejectionCount: number;
}

export interface ContextRuntimeSummary {
  totalOverlays: number;
  mergedOverlays: number;
  conflictCount: number;
  rejectionCount: number;
}

export interface ContextOverlayOptions {
  scopeId: string;
  scopeType: ContextScopeType;
  parentScopeId?: string | undefined;
  metadata?: ContextScopeMetadata | undefined;
  inherit?: ContextInheritRule[] | undefined;
  mergeRules?: Record<string, ContextMergeStrategy> | undefined;
  orderKey?: string | number | undefined;
  mergeMode?: "immediate" | "deferred" | undefined;
}

export interface ContextOverlayResult<T> {
  scopeId: string;
  success: boolean;
  result?: T | undefined;
  error?: any;
  patch: ContextOverlayPatchArtifact;
  mergeSummary?: ContextMergeSummary | undefined;
}

export interface WorkflowContextRuntime {
  runWithRootScope<T>(fn: () => Promise<T> | T): Promise<T>;
  runWithOverlay<T>(
    options: ContextOverlayOptions,
    fn: () => Promise<T> | T
  ): Promise<ContextOverlayResult<T>>;
  mergeOverlayResults(
    results: ContextOverlayResult<unknown>[],
    options?: { groupId?: string }
  ): ContextMergeSummary;
  getActiveScopeId(): string;
  getSummary(): ContextRuntimeSummary;
  getCompletedPatches(): ContextOverlayPatchArtifact[];
  createFacade(): WorkflowContext;
  getRootFrame?(): any;
}


