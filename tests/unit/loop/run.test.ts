import { describe, expect, it, vi, beforeEach } from "vitest";
import { runLoop } from "../../../src/loop/run.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { withActiveWorkflowInvocation } from "../../../src/workflow/invocation-types.js";

describe("Loop Runner", () => {
  let mockRuntime: any;
  let mockEventSink: any;
  let mockArtifactStore: any;
  let mockDsl: any;

  beforeEach(() => {
    mockEventSink = { emit: vi.fn() };
    mockArtifactStore = {
      writeJson: vi.fn().mockResolvedValue("path"),
      appendJsonl: vi.fn().mockResolvedValue("path"),
      getRunArtifacts: vi.fn().mockReturnValue({ rootDir: "/tmp" }),
      isRunCreated: vi.fn().mockReturnValue(true),
    };
    mockDsl = {
      agent: vi.fn(),
      workflow: vi.fn(),
      log: vi.fn(),
    };
    mockRuntime = {
      runId: "run-1",
      artifactsDir: "/tmp",
      eventSink: mockEventSink,
      artifactStore: mockArtifactStore,
      config: { workflow: { maxLoopRounds: 20 } },
      loopCounter: 0,
      loopSummaries: [],
      callSequence: 0,
      callCache: { readEnabled: false, writeIndex: false, currentEntries: [] },
    };
  });

  it("executes serial rounds until done in throw mode", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ done: false, nextState: { count: 1 } })
      .mockResolvedValueOnce({ done: true, nextState: { count: 2 } });

    const result = await runLoop({
      loopInput: {
        label: "test-loop",
        initialState: { count: 0 },
        options: { maxRounds: 5, failureMode: "throw" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result).toEqual({ count: 2 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(mockRuntime.loopSummaries[0].status).toBe("succeeded");
    expect(mockRuntime.loopSummaries[0].roundsCompleted).toBe(2);
  });

  it("executes serial rounds until done in settled mode", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ done: false, nextState: { count: 1 } })
      .mockResolvedValueOnce({ done: true, nextState: { count: 2 } });

    const result = await runLoop({
      loopInput: {
        label: "test-loop",
        initialState: { count: 0 },
        options: { maxRounds: 5, failureMode: "settled" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result).toEqual({
      ok: true,
      status: "succeeded",
      label: "test-loop",
      loopId: "test-loop",
      roundsCompleted: 2,
      finalState: { count: 2 },
      artifacts: {
        dir: "loops/test-loop"
      }
    });
  });

  it("throws loop exhaustion error at maxRounds in throw mode", async () => {
    const run = vi.fn().mockResolvedValue({ done: false, nextState: { count: 1 } });

    await expect(runLoop({
      loopInput: {
        label: "test-loop",
        initialState: { count: 0 },
        options: { maxRounds: 2, failureMode: "throw" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    })).rejects.toThrow("test-loop");

    expect(mockRuntime.loopSummaries[0].status).toBe("max_rounds");
  });

  it("returns failure envelope at maxRounds in settled mode", async () => {
    const run = vi.fn().mockResolvedValue({ done: false, nextState: { count: 1 } });

    const result = await runLoop({
      loopInput: {
        label: "test-loop",
        initialState: { count: 0 },
        options: { maxRounds: 2, failureMode: "settled" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result).toEqual({
      ok: false,
      status: "max_rounds",
      label: "test-loop",
      loopId: "test-loop",
      roundsCompleted: 2,
      finalState: { count: 1 },
      error: expect.any(Object),
      artifacts: {
        dir: "loops/test-loop"
      }
    });
  });

  it("honors loop-level timeout in throw mode", async () => {
    const run = () => new Promise(resolve => setTimeout(resolve, 100));

    await expect(runLoop({
      loopInput: {
        label: "test-loop",
        initialState: {},
        options: { maxRounds: 5, timeoutMs: 10, failureMode: "throw" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    })).rejects.toThrow("timed out");

    expect(mockRuntime.loopSummaries[0].status).toBe("timed_out");
  });

  it("honors loop-level timeout in settled mode", async () => {
    const run = () => new Promise(resolve => setTimeout(resolve, 100));

    const result = await runLoop({
      loopInput: {
        label: "test-loop",
        initialState: {},
        options: { maxRounds: 5, timeoutMs: 10, failureMode: "settled" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result).toEqual({
      ok: false,
      status: "timed_out",
      label: "test-loop",
      loopId: "test-loop",
      roundsCompleted: 1,
      finalState: {},
      error: expect.any(Object),
      artifacts: {
        dir: "loops/test-loop"
      }
    });
  });

  it("propagates active workflow invocation ID to loop events", async () => {
    const run = vi.fn().mockResolvedValue({ done: true, nextState: {} });
    const mockInvocation = {
      workflowInvocationId: "invocation-123",
      workflowName: "test-flow",
      depth: 0,
      startedAt: "2026-06-17T10:00:00Z",
    } as any;

    await withActiveWorkflowInvocation(mockInvocation, async () => {
      await runLoop({
        loopInput: {
          label: "test-loop",
          initialState: {},
          options: { maxRounds: 5 },
          run
        },
        runtime: mockRuntime,
        signal: new AbortController().signal,
        dsl: mockDsl,
      });
    });

    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.started", expect.objectContaining({
      workflowInvocationId: "invocation-123"
    }));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.round.started", expect.objectContaining({
      workflowInvocationId: "invocation-123"
    }));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.round.completed", expect.objectContaining({
      workflowInvocationId: "invocation-123"
    }));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.completed", expect.objectContaining({
      workflowInvocationId: "invocation-123"
    }));
  });

  it("handles non-JSON-safe initialState in throw mode", async () => {
    const run = vi.fn();
    const badState = { fn: () => {} };

    await expect(runLoop({
      loopInput: {
        label: "bad-state-loop",
        initialState: badState,
        options: { maxRounds: 5, failureMode: "throw" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    })).rejects.toThrow("initialState is not JSON-safe");

    expect(run).not.toHaveBeenCalled();
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/bad-state-loop/loop.json", expect.any(Object));
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/bad-state-loop/error.json", expect.any(Object));
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/bad-state-loop/result.json", expect.objectContaining({
      status: "failed",
      roundsCompleted: 0,
      initialState: undefined,
    }));
    expect(mockRuntime.loopSummaries[0].status).toBe("failed");
    expect(mockRuntime.loopSummaries[0].roundsCompleted).toBe(0);
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.started", expect.any(Object));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.failed", expect.any(Object));
  });

  it("handles cyclic initialState in settled mode", async () => {
    const run = vi.fn();
    const cyclicState: any = {};
    cyclicState.self = cyclicState;

    await expect(runLoop({
      loopInput: {
        label: "cyclic-state-loop",
        initialState: cyclicState,
        options: { maxRounds: 5, failureMode: "settled" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    })).rejects.toThrow("initialState is not JSON-safe");

    expect(run).not.toHaveBeenCalled();
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/cyclic-state-loop/loop.json", expect.any(Object));
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/cyclic-state-loop/error.json", expect.any(Object));
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/cyclic-state-loop/result.json", expect.objectContaining({
      status: "failed",
      roundsCompleted: 0,
      initialState: undefined,
    }));
    expect(mockRuntime.loopSummaries[0].status).toBe("failed");
    expect(mockRuntime.loopSummaries[0].roundsCompleted).toBe(0);
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.started", expect.any(Object));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.failed", expect.any(Object));
  });

  it("prevents state mutation from affecting artifacts/records in success case", async () => {
    const run = vi.fn().mockImplementation(async (state: any) => {
      state.count = 999;
      return { done: true, nextState: { count: 1 } };
    });

    const result = await runLoop({
      loopInput: {
        label: "mutate-loop",
        initialState: { count: 0 },
        options: { maxRounds: 5, failureMode: "throw" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result).toEqual({ count: 1 });
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith(
      "loops/mutate-loop/rounds/0001/input-state.json",
      { count: 0 }
    );
    expect(mockRuntime.loopSummaries[0].status).toBe("succeeded");
  });

  it("prevents state mutation from affecting records in failure case", async () => {
    const run = vi.fn().mockImplementation(async (state: any) => {
      state.count = 999;
      throw new Error("failed round");
    });

    await expect(runLoop({
      loopInput: {
        label: "mutate-fail-loop",
        initialState: { count: 0 },
        options: { maxRounds: 5, failureMode: "throw" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    })).rejects.toThrow("failed round");

    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith(
      "loops/mutate-fail-loop/rounds/0001/input-state.json",
      { count: 0 }
    );
  });

  it("ensures each round in multi-round receives non-mutated state", async () => {
    const run = vi.fn()
      .mockImplementationOnce(async (state: any) => {
        state.count = 999;
        return { done: false, nextState: { count: 1 } };
      })
      .mockImplementationOnce(async (state: any) => {
        return { done: true, nextState: { count: state.count + 1 } };
      });

    const result = await runLoop({
      loopInput: {
        label: "multi-mutate-loop",
        initialState: { count: 0 },
        options: { maxRounds: 5, failureMode: "throw" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result).toEqual({ count: 2 });
    expect(run).toHaveBeenNthCalledWith(2, { count: 1 }, expect.any(Object));
  });

  it("rejects unsupported properties in run result in throw mode and writes error artifacts", async () => {
    const run = vi.fn().mockResolvedValue({ done: true, nextState: {}, debug: "x" });

    await expect(runLoop({
      loopInput: {
        label: "unsupported-key-loop",
        initialState: {},
        options: { maxRounds: 5, failureMode: "throw" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    })).rejects.toThrow("contains unsupported property 'debug'");

    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/unsupported-key-loop/rounds/0001/error.json", expect.any(Object));
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/unsupported-key-loop/error.json", expect.any(Object));
    expect(mockArtifactStore.writeJson).toHaveBeenCalledWith("loops/unsupported-key-loop/result.json", expect.objectContaining({
      status: "failed",
      roundsCompleted: 1,
    }));
    expect(mockRuntime.loopSummaries[0].status).toBe("failed");
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.round.failed", expect.any(Object));
    expect(mockEventSink.emit).toHaveBeenCalledWith("loop.failed", expect.any(Object));
  });

  it("rejects unsupported properties in run result in settled mode and returns settled failure envelope", async () => {
    const run = vi.fn().mockResolvedValue({ done: true, nextState: {}, debug: () => {} });

    const result = await runLoop({
      loopInput: {
        label: "unsupported-key-settled-loop",
        initialState: {},
        options: { maxRounds: 5, failureMode: "settled" },
        run
      },
      runtime: mockRuntime,
      signal: new AbortController().signal,
      dsl: mockDsl,
    });

    expect(result).toEqual({
      ok: false,
      status: "failed",
      label: "unsupported-key-settled-loop",
      loopId: "unsupported-key-settled-loop",
      roundsCompleted: 1,
      finalState: {},
      error: expect.any(Object),
      artifacts: {
        dir: "loops/unsupported-key-settled-loop"
      }
    });
  });
});
