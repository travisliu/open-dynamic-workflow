export type RetryBackoff = "fixed" | "exponential";

export interface RetryPolicy {
  maxAttempts: number;
  delayMs: number;
  backoff: RetryBackoff;
  maxDelayMs: number;
  jitter: boolean;
  disableDelay: boolean;
}

export type RetryPolicyInput = false | Partial<RetryPolicy>;

export interface RetryConfigInput extends Partial<RetryPolicy> {}

/**
 * Documented internal attempt failure reasons for v1 behavior, reporting,
 * artifacts, and diagnostics. These values are not public retry-policy
 * selectors and must not be accepted in user config, CLI flags, or DSL policy.
 */
export type InternalAttemptFailureReason =
  | "provider_error"
  | "process_error"
  | "timed_out"
  | "malformed_output"
  | "schema_validation_failed"
  | "cancelled"
  | "security_policy_violation"
  | "invalid_configuration"
  | "invalid_workflow"
  | "run_limit_exceeded"
  | "unknown";

export type RetryAttemptStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "skipped";

export interface RetryAttemptSummary {
  attempt: number;
  status: RetryAttemptStatus;
  retryable: boolean;
  failureReason?: InternalAttemptFailureReason | string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  durationMs?: number | undefined;
  computedDelayBeforeNextAttemptMs?: number | undefined;
  delaySkipped?: boolean | undefined;
  artifactPath: string;
}

export interface RetrySummaryArtifact {
  schemaVersion: "open-dynamic-workflow.retry-summary.v1";
  enabled: boolean;
  exhausted: boolean;
  maxAttempts: number;
  attemptsStarted: number;
  finalAttempt: number;
  finalStatus: "succeeded" | "failed" | "cancelled" | "timed_out" | "skipped";
  finalFailureReason?: InternalAttemptFailureReason | string | undefined;
  policy: RetryPolicy;
  attempts: RetryAttemptSummary[];
}

export interface RetryMetadata {
  enabled: boolean;
  exhausted: boolean;
  maxAttempts: number;
  attemptsStarted: number;
  finalAttempt: number;
  finalFailureReason?: InternalAttemptFailureReason | string | undefined;
  summaryPath?: string | undefined;
  attempts: RetryAttemptSummary[];
}

export interface ResolvedRetryPolicy {
  enabled: boolean;
  policy: RetryPolicy;
  source: "default" | "config" | "cli" | "agent" | "disabled" | "providerAlias";
  disabledBy?: "omitted" | "cli" | "agent" | undefined;
}
