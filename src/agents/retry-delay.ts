import type { RetryPolicy } from "../types/retry.js";

export interface RetryDelayMetadata {
  delayMs: number;
  rawDelayMs: number;
  jitterApplied: boolean;
}

/**
 * Computes retry delay based on the policy and attempt number.
 * @param policy The retry policy configuration (only needs backoff, delayMs, maxDelayMs, and jitter)
 * @param attempt 1-based attempt number that just failed
 * @param rng Injectable random number generator for testing jitter
 */
export function computeRetryDelay(
  policy: Pick<RetryPolicy, "backoff" | "delayMs" | "maxDelayMs" | "jitter">,
  attempt: number,
  rng: () => number = Math.random
): RetryDelayMetadata {
  const rawDelayMs = policy.backoff === "exponential"
    ? policy.delayMs * Math.pow(2, attempt - 1)
    : policy.delayMs;

  let delayMs = rawDelayMs;
  if (policy.jitter) {
    delayMs = rng() * delayMs;
  }

  delayMs = Math.min(policy.maxDelayMs, delayMs);

  return {
    delayMs,
    rawDelayMs,
    jitterApplied: !!policy.jitter
  };
}

/**
 * Helper to perform an abortable delay.
 * Rejects with an Error("Aborted") if the signal is aborted.
 */
export async function sleepRetryDelay(
  delayMs: number,
  signal?: AbortSignal,
  options?: { disableDelay?: boolean }
): Promise<void> {
  if (options?.disableDelay) {
    return;
  }

  if (signal?.aborted) {
    throw new Error("Aborted");
  }

  if (delayMs <= 0) {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };

    signal?.addEventListener("abort", onAbort);
  });
}
