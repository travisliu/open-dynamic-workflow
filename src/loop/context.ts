import { AsyncLocalStorage } from "node:async_hooks";
import type { LoopContext } from "./types.js";
import { createLoopAgentId, createLoopToolId } from "./id.js";
import type { AgentCallInput, AgentResult } from "../types/agent.js";
import type { WorkflowCallInput, WorkflowSettledResult } from "../types/workflow.js";
import type { ToolCallInput } from "../types/tool.js";

/**
 * Internal state for the active loop round.
 */
export interface ActiveLoopContext {
  loopId: string;
  label: string;
  roundIndex: number;
  roundNumber: number;
  roundId: string;
  childAgentIds: string[];
  childWorkflowInvocationIds: string[];
  childToolCallIds?: string[];
  activeToolPromise?: Promise<any> | undefined;
  signal: AbortSignal;
  parentLoopId?: string;
  workflowInvocationId?: string;
}

const loopContextStorage = new AsyncLocalStorage<ActiveLoopContext>();

/**
 * Returns the active loop context if currently executing inside a loop round.
 */
export function getActiveLoopContext(): ActiveLoopContext | undefined {
  return loopContextStorage.getStore();
}

/**
 * Runs a callback within an active loop context.
 */
export function withActiveLoopContext<T>(
  context: ActiveLoopContext,
  run: () => T
): T {
  return loopContextStorage.run(context, run);
}

/**
 * Records a child agent ID in the active loop context.
 */
export function recordLoopChildAgentId(agentId: string): void {
  const context = getActiveLoopContext();
  if (context) {
    if (!context.childAgentIds.includes(agentId)) {
      context.childAgentIds.push(agentId);
    }
  }
}

/**
 * Records a child workflow invocation ID in the active loop context.
 */
export function recordLoopChildWorkflowInvocationId(workflowInvocationId: string): void {
  const context = getActiveLoopContext();
  if (context) {
    if (!context.childWorkflowInvocationIds.includes(workflowInvocationId)) {
      context.childWorkflowInvocationIds.push(workflowInvocationId);
    }
  }
}

export function recordLoopChildToolCallId(toolCallId: string): void {
  const context = getActiveLoopContext();
  if (context) {
    context.childToolCallIds ??= [];
    if (!context.childToolCallIds.includes(toolCallId)) {
      context.childToolCallIds.push(toolCallId);
    }
  }
}

/**
 * Input for creating a loop round context.
 */
export interface CreateLoopRoundContextInput {
  loopId: string;
  label: string;
  runId: string;
  artifactsDir: string;
  roundIndex: number;
  roundNumber: number;
  signal: AbortSignal;
  dsl: {
    agent: (input: AgentCallInput) => Promise<AgentResult>;
    workflow: (input: WorkflowCallInput) => Promise<any>;
    tool: (input: ToolCallInput) => Promise<any>;
    log: (message: string, data?: any) => void;
  };
}

/**
 * Creates the context object passed to loop round callbacks.
 */
export function createLoopRoundContext(
  input: CreateLoopRoundContextInput
): LoopContext {
  const { loopId, label, roundIndex, roundNumber, dsl } = input;
  let agentCounter = 0;

  return {
    loopId,
    label,
    roundIndex,
    roundNumber,
    signal: input.signal,

    agent: async (agentInput: AgentCallInput): Promise<AgentResult> => {
      let agentId: string;
      if (agentInput.id !== undefined) {
        agentId = agentInput.id;
      } else {
        agentCounter++;
        const suffix = agentInput.label?.trim();
        const idPattern = /^[A-Za-z0-9_.:-]+$/;
        const isValid = suffix &&
          suffix !== "" &&
          suffix !== "." &&
          suffix !== ".." &&
          !suffix.includes("/") &&
          !suffix.includes("\\") &&
          !suffix.includes("..") &&
          idPattern.test(suffix);

        if (isValid) {
          agentId = createLoopAgentId({
            label,
            roundNumber,
            suffix,
          });
        } else {
          agentId = createLoopAgentId({
            label,
            roundNumber,
            suffix: `agent-${agentCounter}`,
          });
        }
      }
      return dsl.agent({ ...agentInput, id: agentId });
    },

    workflow: async <T = unknown>(workflowInput: WorkflowCallInput): Promise<T | WorkflowSettledResult<T>> => {
      return dsl.workflow(workflowInput);
    },

    tool: async (toolInput: ToolCallInput): Promise<any> => {
      if (input.signal.aborted) {
        throw input.signal.reason || new Error("Loop round aborted");
      }
      return dsl.tool(toolInput);
    },

    log: (message: string, data?: any): void => {
      const logData = {
        ...(data && typeof data === "object" ? data : { raw: data }),
        loop: {
          loopId,
          label,
          roundIndex,
          roundNumber,
        },
      };
      dsl.log(message, logData);
    },

    agentId: (suffix?: string): string => {
      return createLoopAgentId({
        label,
        roundNumber,
        ...(suffix !== undefined ? { suffix } : {}),
      });
    },

    toolId: (suffix?: string): string => {
      return createLoopToolId({
        label,
        roundNumber,
        ...(suffix !== undefined ? { suffix } : {}),
      });
    },

    sleep: (ms: number): Promise<void> => {
      if (typeof ms !== "number" || ms < 0 || !Number.isFinite(ms)) {
        throw new Error("sleep: ms must be a non-negative finite number.");
      }
      return new Promise((resolve, reject) => {
        const abortHandler = () => {
          clearTimeout(timeout);
          input.signal.removeEventListener("abort", abortHandler);
          reject(input.signal.reason || new Error("Aborted"));
        };

        if (input.signal.aborted) {
          reject(input.signal.reason || new Error("Aborted"));
          return;
        }

        const timeout = setTimeout(() => {
          input.signal.removeEventListener("abort", abortHandler);
          resolve();
        }, ms);
        
        input.signal.addEventListener("abort", abortHandler);
      });
    },
  };
}
