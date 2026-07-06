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

  it("counts repeated attempts for the same logical agent separately", () => {
    const tracker = new RunLimitTracker({ maxAgentCalls: 3 });

    tracker.beforeAgentSchedule("a"); // First attempt
    tracker.beforeAgentSchedule("a"); // Second attempt (retry)
    tracker.beforeAgentSchedule("a"); // Third attempt (retry)

    expect(tracker.summary()).toEqual({
      limits: { maxAgentCalls: 3 },
      agentCalls: 3,
      exceeded: false
    });
  });

  it("throws RUN_LIMIT_EXCEEDED once the maximum is reached with repeated attempts for the same logical agent", () => {
    const tracker = new RunLimitTracker({ maxAgentCalls: 2 });

    tracker.beforeAgentSchedule("a"); // First attempt
    tracker.beforeAgentSchedule("a"); // Second attempt

    // Third attempt should overflow
    expect(() => tracker.beforeAgentSchedule("a")).toThrow(
      "Run limit exceeded before scheduling agent 'a': maxAgentCalls 2 has been reached."
    );

    // Any subsequent attempt should also throw and keep the original exceeded message
    expect(() => tracker.beforeAgentSchedule("a")).toThrow(
      "Run limit exceeded before scheduling agent 'a': maxAgentCalls 2 has been reached."
    );

    expect(tracker.summary()).toEqual({
      limits: { maxAgentCalls: 2 },
      agentCalls: 2, // Reports only started attempts (i.e. 2 successfully started attempts)
      exceeded: true,
      exceededBy: "maxAgentCalls",
      message: "Run limit exceeded before scheduling agent 'a': maxAgentCalls 2 has been reached."
    });
  });
});
