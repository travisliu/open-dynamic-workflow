import { describe, expect, it, vi } from "vitest";
import {
  stableHashJson,
  buildLoopStartReplayMarker,
  buildLoopRoundReplayMarker,
  recordLoopCacheMarker
} from "../../../src/loop/replay.js";

describe("Loop Replay and Cache Helpers", () => {
  describe("stableHashJson", () => {
    it("produces identical hashes for same data with different key order", () => {
      const h1 = stableHashJson({ a: 1, b: 2 });
      const h2 = stableHashJson({ b: 2, a: 1 });
      expect(h1).toBe(h2);
    });

    it("produces different hashes for different data", () => {
      const h1 = stableHashJson({ a: 1 });
      const h2 = stableHashJson({ a: 2 });
      expect(h1).not.toBe(h2);
    });
  });

  describe("buildLoopStartReplayMarker", () => {
    it("returns a deterministic hash and changes when inputs change", () => {
      const baseArgs = {
        loopId: "loop-1",
        label: "loop-label",
        optionsFingerprint: "opts-hash",
        initialStateHash: "state-hash",
        maxRounds: 5,
        maxRoundsCeiling: 20
      };
      const marker1 = buildLoopStartReplayMarker(baseArgs);
      expect(typeof marker1).toBe("string");
      expect(marker1.length).toBe(64); // sha256 hex

      const marker2 = buildLoopStartReplayMarker({ ...baseArgs, initialStateHash: "state-hash-2" });
      expect(marker1).not.toBe(marker2);

      const marker3 = buildLoopStartReplayMarker({ ...baseArgs, optionsFingerprint: "opts-hash-2" });
      expect(marker1).not.toBe(marker3);

      const marker4 = buildLoopStartReplayMarker({ ...baseArgs, maxRoundsCeiling: 100 });
      expect(marker1).not.toBe(marker4);
    });
  });

  describe("buildLoopRoundReplayMarker", () => {
    it("returns a deterministic hash and changes when inputs change", () => {
      const baseArgs = {
        loopId: "loop-1",
        label: "loop-label",
        roundIndex: 0,
        roundNumber: 1,
        nestedCallSequence: ["call-1"],
        stateBeforeHash: "state-before-hash"
      };
      const marker1 = buildLoopRoundReplayMarker(baseArgs);
      expect(typeof marker1).toBe("string");
      expect(marker1.length).toBe(64);

      const marker2 = buildLoopRoundReplayMarker({ ...baseArgs, stateBeforeHash: "state-before-hash-2" });
      expect(marker1).not.toBe(marker2);

      const marker3 = buildLoopRoundReplayMarker({ ...baseArgs, stateAfterHash: "state-after-hash" });
      expect(marker1).not.toBe(marker3);

      const marker4 = buildLoopRoundReplayMarker({ ...baseArgs, status: "failed" });
      expect(marker1).not.toBe(marker4);
    });

    it("changes when nested call order changes", () => {
      const baseArgs = {
        loopId: "loop-1",
        label: "loop-label",
        roundIndex: 0,
        roundNumber: 1,
        stateBeforeHash: "state-before-hash"
      };

      const toolThenAgent = buildLoopRoundReplayMarker({
        ...baseArgs,
        nestedCallSequence: ["tool-a", "agent-b"]
      });
      const agentThenTool = buildLoopRoundReplayMarker({
        ...baseArgs,
        nestedCallSequence: ["agent-b", "tool-a"]
      });

      expect(toolThenAgent).not.toBe(agentThenTool);
    });

    it("normalizes generated child workflow invocation IDs", () => {
      const baseArgs = {
        loopId: "loop-1",
        label: "loop-label",
        roundIndex: 0,
        roundNumber: 1,
        stateBeforeHash: "state-before-hash"
      };

      const firstRun = buildLoopRoundReplayMarker({
        ...baseArgs,
        nestedCallSequence: [
          "loop-1:loop-label:round-1:generated-id-a"
        ]
      });
      const secondRun = buildLoopRoundReplayMarker({
        ...baseArgs,
        nestedCallSequence: [
          "loop-1:loop-label:round-1:generated-id-b"
        ]
      });

      expect(firstRun).toBe(secondRun);
    });

    it("is identical to the legacy fingerprint behavior for agent/workflow-only rounds", () => {
      const baseArgs = {
        loopId: "loop-1",
        label: "loop-label",
        roundIndex: 0,
        roundNumber: 1,
        nestedCallSequence: ["agent-1", "loop-1:loop-label:round-1:generated-id-a"],
        stateBeforeHash: "state-before-hash"
      };

      const marker = buildLoopRoundReplayMarker(baseArgs);

      const expectedLegacyHash = stableHashJson({
        kind: "loop-round",
        loopId: "loop-1",
        label: "loop-label",
        roundIndex: 0,
        roundNumber: 1,
        nestedCallSequence: ["agent-1", "loop-1:loop-label:round-1:workflow-1"],
        stateBeforeHash: "state-before-hash"
      });

      expect(marker).toBe(expectedLegacyHash);
    });
  });


  describe("recordLoopCacheMarker", () => {
    const mockStore = {
      writeJson: vi.fn().mockResolvedValue("path"),
      appendJsonl: vi.fn().mockResolvedValue("path"),
      getRunArtifacts: vi.fn().mockReturnValue({ rootDir: "/tmp" }),
      isRunCreated: vi.fn().mockReturnValue(true),
    };

    it("detects cache hits", async () => {
      const cache = {
        readEnabled: true,
        prefixCacheUsable: true,
        previousEntries: new Map([[1, {
          kind: "loop",
          sequence: 1,
          callId: "loop-1",
          loopId: "loop-1",
          fingerprint: "match",
          status: "succeeded",
          resultPath: "loops/loop-1/loop.json"
        }]]),
        currentEntries: [],
        writeIndex: true
      };

      const hit = await recordLoopCacheMarker({
        store: mockStore as any,
        cache: cache as any,
        kind: "loop",
        sequence: 1,
        loopId: "loop-1",
        fingerprint: "match",
        resultPath: "loops/loop-1/loop.json"
      });

      expect(hit).toBeDefined();
      expect(hit?.loopId).toBe("loop-1");
      expect(cache.prefixCacheUsable).toBe(true);
    });

    it("detects cache misses and disables prefix cache", async () => {
      const cache = {
        readEnabled: true,
        prefixCacheUsable: true,
        previousEntries: new Map([[1, {
          kind: "loop",
          sequence: 1,
          callId: "loop-1",
          fingerprint: "old-hash",
          status: "succeeded",
          resultPath: "loops/loop-1/loop.json"
        }]]),
        currentEntries: [],
        writeIndex: true
      };

      const hit = await recordLoopCacheMarker({
        store: mockStore as any,
        cache: cache as any,
        kind: "loop",
        sequence: 1,
        loopId: "loop-1",
        fingerprint: "new-hash",
        resultPath: "loops/loop-1/loop.json"
      });

      expect(hit).toBeUndefined();
      expect(cache.prefixCacheUsable).toBe(false);
    });
  });
});
