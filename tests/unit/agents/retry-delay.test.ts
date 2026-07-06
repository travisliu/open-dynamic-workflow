import { describe, it, expect } from "vitest";
import { computeRetryDelay, sleepRetryDelay } from "../../../src/agents/retry-delay.js";
import type { RetryPolicy } from "../../../src/types/retry.js";

describe("Retry Delay Helpers", () => {
  describe("computeRetryDelay", () => {
    it("returns fixed delay matching the configured base delay", () => {
      const policy: Pick<RetryPolicy, "backoff" | "delayMs" | "maxDelayMs" | "jitter"> = {
        backoff: "fixed",
        delayMs: 200,
        maxDelayMs: 1000,
        jitter: false,
      };

      const result1 = computeRetryDelay(policy, 1);
      expect(result1.delayMs).toBe(200);
      expect(result1.rawDelayMs).toBe(200);
      expect(result1.jitterApplied).toBe(false);

      const result2 = computeRetryDelay(policy, 3);
      expect(result2.delayMs).toBe(200);
      expect(result2.rawDelayMs).toBe(200);
    });

    it("grows exponentially across 1-based attempts", () => {
      const policy: Pick<RetryPolicy, "backoff" | "delayMs" | "maxDelayMs" | "jitter"> = {
        backoff: "exponential",
        delayMs: 100,
        maxDelayMs: 5000,
        jitter: false,
      };

      // 1st attempt: 100 * 2^0 = 100
      const res1 = computeRetryDelay(policy, 1);
      expect(res1.delayMs).toBe(100);
      expect(res1.rawDelayMs).toBe(100);

      // 2nd attempt: 100 * 2^1 = 200
      const res2 = computeRetryDelay(policy, 2);
      expect(res2.delayMs).toBe(200);
      expect(res2.rawDelayMs).toBe(200);

      // 3rd attempt: 100 * 2^2 = 400
      const res3 = computeRetryDelay(policy, 3);
      expect(res3.delayMs).toBe(400);
      expect(res3.rawDelayMs).toBe(400);
    });

    it("caps the computed delay at maxDelayMs", () => {
      const policy: Pick<RetryPolicy, "backoff" | "delayMs" | "maxDelayMs" | "jitter"> = {
        backoff: "exponential",
        delayMs: 1000,
        maxDelayMs: 3000,
        jitter: false,
      };

      // 1st: 1000
      expect(computeRetryDelay(policy, 1).delayMs).toBe(1000);
      // 2nd: 2000
      expect(computeRetryDelay(policy, 2).delayMs).toBe(2000);
      // 3rd: 4000 raw -> capped at 3000
      const res3 = computeRetryDelay(policy, 3);
      expect(res3.rawDelayMs).toBe(4000);
      expect(res3.delayMs).toBe(3000);
    });

    it("applies jitter to the computed delay when enabled", () => {
      const policy: Pick<RetryPolicy, "backoff" | "delayMs" | "maxDelayMs" | "jitter"> = {
        backoff: "fixed",
        delayMs: 500,
        maxDelayMs: 1000,
        jitter: true,
      };

      // Stub RNG to return 0.5
      const mockRng = () => 0.5;

      const result = computeRetryDelay(policy, 1, mockRng);
      expect(result.rawDelayMs).toBe(500);
      expect(result.delayMs).toBe(250); // 500 * 0.5
      expect(result.jitterApplied).toBe(true);
    });

    it("jitter does not break the maximum cap", () => {
      const policy: Pick<RetryPolicy, "backoff" | "delayMs" | "maxDelayMs" | "jitter"> = {
        backoff: "fixed",
        delayMs: 1000,
        maxDelayMs: 800,
        jitter: true,
      };

      // If mockRng returns 0.9, raw delay (1000) * 0.9 = 900.
      // This is greater than maxDelayMs (800).
      // Since cap is applied last, it should be capped at 800.
      const mockRng = () => 0.9;

      const result = computeRetryDelay(policy, 1, mockRng);
      expect(result.rawDelayMs).toBe(1000);
      expect(result.delayMs).toBe(800);
    });

    it("caps delay when raw curve exceeds the cap before jitter is applied", () => {
      const policy: Pick<RetryPolicy, "backoff" | "delayMs" | "maxDelayMs" | "jitter"> = {
        backoff: "exponential",
        delayMs: 1000,
        maxDelayMs: 1500,
        jitter: true,
      };

      // 3rd attempt: 1000 * 4 = 4000 raw.
      // If mockRng returns 0.5, raw (4000) * 0.5 = 2000.
      // Capped at 1500.
      const mockRng = () => 0.5;

      const result = computeRetryDelay(policy, 3, mockRng);
      expect(result.rawDelayMs).toBe(4000);
      expect(result.delayMs).toBe(1500);
    });
  });

  describe("sleepRetryDelay", () => {
    it("resolves after the specified duration", async () => {
      const start = Date.now();
      await sleepRetryDelay(20);
      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(15);
    });

    it("resolves immediately when disableDelay is true", async () => {
      const start = Date.now();
      await sleepRetryDelay(5000, undefined, { disableDelay: true });
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });

    it("aborts immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(sleepRetryDelay(1000, controller.signal)).rejects.toThrow("Aborted");
    });

    it("aborts during wait when signal is aborted", async () => {
      const controller = new AbortController();
      const sleepPromise = sleepRetryDelay(1000, controller.signal);

      // Abort after 10ms
      setTimeout(() => {
        controller.abort();
      }, 10);

      const start = Date.now();
      await expect(sleepPromise).rejects.toThrow("Aborted");
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });
});
