import { describe, expect, it } from "vitest";
import {
  getIsoTimestamp,
  getDurationMs,
  createLoopRoundRecord,
  createLoopExecutionRecord,
  createSettledSuccessEnvelope,
  createSettledFailureEnvelope,
  createLoopExhaustionError,
  createInvalidRunResultError
} from "../../../src/loop/results.js";

describe("Loop Result Helpers", () => {
  describe("getIsoTimestamp", () => {
    it("returns valid ISO timestamp", () => {
      const stamp = getIsoTimestamp();
      expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
    });
  });

  describe("getDurationMs", () => {
    it("calculates duration between timestamps", () => {
      const start = "2026-06-19T10:00:00.000Z";
      const end = "2026-06-19T10:00:05.123Z";
      expect(getDurationMs(start, end)).toBe(5123);
      expect(getDurationMs(end, start)).toBe(0); // clamp to 0
    });
  });

  describe("createLoopRoundRecord", () => {
    it("creates loop round record structure", () => {
      const record = createLoopRoundRecord({
        index: 0,
        roundNumber: 1,
        status: "completed",
        inputState: { val: 1 },
        nextState: { val: 2 },
        durationMs: 150,
        nestedCalls: {
          agents: ["agent-1"],
          workflows: [],
          tools: ["tool-1"]
        }
      });

      expect(record).toEqual({
        index: 0,
        roundNumber: 1,
        status: "completed",
        inputState: { val: 1 },
        nextState: { val: 2 },
        durationMs: 150,
        nestedCalls: {
          agents: ["agent-1"],
          workflows: [],
          tools: ["tool-1"]
        }
      });
    });
  });

  describe("createLoopExecutionRecord", () => {
    it("creates loop execution record structure", () => {
      const record = createLoopExecutionRecord({
        loopId: "loop-1",
        label: "test-loop",
        status: "succeeded",
        roundsCompleted: 1,
        maxRounds: 5,
        initialState: { val: 0 },
        finalState: { val: 1 },
        rounds: [
          createLoopRoundRecord({
            index: 0,
            roundNumber: 1,
            status: "completed",
            inputState: { val: 0 },
            nextState: { val: 1 },
            durationMs: 100,
            nestedCalls: {
              agents: [],
              workflows: [],
              tools: []
            }
          })
        ],
        startedAt: "2026-06-19T10:00:00.000Z",
        finishedAt: "2026-06-19T10:00:01.000Z",
        durationMs: 1000,
        artifactPath: "loops/loop-1"
      });

      expect(record.schemaVersion).toBe("open-dynamic-workflow.loop-result.v2");
      expect(record.loopId).toBe("loop-1");
      expect(record.label).toBe("test-loop");
      expect(record.status).toBe("succeeded");
      expect(record.roundsCompleted).toBe(1);
      expect(record.maxRounds).toBe(5);
      expect(record.initialState).toEqual({ val: 0 });
      expect(record.finalState).toEqual({ val: 1 });
      expect(record.rounds).toHaveLength(1);
    });
  });

  describe("createSettledSuccessEnvelope", () => {
    it("creates success envelope structure", () => {
      const env = createSettledSuccessEnvelope({
        label: "test-loop",
        loopId: "loop-1",
        roundsCompleted: 2,
        finalState: { done: true },
        artifactsDir: "loops/loop-1"
      });

      expect(env).toEqual({
        ok: true,
        status: "succeeded",
        label: "test-loop",
        loopId: "loop-1",
        roundsCompleted: 2,
        finalState: { done: true },
        artifacts: {
          dir: "loops/loop-1"
        }
      });
    });
  });

  describe("createSettledFailureEnvelope", () => {
    it("creates failure envelope structure", () => {
      const env = createSettledFailureEnvelope({
        status: "max_rounds",
        label: "test-loop",
        loopId: "loop-1",
        roundsCompleted: 3,
        finalState: { count: 3 },
        error: { message: "exhausted" },
        artifactsDir: "loops/loop-1"
      });

      expect(env).toEqual({
        ok: false,
        status: "max_rounds",
        label: "test-loop",
        loopId: "loop-1",
        roundsCompleted: 3,
        finalState: { count: 3 },
        error: { message: "exhausted" },
        artifacts: {
          dir: "loops/loop-1"
        }
      });
    });
  });

  describe("errors", () => {
    it("creates expected error classes", () => {
      const exh = createLoopExhaustionError("test", 5);
      expect(exh.message).toContain("Loop 'test' exhausted maxRounds of 5.");

      const inv = createInvalidRunResultError("test", "missing done");
      expect(inv.message).toContain("Loop 'test' round returned invalid run result: missing done");
    });
  });
});
