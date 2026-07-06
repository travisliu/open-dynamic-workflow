import type { AgentResult } from "../types/agent.js";
import type { InternalAttemptFailureReason } from "../types/retry.js";

export interface AttemptClassificationInput {
  result: AgentResult;
  thrownError?: unknown;
}

export interface AttemptClassification {
  reason: InternalAttemptFailureReason;
  retryable: boolean;
  code?: string;
  message: string;
}

export function classifyAttemptFailure(input: AttemptClassificationInput): AttemptClassification {
  const { result, thrownError } = input;

  // Extract error info from either thrownError or result
  let code: string | undefined;
  let message = "";
  let name: string | undefined;

  if (thrownError !== undefined && thrownError !== null) {
    if (typeof thrownError === "object") {
      const errObj = thrownError as Record<string, any>;
      code = errObj.code;
      message = errObj.message || String(thrownError);
      name = errObj.name;
    } else {
      message = String(thrownError);
    }
  } else if (result && !result.ok && result.error) {
    code = result.error.code;
    message = result.error.message || "";
    name = result.error.name;
  }

  // Helper mapping of error codes/names to InternalAttemptFailureReason
  const errorMap: Record<string, { reason: InternalAttemptFailureReason; retryable: boolean }> = {
    // Run limit
    RUN_LIMIT_EXCEEDED: { reason: "run_limit_exceeded", retryable: false },

    // Security policy violation
    SECURITY_POLICY_VIOLATION: { reason: "security_policy_violation", retryable: false },
    SHARED_AGENT_SECURITY_POLICY_VIOLATION: { reason: "security_policy_violation", retryable: false },

    // Cancelled
    USER_CANCELLED: { reason: "cancelled", retryable: false },
    WORKFLOW_CANCELLED: { reason: "cancelled", retryable: false },
    TOOL_CANCELLED: { reason: "cancelled", retryable: false },

    // Timed out
    PROCESS_TIMEOUT: { reason: "timed_out", retryable: false },
    WORKFLOW_TIMEOUT: { reason: "timed_out", retryable: false },
    TOOL_TIMEOUT: { reason: "timed_out", retryable: false },

    // Invalid configuration
    CLI_USAGE_ERROR: { reason: "invalid_configuration", retryable: false },
    CONFIG_VALIDATION_ERROR: { reason: "invalid_configuration", retryable: false },
    MODEL_CONFIG_INVALID: { reason: "invalid_configuration", retryable: false },
    MODEL_NOT_SUPPORTED: { reason: "invalid_configuration", retryable: false },
    UNSUPPORTED_CAPABILITY: { reason: "invalid_configuration", retryable: false },
    THINKING_EFFORT_NOT_SUPPORTED: { reason: "invalid_configuration", retryable: false },
    THINKING_EFFORT_VALUE_UNSUPPORTED: { reason: "invalid_configuration", retryable: false },
    THINKING_EFFORT_CONFLICT: { reason: "invalid_configuration", retryable: false },
    RETRY_INVALID_CONFIG: { reason: "invalid_configuration", retryable: false },
    RETRY_INVALID_POLICY: { reason: "invalid_configuration", retryable: false },

    // Invalid workflow
    WORKFLOW_PARSE_ERROR: { reason: "invalid_workflow", retryable: false },
    WORKFLOW_VALIDATION_ERROR: { reason: "invalid_workflow", retryable: false },
    WORKFLOW_INVALID_CALL: { reason: "invalid_workflow", retryable: false },
    WORKFLOW_INPUT_VALIDATION_FAILED: { reason: "invalid_workflow", retryable: false },
    WORKFLOW_RECURSION_DETECTED: { reason: "invalid_workflow", retryable: false },
    WORKFLOW_MAX_DEPTH_EXCEEDED: { reason: "invalid_workflow", retryable: false },

    // Schema validation failed
    SCHEMA_VALIDATION_FAILED: { reason: "schema_validation_failed", retryable: true },
    ValidationError: { reason: "schema_validation_failed", retryable: true },

    // Malformed output
    PARSE_ERROR: { reason: "malformed_output", retryable: true },
    ParseError: { reason: "malformed_output", retryable: true },

    // Provider / process errors
    PROVIDER_UNAVAILABLE: { reason: "provider_error", retryable: true },
    PROVIDER_PROCESS_FAILED: { reason: "provider_error", retryable: true },
    ProviderProcessFailed: { reason: "provider_error", retryable: true },
    PROCESS_SPAWN_FAILED: { reason: "process_error", retryable: true },
    PROCESS_ERROR: { reason: "process_error", retryable: true }
  };

  // Check code/name mapping first
  if (code) {
    const mapped = errorMap[code];
    if (mapped) {
      return { reason: mapped.reason, retryable: mapped.retryable, code, message };
    }
  }
  if (name) {
    const mapped = errorMap[name];
    if (mapped) {
      return { reason: mapped.reason, retryable: mapped.retryable, code: code || name, message };
    }
  }

  // Fall back to result status checks if result is present
  if (result) {
    if (result.ok) {
      return { reason: "unknown", retryable: false, message: "Attempt succeeded, no failure detected." };
    }

    if (result.status === "timed_out") {
      return { reason: "timed_out", retryable: false, code: code || "PROCESS_TIMEOUT", message: message || "Attempt timed out" };
    }
    if (result.status === "cancelled" || result.status === "skipped") {
      return { reason: "cancelled", retryable: false, code: code || "USER_CANCELLED", message: message || "Attempt cancelled" };
    }

    if (result.exitCode !== null && result.exitCode !== 0) {
      return {
        reason: "provider_error",
        retryable: true,
        code: code || "PROVIDER_PROCESS_FAILED",
        message: message || `Process exited with code ${result.exitCode}`
      };
    }
  }

  // Default fallback for unknown failures
  const defaultClassification: AttemptClassification = {
    reason: "unknown",
    retryable: false,
    message: message || "Unknown execution failure"
  };
  if (code !== undefined) {
    defaultClassification.code = code;
  }
  return defaultClassification;
}
