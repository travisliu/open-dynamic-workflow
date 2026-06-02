import { ExecflowError } from "./types.js";
import type { SerializedError } from "./types.js";

export function serializeError(error: unknown): SerializedError {
  if (error instanceof ExecflowError) {
    const res: SerializedError = {
      name: error.name,
      message: error.message,
      code: error.code,
    };
    if (error.stack !== undefined) {
      res.stack = error.stack;
    }
    if (error.cause !== undefined) {
      res.cause = error.cause;
    }
    return res;
  }

  if (error instanceof Error || (error && typeof error === "object" && "name" in error && "message" in error)) {
    const errObj = error as any;
    const res: SerializedError = {
      name: String(errObj.name),
      message: String(errObj.message),
    };
    if (errObj.stack !== undefined) {
      res.stack = String(errObj.stack);
    }
    if (errObj.cause !== undefined) {
      res.cause = errObj.cause;
    }
    return res;
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}
