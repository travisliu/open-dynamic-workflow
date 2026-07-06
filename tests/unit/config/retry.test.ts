import { describe, expect, it } from "vitest";
import {
  resolveGlobalRetryPolicy,
  resolveAgentRetryPolicy,
  BUILT_IN_DEFAULT_POLICY,
  RECOMMENDED_ENABLED_DEFAULTS
} from "../../../src/config/retry.js";
import type { RetryCliOverrides } from "../../../src/config/retry.js";

describe("Retry Resolver", () => {
  describe("resolveGlobalRetryPolicy", () => {
    it("returns built-in default retry policy when no retry config is supplied", () => {
      const resolved = resolveGlobalRetryPolicy({});
      expect(resolved.enabled).toBe(false);
      expect(resolved.source).toBe("default");
      expect(resolved.disabledBy).toBe("omitted");
      expect(resolved.policy).toEqual(BUILT_IN_DEFAULT_POLICY);
    });

    it("merges config-file retry fields over built-in defaults field by field", () => {
      const resolved = resolveGlobalRetryPolicy({
        configRetry: { maxAttempts: 5, delayMs: 500 }
      });
      expect(resolved.enabled).toBe(true);
      expect(resolved.source).toBe("config");
      expect(resolved.policy.maxAttempts).toBe(5);
      expect(resolved.policy.delayMs).toBe(500);
      expect(resolved.policy.backoff).toBe(RECOMMENDED_ENABLED_DEFAULTS.backoff);
      expect(resolved.policy.jitter).toBe(RECOMMENDED_ENABLED_DEFAULTS.jitter);
    });

    it("applies CLI overrides on top of the resolved global retry policy", () => {
      const resolved = resolveGlobalRetryPolicy({
        configRetry: { maxAttempts: 5, delayMs: 500 },
        cliOverrides: { maxAttempts: 10, backoff: "fixed" }
      });
      expect(resolved.enabled).toBe(true);
      expect(resolved.source).toBe("cli");
      expect(resolved.policy.maxAttempts).toBe(10);
      expect(resolved.policy.delayMs).toBe(500);
      expect(resolved.policy.backoff).toBe("fixed");
    });

    it("handles cli.noRetry by disabling retry and setting maxAttempts: 1", () => {
      const resolved = resolveGlobalRetryPolicy({
        configRetry: { maxAttempts: 5 },
        cliOverrides: { noRetry: true }
      });
      expect(resolved.enabled).toBe(false);
      expect(resolved.source).toBe("cli");
      expect(resolved.disabledBy).toBe("cli");
      expect(resolved.policy.maxAttempts).toBe(1);
    });

    it("does not mutate the input config or cli override objects", () => {
      const configRetry = { maxAttempts: 5 };
      const cliOverrides: RetryCliOverrides = { maxAttempts: 10 };
      resolveGlobalRetryPolicy({ configRetry, cliOverrides });
      expect(configRetry.maxAttempts).toBe(5);
      expect(cliOverrides.maxAttempts).toBe(10);
    });

    it("handles configRetry: false by disabling retry and setting maxAttempts: 1", () => {
      const resolved = resolveGlobalRetryPolicy({
        configRetry: false
      });
      expect(resolved.enabled).toBe(false);
      expect(resolved.source).toBe("disabled");
      expect(resolved.policy.maxAttempts).toBe(1);
      expect(resolved.policy.delayMs).toBe(1000);
    });

    it("keeps configRetry: false disabled even when CLI retry fields are present", () => {
      const resolved = resolveGlobalRetryPolicy({
        configRetry: false,
        cliOverrides: {
          maxAttempts: 10,
          backoff: "fixed"
        }
      });
      expect(resolved.enabled).toBe(false);
      expect(resolved.source).toBe("disabled");
      expect(resolved.policy).toEqual(BUILT_IN_DEFAULT_POLICY);
    });

    it("returns semantically identical policy shape regardless of key ordering in inputs", () => {
      const config1 = {
        maxAttempts: 5,
        delayMs: 200,
        backoff: "exponential" as const,
        maxDelayMs: 10000,
        jitter: true,
        disableDelay: false
      };
      
      const config2 = {
        jitter: true,
        backoff: "exponential" as const,
        delayMs: 200,
        maxDelayMs: 10000,
        disableDelay: false,
        maxAttempts: 5
      };

      const res1 = resolveGlobalRetryPolicy({ configRetry: config1 });
      const res2 = resolveGlobalRetryPolicy({ configRetry: config2 });

      expect(JSON.stringify(res1.policy)).toBe(JSON.stringify(res2.policy));
    });

    describe("disableDelay regression safety", () => {
      it("defaults disableDelay to false in built-in default policy", () => {
        const resolved = resolveGlobalRetryPolicy({});
        expect(resolved.policy.disableDelay).toBe(false);
      });

      it("preserves disableDelay: true from config-file retry input", () => {
        const resolved = resolveGlobalRetryPolicy({
          configRetry: { disableDelay: true }
        });
        expect(resolved.policy.disableDelay).toBe(true);
      });

      it("preserves disableDelay: false from config-file retry input", () => {
        const resolved = resolveGlobalRetryPolicy({
          configRetry: { disableDelay: false }
        });
        expect(resolved.policy.disableDelay).toBe(false);
      });

      it("applies CLI overrides for disableDelay: true", () => {
        const resolved = resolveGlobalRetryPolicy({
          configRetry: { maxAttempts: 5 },
          cliOverrides: { disableDelay: true }
        });
        expect(resolved.policy.disableDelay).toBe(true);
      });

      it("applies CLI overrides for disableDelay: false", () => {
        const resolved = resolveGlobalRetryPolicy({
          configRetry: { maxAttempts: 5, disableDelay: true },
          cliOverrides: { disableDelay: false }
        });
        expect(resolved.policy.disableDelay).toBe(false);
      });

      it("applies CLI overrides for disableDelay even when noRetry is true", () => {
        const resolved = resolveGlobalRetryPolicy({
          configRetry: { maxAttempts: 5 },
          cliOverrides: { noRetry: true, disableDelay: true }
        });
        expect(resolved.policy.disableDelay).toBe(true);
      });

      it("does not mutate configRetry or cliOverrides when disableDelay is present", () => {
        const configRetry = { maxAttempts: 5, disableDelay: true };
        const cliOverrides = { disableDelay: false };
        resolveGlobalRetryPolicy({ configRetry, cliOverrides });
        expect(configRetry.disableDelay).toBe(true);
        expect(cliOverrides.disableDelay).toBe(false);
      });

      it("keeps resolved policy shape stable and deterministic when disableDelay is present", () => {
        const resolved = resolveGlobalRetryPolicy({
          configRetry: { disableDelay: true }
        });
        expect(Object.keys(resolved.policy)).toEqual([
          "maxAttempts",
          "delayMs",
          "backoff",
          "maxDelayMs",
          "jitter",
          "disableDelay"
        ]);
      });
    });
  });

  describe("resolveAgentRetryPolicy", () => {
    it("returns global policy when agentRetry is omitted", () => {
      const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { maxAttempts: 5 } });
      const resolved = resolveAgentRetryPolicy({ globalPolicy });
      expect(resolved).toEqual(globalPolicy);
    });

    it("applies agent overrides on top of resolved global policy", () => {
      const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { maxAttempts: 5, delayMs: 200 } });
      const resolved = resolveAgentRetryPolicy({
        globalPolicy,
        agentRetry: { maxAttempts: 2, jitter: false }
      });
      expect(resolved.enabled).toBe(true);
      expect(resolved.source).toBe("agent");
      expect(resolved.policy.maxAttempts).toBe(2);
      expect(resolved.policy.delayMs).toBe(200);
      expect(resolved.policy.jitter).toBe(false);
    });

    it("allows agent override to be false, disabling retry and skipping merge", () => {
      const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { maxAttempts: 5, delayMs: 200 } });
      const resolved = resolveAgentRetryPolicy({
        globalPolicy,
        agentRetry: false
      });
      expect(resolved.enabled).toBe(false);
      expect(resolved.source).toBe("disabled");
      expect(resolved.disabledBy).toBe("agent");
      expect(resolved.policy.maxAttempts).toBe(1);
      // It should NOT carry the global 200ms delay, but default back to built-in default structure
      expect(resolved.policy.delayMs).toBe(1000);
    });

    it("keeps a globally disabled retry policy disabled even when agent retry fields are present", () => {
      const globalPolicy = resolveGlobalRetryPolicy({ configRetry: false });
      const resolved = resolveAgentRetryPolicy({
        globalPolicy,
        agentRetry: {
          maxAttempts: 10,
          backoff: "fixed"
        }
      });

      expect(resolved).toEqual(globalPolicy);
      expect(resolved.enabled).toBe(false);
      expect(resolved.source).toBe("disabled");
      expect(resolved.policy).toEqual(BUILT_IN_DEFAULT_POLICY);
    });

    it("does not mutate the globalPolicy object or agentRetry object", () => {
      const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { maxAttempts: 5 } });
      const agentRetry = { maxAttempts: 2 };
      const globalPolicyCopy = JSON.parse(JSON.stringify(globalPolicy));
      
      resolveAgentRetryPolicy({ globalPolicy, agentRetry });
      
      expect(globalPolicy).toEqual(globalPolicyCopy);
      expect(agentRetry.maxAttempts).toBe(2);
    });

    it("returns semantically identical policy shape regardless of key ordering in agent inputs", () => {
      const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { maxAttempts: 5 } });
      const agentRetry1 = {
        maxAttempts: 2,
        jitter: false
      };
      const agentRetry2 = {
        jitter: false,
        maxAttempts: 2
      };

      const res1 = resolveAgentRetryPolicy({ globalPolicy, agentRetry: agentRetry1 });
      const res2 = resolveAgentRetryPolicy({ globalPolicy, agentRetry: agentRetry2 });

      expect(JSON.stringify(res1.policy)).toBe(JSON.stringify(res2.policy));
    });

    describe("disableDelay regression safety", () => {
      it("preserves globalPolicy disableDelay when agentRetry is omitted", () => {
        const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { disableDelay: true } });
        const resolved = resolveAgentRetryPolicy({ globalPolicy });
        expect(resolved.policy.disableDelay).toBe(true);
      });

      it("defaults disableDelay to false when agentRetry is false", () => {
        const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { disableDelay: true } });
        const resolved = resolveAgentRetryPolicy({ globalPolicy, agentRetry: false });
        expect(resolved.policy.disableDelay).toBe(false);
      });

      it("applies agent-level overrides for disableDelay: true", () => {
        const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { disableDelay: false } });
        const resolved = resolveAgentRetryPolicy({
          globalPolicy,
          agentRetry: { disableDelay: true }
        });
        expect(resolved.policy.disableDelay).toBe(true);
      });

      it("applies agent-level overrides for disableDelay: false", () => {
        const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { disableDelay: true } });
        const resolved = resolveAgentRetryPolicy({
          globalPolicy,
          agentRetry: { disableDelay: false }
        });
        expect(resolved.policy.disableDelay).toBe(false);
      });

      it("does not mutate globalPolicy or agentRetry when disableDelay is present", () => {
        const globalPolicy = resolveGlobalRetryPolicy({ configRetry: { disableDelay: true } });
        const agentRetry = { disableDelay: false };
        const globalPolicyCopy = JSON.parse(JSON.stringify(globalPolicy));

        resolveAgentRetryPolicy({ globalPolicy, agentRetry });

        expect(globalPolicy).toEqual(globalPolicyCopy);
        expect(agentRetry.disableDelay).toBe(false);
      });
    });

    it("evaluates explicit agent retry after a global CLI noRetry disable marker", () => {
      const globalPolicy = resolveGlobalRetryPolicy({
        configRetry: { maxAttempts: 5 },
        cliOverrides: { noRetry: true }
      });
      expect(globalPolicy.enabled).toBe(false);
      expect(globalPolicy.disabledBy).toBe("cli");

      const resolved = resolveAgentRetryPolicy({
        globalPolicy,
        agentRetry: { maxAttempts: 3 }
      });

      expect(resolved.enabled).toBe(true);
      expect(resolved.source).toBe("agent");
      expect(resolved.policy.maxAttempts).toBe(3);
    });

    it("evaluates explicit agent retry when global config retry is omitted", () => {
      const globalPolicy = resolveGlobalRetryPolicy({});
      expect(globalPolicy.enabled).toBe(false);
      expect(globalPolicy.disabledBy).toBe("omitted");

      const resolved = resolveAgentRetryPolicy({
        globalPolicy,
        agentRetry: { maxAttempts: 4 }
      });

      expect(resolved.enabled).toBe(true);
      expect(resolved.source).toBe("agent");
      expect(resolved.policy.maxAttempts).toBe(4);
    });
  });
});
