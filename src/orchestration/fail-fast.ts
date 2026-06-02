import type { AgentResult } from "../types/agent.js";

/**
 * Checks if a value is a failed AgentResult.
 */
export function isAgentFailureResult(value: unknown): boolean {
  if (value && typeof value === "object" && "ok" in value) {
    const res = value as AgentResult;
    return res.ok === false;
  }
  return false;
}

/**
 * Determines whether a task outcome should trigger fail-fast behavior.
 */
export function shouldTriggerFailFast(value: unknown, error?: unknown): boolean {
  if (error) return true;
  if (isAgentFailureResult(value)) return true;
  return false;
}
