import type { SerializedError } from "../types/errors.js";

/**
 * Creates an AbortController whose signal is aborted when the parent signal is aborted.
 */
export function createLinkedAbortController(parent?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      const onAbort = () => {
        controller.abort(parent.reason);
      };
      parent.addEventListener("abort", onAbort);
    }
  }
  return controller;
}

/**
 * Checks if an error is an AbortError.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || error.name === "DOMException" && error.message.includes("abort") || error.message.toLowerCase().includes("abort");
  }
  return false;
}

/**
 * Converts a cancellation reason to a SerializedError.
 */
export function toCancellationError(reason?: string): SerializedError {
  return {
    name: "WorkflowCancelledError",
    message: reason || "Workflow was cancelled",
    code: "USER_CANCELLED"
  };
}
