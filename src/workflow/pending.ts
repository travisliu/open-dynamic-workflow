import type { WorkflowPause } from "../artifacts/pause-control.js";

export class WorkflowPendingError extends Error {
  readonly pause: WorkflowPause;

  constructor(pause: WorkflowPause) {
    super(`Workflow pending at pause '${pause.id}': ${pause.message}`);
    this.name = "WorkflowPendingError";
    this.pause = pause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isWorkflowPendingError(error: unknown): error is WorkflowPendingError {
  return error instanceof WorkflowPendingError ||
    !!(error && typeof error === "object" && (error as any).name === "WorkflowPendingError" && (error as any).pause);
}
