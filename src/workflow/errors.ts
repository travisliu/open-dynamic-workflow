export class InvalidDslCallError extends Error {
  readonly code = "INVALID_DSL_CALL";
  constructor(message: string) {
    super(message);
    this.name = "InvalidDslCallError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RuntimeExecutionError extends Error {
  readonly code = "RUNTIME_EXECUTION_ERROR";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "RuntimeExecutionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorkflowCancelledError extends Error {
  readonly code = "WORKFLOW_CANCELLED";
  constructor(message: string) {
    super(message);
    this.name = "WorkflowCancelledError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SchedulerAbortedError extends Error {
  readonly code = "SCHEDULER_ABORTED";
  constructor(message: string) {
    super(message);
    this.name = "SchedulerAbortedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
