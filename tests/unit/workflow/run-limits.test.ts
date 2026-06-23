import { describe, expect, it } from "vitest";
import { ErrorCode } from "../../../src/errors/codes.js";
import { RunLimitTracker } from "../../../src/workflow/run-limits.js";

describe("RunLimitTracker", () => {
  it("counts live agent calls and reports the configured limit", () => {
    const tracker = new RunLimitTracker({ maxAgentCalls: 2 });

    tracker.beforeAgentSchedule("a");
    tracker.beforeAgentSchedule("b");

    expect(tracker.summary()).toEqual({
      limits: { maxAgentCalls: 2 },
      agentCalls: 2,
      exceeded: false
    });
  });

  it("throws RUN_LIMIT_EXCEEDED before scheduling beyond maxAgentCalls", () => {
    const tracker = new RunLimitTracker({ maxAgentCalls: 1 });

    tracker.beforeAgentSchedule("a");

    expect(() => tracker.beforeAgentSchedule("b")).toThrow("maxAgentCalls 1 has been reached");
    try {
      tracker.beforeAgentSchedule("b");
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.RUN_LIMIT_EXCEEDED);
    }
    expect(tracker.summary()).toMatchObject({
      limits: { maxAgentCalls: 1 },
      agentCalls: 1,
      exceeded: true,
      exceededBy: "maxAgentCalls"
    });
  });

  it("is disabled when no positive maxAgentCalls limit is configured", () => {
    const tracker = new RunLimitTracker({});

    tracker.beforeAgentSchedule("a");
    tracker.beforeAgentSchedule("b");

    expect(tracker.summary()).toBeUndefined();
  });
});
