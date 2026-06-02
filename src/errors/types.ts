import type { ErrorCode } from "./codes.js";

export interface SerializedError {
  name: string;
  message: string;
  code?: ErrorCode | string;
  stack?: string;
  cause?: unknown;
}

export class ExecflowError extends Error {
  readonly code: ErrorCode;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ExecflowError";
    this.code = code;
    this.cause = options?.cause;
    // Restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
