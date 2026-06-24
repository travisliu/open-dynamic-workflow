import { AsyncLocalStorage } from "node:async_hooks";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { getActiveWorkflowInvocation, type WorkflowInvocationContext } from "./invocation-types.js";

export type DslExecutionLocation =
  | "workflow-top-level"
  | "parallel-task"
  | "pipeline-stage"
  | "loop-round"
  | "shared-agent-definition"
  | "tool-definition"
  | "provider-callback"
  | "asynchronous-callback";

export interface DslExecutionScope {
  runId: string;
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  location: DslExecutionLocation;
  toolAllowed: boolean;
  topLevelWindow: boolean;
  sourcePath?: string | undefined;
  inheritedToolRestriction?: DslExecutionLocation | undefined;
}

const scopeStorage = new AsyncLocalStorage<DslExecutionScope>();

export function withDslExecutionScope<T>(scope: DslExecutionScope, fn: () => T): T {
  return scopeStorage.run(scope, fn);
}

export function withToolTopLevelWindow<T>(sourcePath: string | undefined, fn: () => T): T {
  const parentScope = getDslExecutionScope();
  if (!parentScope) {
    // Should not happen during workflow execution, but if it does, 
    // we don't have enough context to create a valid scope.
    return fn();
  }

  return scopeStorage.run({
    ...parentScope,
    topLevelWindow: true,
    sourcePath
  }, fn);
}

export function getDslExecutionScope(): DslExecutionScope | undefined {
  return scopeStorage.getStore();
}

export function assertToolAllowed(): DslExecutionScope {
  const scope = getDslExecutionScope();
  if (!scope) {
    // If no scope is present, it's an internal error because we should always have one during workflow execution.
    throw new OpenDynamicWorkflowError(
      ErrorCode.INTERNAL_ERROR,
      "No active DSL execution scope found."
    );
  }

  if (!scope.toolAllowed || !scope.topLevelWindow) {
    const restriction = scope.inheritedToolRestriction || scope.location;
    throw new OpenDynamicWorkflowError(
      ErrorCode.TOOL_INVALID_CONTEXT,
      `tool() is not allowed in ${restriction.replace(/-/g, " ")} context.`
    );
  }

  // If we are in a topLevelWindow, we must also verify we are NOT in a nested helper
  if (scope.topLevelWindow && scope.sourcePath) {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");
    
    // Look for frames that belong to the workflow file.
    // We expect exactly one frame (or two if executing the module top-level via VM IIFE) if it's a direct top-level call.
    // Note: The stack starts with "Error" line, then at least one frame for assertToolAllowed, 
    // then one or more for the DSL/executor, then the caller.
    
    let workflowFrames = 0;
    const workflowPath = scope.sourcePath;
    
    for (const line of lines) {
      // In Node.js VM, stack frames look like "at functionName (filename:line:col)"
      // or "at filename:line:col"
      if (line.includes(`(${workflowPath}:`) || line.includes(` ${workflowPath}:`)) {
        workflowFrames++;
      }
    }

    const hasVmContext = lines.some(line => line.includes("runInContext") || line.includes("node:vm"));
    const maxAllowedFrames = hasVmContext ? 2 : 1;

    if (workflowFrames > maxAllowedFrames) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.TOOL_INVALID_CONTEXT,
        "tool() is not allowed in a nested helper or callback context."
      );
    }
  }

  return scope;
}

export function assertLoopContextToolAllowed(): void {
  const scope = getDslExecutionScope();
  if (!scope) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.INTERNAL_ERROR,
      "No active DSL execution scope found."
    );
  }

  if (scope.location !== "loop-round") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.TOOL_INVALID_CONTEXT,
      `ctx.tool() is not allowed in ${scope.location.replace(/-/g, " ")} context.`
    );
  }
}

export function deriveChildWorkflowToolScope(
  parentScope: DslExecutionScope | undefined,
  childInvocation: WorkflowInvocationContext
): DslExecutionScope {
  return {
    runId: childInvocation.runId,
    workflowInvocationId: childInvocation.workflowInvocationId,
    parentWorkflowInvocationId: childInvocation.parentWorkflowInvocationId,
    location: "workflow-top-level",
    toolAllowed: true,
    topLevelWindow: false
  };
}

export function withToolForbidden<T>(location: DslExecutionLocation, fn: () => T): T {
  const parentScope = getDslExecutionScope();
  const currentInvocation = getActiveWorkflowInvocation();

  if (!currentInvocation) {
    // This might happen if called outside of a workflow context (e.g. shared agent execution)
    // We still want to forbid tools.
    return scopeStorage.run({
      runId: "unknown",
      workflowInvocationId: "unknown",
      location,
      toolAllowed: false,
      topLevelWindow: false
    }, fn);
  }

  const scope: DslExecutionScope = {
    runId: currentInvocation.runId,
    workflowInvocationId: currentInvocation.workflowInvocationId,
    parentWorkflowInvocationId: currentInvocation.parentWorkflowInvocationId,
    location,
    toolAllowed: false,
    topLevelWindow: false,
    inheritedToolRestriction: parentScope?.inheritedToolRestriction || (parentScope?.toolAllowed === false ? parentScope.location : undefined)
  };

  return scopeStorage.run(scope, fn);
}
