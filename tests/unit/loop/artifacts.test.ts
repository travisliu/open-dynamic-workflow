import { describe, expect, it, vi } from "vitest";
import {
  writeLoopDefinition,
  writeLoopInitialState,
  writeLoopFinalState,
  writeLoopExecutionRecord,
  writeLoopError,
  writeLoopReplayArtifact,
  writeRoundArtifacts
} from "../../../src/loop/artifacts.js";

describe("Loop Artifact Writers", () => {
  const mockStore = {
    writeJson: vi.fn().mockResolvedValue("path/to/artifact"),
    writeText: vi.fn(),
    appendText: vi.fn(),
    appendJsonl: vi.fn(),
    writeFinalReport: vi.fn(),
    updateManifest: vi.fn(),
    isRunCreated: vi.fn(),
    getRunArtifacts: vi.fn(),
    createRun: vi.fn(),
  };

  it("writes loop definition to correct path", async () => {
    await writeLoopDefinition(mockStore as any, "loop-1", { options: {} });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/loop.json", { options: {} });
  });

  it("writes loop initial state, final state, result, error, and replay", async () => {
    await writeLoopInitialState(mockStore as any, "loop-1", { state: 1 });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/initial-state.json", { state: 1 });

    await writeLoopFinalState(mockStore as any, "loop-1", { state: 2 });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/final-state.json", { state: 2 });

    await writeLoopExecutionRecord(mockStore as any, "loop-1", { loopId: "loop-1" } as any);
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/result.json", { loopId: "loop-1" });

    await writeLoopError(mockStore as any, "loop-1", { message: "error" });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/error.json", { message: "error" });

    await writeLoopReplayArtifact(mockStore as any, "loop-1", { kind: "loop" } as any);
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-1/replay.json", { kind: "loop" });
  });

  it("writes round artifacts to padded round directory", async () => {
    vi.clearAllMocks();
    await writeRoundArtifacts(mockStore as any, "loop-2", 5, {
      inputState: { count: 0 },
      runResult: { done: false, nextState: { count: 1 } },
      nextState: { count: 1 },
      error: undefined,
      nestedCalls: {
        agents: ["agent-1"],
        workflows: []
      }
    });

    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/input-state.json", { count: 0 });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/run-result.json", { done: false, nextState: { count: 1 } });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/next-state.json", { count: 1 });
    expect(mockStore.writeJson).toHaveBeenCalledWith("loops/loop-2/rounds/0005/nested-calls.json", {
      agents: ["agent-1"],
      workflows: []
    });
  });

  it("skips optional round artifacts", async () => {
    vi.clearAllMocks();
    await writeRoundArtifacts(mockStore as any, "loop-3", 1, {
      inputState: { count: 0 }
    });
    
    const paths = mockStore.writeJson.mock.calls.map(call => call[0]);
    expect(paths).toContain("loops/loop-3/rounds/0001/input-state.json");
    expect(paths).not.toContain("loops/loop-3/rounds/0001/run-result.json");
    expect(paths).not.toContain("loops/loop-3/rounds/0001/next-state.json");
    expect(paths).not.toContain("loops/loop-3/rounds/0001/error.json");
    expect(paths).not.toContain("loops/loop-3/rounds/0001/nested-calls.json");
  });
});
