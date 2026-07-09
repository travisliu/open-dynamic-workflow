import type { JsonValue } from "../types/common.js";
import { cloneJsonValue } from "./json.js";
import { collectSecretValues, redactJsonValue } from "../security/env.js";
import { CONTEXT_LIMITS } from "./limits.js";
import type { ContextScopeType, ContextScopeMetadata, ContextMergeSummary } from "./types.js";

const secretValues = collectSecretValues(process.env);

export type ContextEventEmitter = (type: string, payload: Record<string, any>) => void;

export function createPreview(
  value: unknown,
  limit: number = CONTEXT_LIMITS.maxEventPreviewBytes
): { valuePreview: any; truncated: boolean } {
  if (value === undefined) {
    return { valuePreview: undefined, truncated: false };
  }
  const cloned = cloneJsonValue(value);
  const redacted = redactJsonValue(cloned, secretValues);
  const str = JSON.stringify(redacted);
  if (str.length > limit) {
    return {
      valuePreview: str.slice(0, limit) + "...",
      truncated: true,
    };
  }
  return {
    valuePreview: redacted,
    truncated: false,
  };
}

export function emitOverlayCreated(
  emit: ContextEventEmitter,
  scopeId: string,
  scopeType: ContextScopeType,
  parentScopeId: string | undefined,
  metadata: ContextScopeMetadata
): void {
  emit("context.overlay.created", {
    scopeId,
    scopeType,
    parentScopeId,
    metadata: redactJsonValue(cloneJsonValue(metadata), secretValues) as Record<string, any>,
  });
}

export function emitPathSet(
  emit: ContextEventEmitter,
  scopeId: string,
  path: string,
  value: unknown
): void {
  const { valuePreview, truncated } = createPreview(value);
  emit("context.path.set", {
    scopeId,
    path,
    valuePreview,
    truncated,
  });
}

export function emitPathMerge(
  emit: ContextEventEmitter,
  scopeId: string,
  path: string,
  value: unknown
): void {
  const { valuePreview, truncated } = createPreview(value);
  emit("context.path.merge", {
    scopeId,
    path,
    valuePreview,
    truncated,
  });
}

export function emitPathAppend(
  emit: ContextEventEmitter,
  scopeId: string,
  path: string,
  value: unknown
): void {
  const { valuePreview, truncated } = createPreview(value);
  emit("context.path.append", {
    scopeId,
    path,
    valuePreview,
    truncated,
  });
}

export function emitPathDelete(
  emit: ContextEventEmitter,
  scopeId: string,
  path: string
): void {
  emit("context.path.delete", {
    scopeId,
    path,
  });
}

export function emitMergeApplied(
  emit: ContextEventEmitter,
  scopeId: string,
  parentScopeId: string | undefined,
  summary: ContextMergeSummary
): void {
  emit("context.merge.applied", {
    scopeId,
    parentScopeId,
    mergedPaths: summary.mergedPaths,
    rejectedPaths: summary.rejectedPaths,
    details: redactJsonValue(cloneJsonValue(summary.details ?? {}), secretValues) as Record<string, any>,
  });
}

export function emitMergeRejected(
  emit: ContextEventEmitter,
  scopeId: string,
  parentScopeId: string | undefined,
  summary: ContextMergeSummary
): void {
  emit("context.merge.rejected", {
    scopeId,
    parentScopeId,
    rejectedPaths: summary.rejectedPaths,
    details: redactJsonValue(cloneJsonValue(summary.details ?? {}), secretValues) as Record<string, any>,
  });
}

export function emitMergeConflict(
  emit: ContextEventEmitter,
  scopeId: string,
  parentScopeId: string | undefined,
  summary: ContextMergeSummary
): void {
  emit("context.merge.conflict", {
    scopeId,
    parentScopeId,
    conflictPaths: summary.conflictPaths,
    details: redactJsonValue(cloneJsonValue(summary.details ?? {}), secretValues) as Record<string, any>,
  });
}
