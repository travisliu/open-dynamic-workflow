import type { ThinkingEffort } from "../types/thinking-effort.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export const CODEX_THINKING_EFFORTS = new Set<ThinkingEffort>([
  "minimal",
  "low",
  "medium",
  "high"
]);

export const PI_THINKING_EFFORTS = new Set<ThinkingEffort>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);

export const OPENCODE_THINKING_EFFORTS = new Set<ThinkingEffort>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);

const SUPPORTED_PROVIDERS = new Set(["codex", "pi", "opencode"]);

export function assertThinkingEffortSupported(provider: string, value?: ThinkingEffort): void {
  if (value === undefined) {
    return;
  }

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.THINKING_EFFORT_NOT_SUPPORTED,
      `Provider '${provider}' does not support thinkingEffort. Supported providers: codex, pi, opencode.`
    );
  }

  if (provider === "codex") {
    if (!CODEX_THINKING_EFFORTS.has(value)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.THINKING_EFFORT_VALUE_UNSUPPORTED,
        `Provider 'codex' does not support thinkingEffort '${value}'. Supported values: minimal, low, medium, high.`
      );
    }
  } else if (provider === "pi") {
    if (!PI_THINKING_EFFORTS.has(value)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.THINKING_EFFORT_VALUE_UNSUPPORTED,
        `Provider 'pi' does not support thinkingEffort '${value}'. Supported values: off, minimal, low, medium, high, xhigh.`
      );
    }
  } else if (provider === "opencode") {
    if (!OPENCODE_THINKING_EFFORTS.has(value)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.THINKING_EFFORT_VALUE_UNSUPPORTED,
        `Provider 'opencode' does not support thinkingEffort '${value}'. Supported values: off, minimal, low, medium, high, xhigh.`
      );
    }
  }
}

export function mapOpenCodeThinkingEffort(value: ThinkingEffort): string {
  return value === "off" ? "none" : value;
}
