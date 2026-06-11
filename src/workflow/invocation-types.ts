import { AsyncLocalStorage } from "node:async_hooks";
import type { JsonObject } from "../types/common.js";
import type { WorkflowCallInput, WorkflowSettledResult } from "../types/workflow.js";
import type { WorkflowDefinition } from "./registry.js";

/**
 * Runtime-only invocation context shared by the invocation manager and DSL.
 * This owns the lifecycle and state of a single workflow invocation.
 */
export interface WorkflowInvocationContext {
  /** The root run ID */
  runId: string;
  /** Unique ID for this specific invocation */
  workflowInvocationId: string;
  /** Parent invocation ID if this is a child workflow */
  parentWorkflowInvocationId?: string | undefined;
  /** Name of the workflow being invoked */
  workflowName: string;
  /** The static definition being executed */
  definition: WorkflowDefinition;
  /** Current invocation depth (root is 0) */
  depth: number;
  /** List of workflow names in the active call stack (including this one) */
  ancestry: readonly string[];
  /** Input arguments for this invocation */
  args: JsonObject;
  /** Metadata passed to this invocation */
  metadata?: JsonObject | undefined;
  /** ISO timestamp of when this invocation started */
  startedAt: string;
  /** Epoch timestamp of when this invocation must complete */
  deadlineAt?: number | undefined;
  /** Abort signal for this specific invocation */
  signal: AbortSignal;
  /** Controller for this invocation's signal */
  abortController: AbortController;
  /** The current active phase in this invocation */
  currentPhase?: string | undefined;
  /** Local concurrency limit for agents in this subtree */
  effectiveConcurrency?: number | undefined;
  /** Budget tracker for concurrency in this subtree */
  concurrencyBudget?: {
    acquire(): Promise<void>;
    release(): void;
  } | undefined;
  /** Path to the artifacts directory for this invocation */
  artifactPath?: string | undefined;
}

/**
 * Handles root and child workflow execution, recursion detection, and lifecycle management.
 */
export interface WorkflowInvocationManager {
  /** Executes the root workflow */
  executeRoot(definition: WorkflowDefinition, args: JsonObject): Promise<unknown>;
  /** Invokes a child workflow from within another workflow */
  invokeChild<T>(
    parent: WorkflowInvocationContext,
    input: WorkflowCallInput
  ): Promise<T | WorkflowSettledResult<T>>;
}

const contextStorage = new AsyncLocalStorage<WorkflowInvocationContext>();

/**
 * Executes a function within the scope of a workflow invocation.
 */
export function withActiveWorkflowInvocation<T>(
  context: WorkflowInvocationContext,
  fn: () => T
): T {
  return contextStorage.run(context, fn);
}

/**
 * Retrieves the current active workflow invocation context from async storage.
 */
export function getActiveWorkflowInvocation(): WorkflowInvocationContext | undefined {
  return contextStorage.getStore();
}
