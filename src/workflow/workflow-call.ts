import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { JsonObject } from "../types/common.js";
import type { WorkflowCallInput, WorkflowFailureMode, WorkflowContextOptions, ContextMergeStrategy, ContextInheritRule } from "../types/workflow.js";
import { cloneJsonObject } from "./json.js";

export interface NormalizedWorkflowCall {
  name: string;
  args: JsonObject;
  failureMode: WorkflowFailureMode;
  timeoutMs?: number | undefined;
  concurrency?: number | undefined;
  metadata?: JsonObject | undefined;
  context?: WorkflowContextOptions | undefined;
}

export function normalizeWorkflowCall(input: unknown): NormalizedWorkflowCall {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      "workflow() input must be an object."
    );
  }

  const callInput = input as WorkflowCallInput;

  if (callInput.name === undefined || typeof callInput.name !== "string") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      "workflow() input must contain a valid 'name' string."
    );
  }

  const name = callInput.name.trim();
  if (name.length === 0) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      "workflow() name cannot be empty."
    );
  }

  if (isPathLikeWorkflowName(name)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      `workflow() name '${name}' cannot be a path.`
    );
  }

  const args = callInput.args ? cloneJsonObject(callInput.args, "workflow() args") : {};
  const failureMode: WorkflowFailureMode = callInput.failureMode || "throw";
  if (failureMode !== "throw" && failureMode !== "settled") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      `workflow() failureMode must be 'throw' or 'settled', got '${failureMode}'.`
    );
  }

  let timeoutMs: number | undefined;
  if (callInput.timeoutMs !== undefined) {
    if (typeof callInput.timeoutMs !== "number" || !Number.isInteger(callInput.timeoutMs) || callInput.timeoutMs <= 0) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.WORKFLOW_INVALID_CALL,
        "workflow() timeoutMs must be a positive integer."
      );
    }
    timeoutMs = callInput.timeoutMs;
  }

  let concurrency: number | undefined;
  if (callInput.concurrency !== undefined) {
    if (typeof callInput.concurrency !== "number" || !Number.isInteger(callInput.concurrency) || callInput.concurrency <= 0) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.WORKFLOW_INVALID_CALL,
        "workflow() concurrency must be a positive integer."
      );
    }
    concurrency = callInput.concurrency;
  }

  const metadata = callInput.metadata ? cloneJsonObject(callInput.metadata, "workflow() metadata") : undefined;

  let context: WorkflowContextOptions | undefined;
  if (callInput.context !== undefined) {
    if (!callInput.context || typeof callInput.context !== "object" || Array.isArray(callInput.context)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.WORKFLOW_INVALID_CALL,
        "workflow() context must be a plain object."
      );
    }
    const rawContext = callInput.context;
    const allowedKeys = ["inherit", "merge"];
    for (const key of Object.keys(rawContext)) {
      if (!allowedKeys.includes(key)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.WORKFLOW_INVALID_CALL,
          `workflow() context has invalid key '${key}'.`
        );
      }
    }

    let inherit: ContextInheritRule[] | undefined;
    if (rawContext.inherit !== undefined) {
      if (!Array.isArray(rawContext.inherit)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.WORKFLOW_INVALID_CALL,
          "workflow() context.inherit must be an array."
        );
      }
      for (const item of rawContext.inherit) {
        if (typeof item === "string") {
          // Valid
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          if (typeof item.path !== "string") {
            throw new OpenDynamicWorkflowError(
              ErrorCode.WORKFLOW_INVALID_CALL,
              "workflow() context.inherit rule path must be a string."
            );
          }
          if (item.required !== undefined && typeof item.required !== "boolean") {
            throw new OpenDynamicWorkflowError(
              ErrorCode.WORKFLOW_INVALID_CALL,
              "workflow() context.inherit rule required must be a boolean."
            );
          }
        } else {
          throw new OpenDynamicWorkflowError(
            ErrorCode.WORKFLOW_INVALID_CALL,
            "workflow() context.inherit rule must be a string or object."
          );
        }
      }
      inherit = rawContext.inherit;
    }

    let merge: Record<string, ContextMergeStrategy> | undefined;
    if (rawContext.merge !== undefined) {
      if (!rawContext.merge || typeof rawContext.merge !== "object" || Array.isArray(rawContext.merge)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.WORKFLOW_INVALID_CALL,
          "workflow() context.merge must be a plain object."
        );
      }
      const allowedStrategies = ["append", "merge", "replace", "rejectOnConflict"];
      for (const [key, val] of Object.entries(rawContext.merge)) {
        if (!allowedStrategies.includes(val as string)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.WORKFLOW_INVALID_CALL,
            `workflow() context.merge strategy for '${key}' must be one of ${allowedStrategies.join(", ")}, got '${val}'.`
          );
        }
      }
      merge = rawContext.merge as Record<string, ContextMergeStrategy>;
    }

    context = { inherit, merge };
  }

  return {
    name,
    args,
    failureMode,
    timeoutMs,
    concurrency,
    metadata,
    context
  };
}

export function isPathLikeWorkflowName(name: string): boolean {
  return (
    name.startsWith("./") ||
    name.startsWith("../") ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.startsWith("file:") ||
    /^[A-Z]:\\/i.test(name) ||
    /(^|[\\/])\.\.([\\/]|$)/.test(name) ||
    name.includes("/") ||
    name.includes("\\") ||
    name.endsWith(".ts") ||
    name.endsWith(".js")
  );
}
