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

export interface ContextRuntimeSummary {
  scopeId: string;
}

export interface ContextFinalizationSummary {
  scopeId: string;
  rootFinalArtifactPath?: string | undefined;
  summaryArtifactPath?: string | undefined;
}

export interface WorkflowContextRuntime {
  runWithRootScope<T>(fn: () => Promise<T> | T): Promise<T>;
  getActiveScopeId(): string;
  getSummary(): ContextRuntimeSummary;
  createFacade(): WorkflowContext;
  getRootSnapshotData(): JsonObject;
}
