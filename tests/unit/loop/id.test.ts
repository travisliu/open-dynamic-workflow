import { describe, expect, it } from "vitest";
import {
  createLoopId,
  createRoundId,
  createLoopAgentId,
  createLoopToolId
} from "../../../src/loop/id.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";

describe("Loop ID Helpers", () => {
  describe("createLoopId", () => {
    it("generates normalized loop ID for labels", () => {
      expect(createLoopId("Repair Loop")).toBe("repair-loop");
      expect(createLoopId("nested:loop-label")).toBe("nested:loop-label");
    });

    it("throws on invalid labels", () => {
      expect(() => createLoopId("")).toThrow(InvalidDslCallError);
      expect(() => createLoopId(null as any)).toThrow(InvalidDslCallError);
      expect(() => createLoopId(123 as any)).toThrow(InvalidDslCallError);
    });
  });

  describe("createRoundId", () => {
    it("generates correct round ID with padding", () => {
      expect(createRoundId("loop-1", 1)).toBe("loop-1-round-0001");
      expect(createRoundId("loop-5", 10)).toBe("loop-5-round-0010");
      expect(createRoundId("custom-loop", 9999)).toBe("custom-loop-round-9999");
    });

    it("throws on invalid inputs", () => {
      expect(() => createRoundId("", 1)).toThrow(InvalidDslCallError);
      expect(() => createRoundId(null as any, 1)).toThrow(InvalidDslCallError);
      expect(() => createRoundId("loop-1", 0)).toThrow(InvalidDslCallError);
      expect(() => createRoundId("loop-1", -1)).toThrow(InvalidDslCallError);
      expect(() => createRoundId("loop-1", NaN)).toThrow(InvalidDslCallError);
    });
  });

  describe("createLoopAgentId", () => {
    it("creates correct deterministic agent ID without suffix", () => {
      const id = createLoopAgentId({
        label: "bounded-repair-loop",
        roundNumber: 1
      });
      expect(id).toBe("bounded-repair-loop:round-1");
    });

    it("creates correct deterministic agent ID with suffix", () => {
      const id = createLoopAgentId({
        label: "Bounded Repair Loop",
        roundNumber: 5,
        suffix: "reviewer"
      });
      expect(id).toBe("bounded-repair-loop:round-5:reviewer");
    });

    it("accepts valid suffixes", () => {
      const validSuffixes = ["agent-1", "review.v1", "task_3", "step:final"];
      for (const suffix of validSuffixes) {
        expect(() => createLoopAgentId({
          label: "my-loop",
          roundNumber: 1,
          suffix
        })).not.toThrow();
      }
    });

    it("throws on invalid suffixes", () => {
      const invalidSuffixes = [
        " ",
        "agent/1",
        "agent\\1",
        "..",
        ".",
        "nested/path",
        "with space",
        "unsafe$char"
      ];
      for (const suffix of invalidSuffixes) {
        expect(() => createLoopAgentId({
          label: "my-loop",
          roundNumber: 1,
          suffix
        })).toThrow(InvalidDslCallError);
      }
    });
  });

  describe("createLoopToolId", () => {
    it("creates deterministic path-safe tool IDs", () => {
      expect(createLoopToolId({
        label: "bounded-repair-loop",
        roundNumber: 2,
        suffix: "quality-gate"
      })).toBe("bounded-repair-loop-round-2-tool-quality-gate");
    });

    it("does not collide for distinct normalized loop labels", () => {
      const labels = ["quality.gate", "quality:gate", "quality-gate", "quality_2e_gate"];
      const ids = labels.map(label => createLoopToolId({
        label,
        roundNumber: 1,
        suffix: "check"
      }));

      expect(new Set(ids).size).toBe(labels.length);
    });
  });
});
