import { OpenDynamicWorkflowError } from "./types.js";
import type { SerializedError } from "./types.js";

export function serializeError(error: unknown): SerializedError {
  return serializeErrorWithSeen(error, false);
}

function isValidInitializationHint(hint: any): boolean {
  return (
    hint &&
    typeof hint === "object" &&
    hint.code === "PROJECT_INIT_MISSING" &&
    typeof hint.message === "string" &&
    typeof hint.command === "string" &&
    (hint.docsContext === undefined || typeof hint.docsContext === "string")
  );
}

function serializeErrorWithSeen(error: unknown, parentHasHint: boolean): SerializedError {
  const isOpenDynamicWorkflowError = error instanceof OpenDynamicWorkflowError || (error && typeof error === "object" && "code" in error && "name" in error && (error as any).name === "OpenDynamicWorkflowError");

  if (isOpenDynamicWorkflowError) {
    const execErr = error as any;
    const res: SerializedError = {
      name: execErr.name,
      message: execErr.message,
      code: execErr.code,
    };
    if (execErr.hint !== undefined && !parentHasHint) {
      res.hint = execErr.hint;
    }
    if (execErr.stack !== undefined) {
      res.stack = execErr.stack;
    }
    if (execErr.cause !== undefined) {
      const hasHint = parentHasHint || res.hint !== undefined;
      res.cause = serializeCause(execErr.cause, hasHint);
    }
    return res;
  }

  if (error instanceof Error || (error && typeof error === "object" && "name" in error && "message" in error)) {
    const errObj = error as any;
    const res: SerializedError = {
      name: String(errObj.name),
      message: String(errObj.message),
    };
    if (isValidInitializationHint(errObj.hint) && !parentHasHint) {
      res.hint = errObj.hint;
    }
    if (errObj.stack !== undefined) {
      res.stack = String(errObj.stack);
    }
    if (errObj.cause !== undefined) {
      const hasHint = parentHasHint || res.hint !== undefined;
      res.cause = serializeCause(errObj.cause, hasHint);
    }
    return res;
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}

function serializeCause(cause: unknown, parentHasHint: boolean): unknown {
  if (cause instanceof Error || (cause && typeof cause === "object" && "name" in cause && "message" in cause)) {
    return serializeErrorWithSeen(cause, parentHasHint);
  }
  return cause;
}

