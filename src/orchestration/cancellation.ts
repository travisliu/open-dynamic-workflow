import type { SerializedError } from "../types/errors.js";

/**
 * Creates an AbortController whose signal is aborted when any of the parent signals are aborted.
 */
export function createLinkedAbortController(...parents: Array<AbortSignal | undefined>): AbortController {
  const controller = new AbortController();
  
  for (const parent of parents) {
    if (!parent) continue;
    
    if (parent.aborted) {
      controller.abort(parent.reason);
      break;
    } else {
      const onAbort = () => {
        controller.abort(parent.reason);
      };
      parent.addEventListener("abort", onAbort, { once: true });
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
