import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { ToolRuntimeApi } from "./runtime-api.js";

export async function withInjectedToolRuntimeGlobals<T>(
  api: ToolRuntimeApi,
  operation: () => Promise<T> | T
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
  const fn = api.defineTool;

  if (descriptor) {
    const isMatchingDataProperty = "value" in descriptor && descriptor.value === fn;
    if (!isMatchingDataProperty) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.TOOL_INVALID_DEFINITION,
        "Cannot install the active tool runtime: globalThis.defineTool is already bound."
      );
    }
    return await operation();
  }

  try {
    Object.defineProperty(globalThis, "defineTool", {
      value: fn,
      enumerable: false,
      writable: false,
      configurable: true
    });
  } catch (installError) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.INTERNAL_ERROR,
      "Failed to inject globalThis.defineTool.",
      { cause: installError }
    );
  }

  let result: T;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (err) {
    operationFailed = true;
    operationError = err;
  }

  let cleanupFailed = false;
  let cleanupError: unknown;
  try {
    const currentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    const matches = currentDescriptor &&
      currentDescriptor.value === fn &&
      currentDescriptor.enumerable === false &&
      currentDescriptor.writable === false &&
      currentDescriptor.configurable === true;

    if (!matches) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.INTERNAL_ERROR,
        "Failed to restore globalThis.defineTool after loading tools: descriptor replaced or changed."
      );
    }

    const removed = Reflect.deleteProperty(globalThis, "defineTool");
    if (!removed) {
      throw new Error("delete returned false");
    }
  } catch (err) {
    cleanupFailed = true;
    cleanupError = err;
  }

  if (cleanupFailed) {
    if (operationFailed) {
      const aggError = new AggregateError(
        [cleanupError, operationError],
        "Failed to restore globalThis.defineTool after loading tools, and the operation also failed."
      );
      throw new OpenDynamicWorkflowError(
        ErrorCode.INTERNAL_ERROR,
        "Failed to restore globalThis.defineTool after loading tools.",
        { cause: aggError }
      );
    } else {
      throw new OpenDynamicWorkflowError(
        ErrorCode.INTERNAL_ERROR,
        "Failed to restore globalThis.defineTool after loading tools.",
        { cause: cleanupError }
      );
    }
  }

  if (operationFailed) {
    throw operationError;
  }

  return result!;
}

