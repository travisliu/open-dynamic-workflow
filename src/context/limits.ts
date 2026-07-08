import { contextSizeLimitExceeded } from "./errors.js";
import type { ContextOperationName } from "./types.js";

export const CONTEXT_LIMITS = {
  maxValueBytes: 256 * 1024, // 256 KB
  maxSnapshotBytes: 1024 * 1024, // 1 MB
  maxEventPreviewBytes: 4 * 1024, // 4 KB
  maxPatchPreviewBytes: 8 * 1024, // 8 KB
} as const;

export function assertWithinContextValueLimit(
  bytes: number,
  operation: ContextOperationName,
  path: string,
  limitBytes: number = CONTEXT_LIMITS.maxValueBytes
): void {
  if (bytes > limitBytes) {
    throw contextSizeLimitExceeded(operation, path, bytes, limitBytes);
  }
}
