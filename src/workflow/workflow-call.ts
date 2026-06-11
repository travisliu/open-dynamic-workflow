import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { JsonObject } from "../types/common.js";
import type { WorkflowCallInput, WorkflowFailureMode } from "../types/workflow.js";
import { cloneJsonObject } from "./json.js";

export interface NormalizedWorkflowCall {
  name: string;
  args: JsonObject;
  failureMode: WorkflowFailureMode;
  timeoutMs?: number | undefined;
  concurrency?: number | undefined;
  metadata?: JsonObject | undefined;
}

export function normalizeWorkflowCall(input: unknown): NormalizedWorkflowCall {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      "workflow() input must be an object."
    );
  }

  const callInput = input as WorkflowCallInput;

  if (callInput.name === undefined || typeof callInput.name !== "string") {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      "workflow() input must contain a valid 'name' string."
    );
  }

  const name = callInput.name.trim();
  if (name.length === 0) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      "workflow() name cannot be empty."
    );
  }

  if (isPathLikeWorkflowName(name)) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      `workflow() name '${name}' cannot be a path.`
    );
  }

  const args = callInput.args ? cloneJsonObject(callInput.args, "workflow() args") : {};
  const failureMode: WorkflowFailureMode = callInput.failureMode || "throw";
  if (failureMode !== "throw" && failureMode !== "settled") {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      `workflow() failureMode must be 'throw' or 'settled', got '${failureMode}'.`
    );
  }

  let timeoutMs: number | undefined;
  if (callInput.timeoutMs !== undefined) {
    if (typeof callInput.timeoutMs !== "number" || !Number.isInteger(callInput.timeoutMs) || callInput.timeoutMs <= 0) {
      throw new OpenFlowError(
        ErrorCode.WORKFLOW_INVALID_CALL,
        "workflow() timeoutMs must be a positive integer."
      );
    }
    timeoutMs = callInput.timeoutMs;
  }

  let concurrency: number | undefined;
  if (callInput.concurrency !== undefined) {
    if (typeof callInput.concurrency !== "number" || !Number.isInteger(callInput.concurrency) || callInput.concurrency <= 0) {
      throw new OpenFlowError(
        ErrorCode.WORKFLOW_INVALID_CALL,
        "workflow() concurrency must be a positive integer."
      );
    }
    concurrency = callInput.concurrency;
  }

  const metadata = callInput.metadata ? cloneJsonObject(callInput.metadata, "workflow() metadata") : undefined;

  return {
    name,
    args,
    failureMode,
    timeoutMs,
    concurrency,
    metadata
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
