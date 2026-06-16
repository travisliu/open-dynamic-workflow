import { describe, expect, it } from "vitest";
import { ErrorCode } from "../../../src/errors/codes.js";
import { BudgetTracker, observedTokensFromUsage } from "../../../src/workflow/budget.js";

describe("workflow budget tracking", () => {
  it("uses provider totalTokens when present", () => {
    expect(observedTokensFromUsage({
      inputTokens: 100,
      cachedInputTokens: 90,
      outputTokens: 20,
      totalTokens: 25
    })).toBe(25);
  });

  it("falls back to input plus output without double-counting cached input", () => {
    expect(observedTokensFromUsage({
      inputTokens: 100,
      cachedInputTokens: 90,
      outputTokens: 20
    })).toBe(120);
  });

  it("rejects a live agent start when maxAgentCalls is already reached", () => {
    const tracker = new BudgetTracker({
      limits: { maxAgentCalls: 1 },
      startedAtMs: 0
    });

    tracker.beforeAgentSchedule("a", 0);
    expect(() => tracker.beforeAgentSchedule("b", 0)).toThrowError(/maxAgentCalls 1/);
    expect(tracker.summary()).toEqual({
      limits: { maxAgentCalls: 1 },
      agentCalls: 1,
      observedTokens: 0,
      exceeded: true,
      exceededBy: "maxAgentCalls",
      message: "Budget exceeded before scheduling agent 'b': maxAgentCalls 1 has been reached."
    });
  });

  it("marks observed-token overages after live agent results", () => {
    const tracker = new BudgetTracker({
      limits: { maxObservedTokens: 10 },
      startedAtMs: 0
    });
    tracker.beforeAgentSchedule("a", 0);

    expect(() => tracker.afterAgentResult({
      ok: true,
      status: "succeeded",
      id: "a",
      provider: "mock",
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" },
      usage: { inputTokens: 8, cachedInputTokens: 100, outputTokens: 5 }
    }, 0)).toThrowError(/observed tokens 13/);

    expect(tracker.summary()?.exceededBy).toBe("maxObservedTokens");
    expect(tracker.summary()?.observedTokens).toBe(13);
  });

  it("does not count cache hits as new observed token consumption", () => {
    const tracker = new BudgetTracker({
      limits: { maxObservedTokens: 1 },
      startedAtMs: 0
    });

    tracker.afterAgentResult({
      ok: true,
      status: "succeeded",
      id: "cached",
      provider: "mock",
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 0,
      artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: { mode: "default" },
      cache: { hit: true },
      usage: { totalTokens: 999 }
    }, 0);

    expect(tracker.summary()).toEqual({
      limits: { maxObservedTokens: 1 },
      agentCalls: 0,
      observedTokens: 0,
      exceeded: false
    });
  });

  it("uses BUDGET_EXCEEDED for maxRunMs", () => {
    const tracker = new BudgetTracker({
      limits: { maxRunMs: 10 },
      startedAtMs: 100
    });

    try {
      tracker.beforeAgentSchedule("late", 111);
      throw new Error("expected budget error");
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.BUDGET_EXCEEDED);
      expect(err.message).toContain("maxRunMs");
    }
  });
});
