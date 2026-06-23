import type { ErrorCode } from "./codes.js";
import type { InitializationHint } from "./project-init-hint.js";

export interface SerializedError {
  name: string;
  message: string;
  code?: ErrorCode | string;
  stack?: string;
  cause?: unknown;
  hint?: InitializationHint | undefined;
}

export class OpenDynamicWorkflowError extends Error {
  readonly code: ErrorCode;
  override readonly cause?: unknown;
  readonly hint?: InitializationHint | undefined;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown; hint?: InitializationHint | undefined }) {
    super(message);
    this.name = "OpenDynamicWorkflowError";
    this.code = code;
    this.cause = options?.cause;
    this.hint = options?.hint;
    // Restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

