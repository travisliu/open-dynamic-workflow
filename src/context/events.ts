import type { JsonValue } from "../types/common.js";
import { cloneJsonValue } from "./json.js";
import { collectSecretValues, redactJsonValue } from "../security/env.js";
import { CONTEXT_LIMITS } from "./limits.js";

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
