import type { ExecflowErrorCode, SerializedError } from "../types/errors.js";

export function serializeError(error: unknown, fallbackCode: ExecflowErrorCode = "INTERNAL_ERROR"): SerializedError {
  if (error instanceof Error) {
    const maybeCode = (error as Error & { code?: string }).code;
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
      code: maybeCode ?? fallbackCode
    };

    if (error.stack) {
      serialized.stack = error.stack;
    }

    return serialized;
  }

  return {
    name: "NonErrorThrown",
    message: String(error),
    code: fallbackCode
  };
}
