import { describe, expect, it, vi } from "vitest";
import { runStage } from "../../../src/pipeline/stage-runner.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { PipelineStage, NormalizedPipelineOptions } from "../../../src/pipeline/types.js";
import { createDsl } from "../../../src/workflow/dsl.js";

describe("runStage", () => {
  const dummyState: RuntimeState = {
    runId: "run-123",
    parsedWorkflow: {
      meta: { name: "test", description: "test desc" },
      body: "",
      sourcePath: "workflow.ts",
      sourceText: "",
      sourceHash: "abc"
    },
    config: {
      cwd: "/root/projects/open-dynamic-workflow",
      outDir: "/root/projects/open-dynamic-workflow/.open-dynamic-workflow/runs/run-123",
      defaultProvider: "mock",
      timeoutMs: 30000,
      concurrency: 1,
      failFast: false
    },
    args: {},
    cwd: "/root/projects/open-dynamic-workflow",
    artifactsDir: "/root/projects/open-dynamic-workflow/.open-dynamic-workflow/runs/run-123",
    agentResults: [],
    scheduler: {} as any,
    agentExecutor: {} as any,
    eventSink: { emit: vi.fn() } as any,
    artifactStore: {
      writeJson: vi.fn(async () => "/mock-root/stage-result.json")
    } as any,
    abortController: new AbortController(),
    agentCounter: 0,
    startedAt: new Date().toISOString()
  };

  const options: NormalizedPipelineOptions = {
    strategy: "item-streaming",
    preserveOrder: true,
    failFast: false,
    stageConcurrency: {}
  };

  it("successfully runs a simple stage and records artifacts/events", async () => {
    const stage: PipelineStage<string, string> = {
      name: "stage1",
      run: async (item) => `${item}-processed`
    };

    const result = await runStage({
      stage,
      stageIndex: 0,
      item: "hello",
      itemIndex: 0,
      pipelineId: "pipeline-1",
      options,
      runtime: dummyState,
      parentSignal: new AbortController().signal
    });

    expect(result.status).toBe("succeeded");
    expect(result.stageName).toBe("stage1");
    expect(result.value).toBe("hello-processed");
    expect(dummyState.eventSink.emit).toHaveBeenCalledWith("pipeline.stage.started", expect.any(Object));
    expect(dummyState.eventSink.emit).toHaveBeenCalledWith("pipeline.stage.completed", expect.any(Object));
  });

  it("handles stage execution failures cleanly", async () => {
    const stage: PipelineStage<string, string> = {
      name: "stage1",
      run: async () => {
        throw new Error("execution failure");
      }
    };

    const result = await runStage({
      stage,
      stageIndex: 0,
      item: "hello",
      itemIndex: 0,
      pipelineId: "pipeline-1",
      options,
      runtime: dummyState,
      parentSignal: new AbortController().signal
    });

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("execution failure");
    expect(dummyState.eventSink.emit).toHaveBeenCalledWith("pipeline.stage.failed", expect.any(Object));
  });

  it("exceeds timeoutMs and returns timed_out status (PFAIL-003)", async () => {
    const stage: PipelineStage<string, string> = {
      name: "timeoutStage",
      timeoutMs: 50,
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "too-late";
      }
    };

    const result = await runStage({
      stage,
      stageIndex: 0,
      item: "hello",
      itemIndex: 0,
      pipelineId: "pipeline-1",
      options,
      runtime: dummyState,
      parentSignal: new AbortController().signal
    });

    expect(result.status).toBe("timed_out");
    expect(result.error?.message).toBe("timeout");
    expect(dummyState.eventSink.emit).toHaveBeenCalledWith("pipeline.stage.failed", expect.any(Object));
  });

  it("handles parent signal cancellation cleanly", async () => {
    const controller = new AbortController();
    const stage: PipelineStage<string, string> = {
      name: "cancelStage",
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "cancelled";
      }
    };

    const runPromise = runStage({
      stage,
      stageIndex: 0,
      item: "hello",
      itemIndex: 0,
      pipelineId: "pipeline-1",
      options,
      runtime: dummyState,
      parentSignal: controller.signal
    });

    setTimeout(() => {
      controller.abort("parent-cancel");
    }, 50);

    const result = await runPromise;

    expect(result.status).toBe("cancelled");
    expect(result.error?.message).toBe("parent-cancel");
  });

  it("handles two sequential child-agent calls without explicit IDs and generates unique non-colliding IDs", async () => {
    const scheduledIds: string[] = [];
    const dummyScheduler = {
      schedule: vi.fn().mockImplementation((task) => {
        scheduledIds.push(task.id);
        return Promise.resolve({
          ok: true,
          status: "succeeded",
          id: task.id,
          provider: "mock",
          stdout: `response for ${task.id}`,
          stderr: "",
          exitCode: 0,
          durationMs: 5,
          artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
        });
      }),
      drain: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        aborted: false,
        abortReason: undefined,
        runningCount: 0,
        queuedCount: 0,
        completedCount: 1
      })
    };

    const localRuntime = {
      ...dummyState,
      scheduler: dummyScheduler as any
    };

    const stage: PipelineStage<string, string> = {
      name: "seqStage",
      run: async (item, ctx) => {
        const agent1 = await ctx.agent({ prompt: "prompt 1" });
        const agent2 = await ctx.agent({ prompt: "prompt 2" });
        return `${agent1.id} & ${agent2.id}`;
      }
    };

    const result = await runStage({
      stage,
      stageIndex: 0,
      item: "hello",
      itemIndex: 0,
      pipelineId: "pipeline-1",
      options,
      runtime: localRuntime,
      parentSignal: new AbortController().signal
    });

    expect(result.status).toBe("succeeded");
    expect(result.childAgentIds).toHaveLength(2);
    expect(result.childAgentIds[0]).toBe("pipeline-1-item-0-seqStage-1");
    expect(result.childAgentIds[1]).toBe("pipeline-1-item-0-seqStage-2");
    expect(scheduledIds).toEqual([
      "pipeline-1-item-0-seqStage-1",
      "pipeline-1-item-0-seqStage-2"
    ]);
  });

  it("handles two parallel child-agent calls without explicit IDs and generates unique non-colliding IDs", async () => {
    const scheduledIds: string[] = [];
    const dummyScheduler = {
      schedule: vi.fn().mockImplementation((task) => {
        scheduledIds.push(task.id);
        return Promise.resolve({
          ok: true,
          status: "succeeded",
          id: task.id,
          provider: "mock",
          stdout: `response for ${task.id}`,
          stderr: "",
          exitCode: 0,
          durationMs: 5,
          artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
        });
      }),
      drain: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        aborted: false,
        abortReason: undefined,
        runningCount: 0,
        queuedCount: 0,
        completedCount: 1
      })
    };

    const localRuntime = {
      ...dummyState,
      scheduler: dummyScheduler as any
    };

    const stage: PipelineStage<string, string> = {
      name: "parallelStage",
      run: async (item, ctx) => {
        const dsl = createDsl(localRuntime);
        const [agent1, agent2] = await dsl.parallel([
          () => ctx.agent({ prompt: "parallel prompt 1" }),
          () => ctx.agent({ prompt: "parallel prompt 2" })
        ]);
        return `${agent1.id} & ${agent2.id}`;
      }
    };

    const result = await runStage({
      stage,
      stageIndex: 0,
      item: "hello",
      itemIndex: 0,
      pipelineId: "pipeline-1",
      options,
      runtime: localRuntime,
      parentSignal: new AbortController().signal
    });

    expect(result.status).toBe("succeeded");
    expect(result.childAgentIds).toHaveLength(2);
    expect(result.childAgentIds).toContain("pipeline-1-item-0-parallelStage-1");
    expect(result.childAgentIds).toContain("pipeline-1-item-0-parallelStage-2");
    expect(scheduledIds).toHaveLength(2);
    expect(scheduledIds).toContain("pipeline-1-item-0-parallelStage-1");
    expect(scheduledIds).toContain("pipeline-1-item-0-parallelStage-2");
  });

  it("proves ctx.context is absent while all operational fields are present", async () => {
    let recordedKeys: string[] = [];
    let hasContextOwnProp = false;
    let contextValue: any = null;

    const stage: PipelineStage<string, string> = {
      name: "testCtxStage",
      run: async (item, ctx) => {
        recordedKeys = Object.keys(ctx);
        hasContextOwnProp = Object.prototype.hasOwnProperty.call(ctx, "context");
        contextValue = (ctx as any).context;
        return "done";
      }
    };

    const result = await runStage({
      stage,
      stageIndex: 0,
      item: "hello",
      itemIndex: 0,
      pipelineId: "pipeline-1",
      options,
      runtime: dummyState,
      parentSignal: new AbortController().signal
    });

    expect(result.status).toBe("succeeded");
    expect(hasContextOwnProp).toBe(false);
    expect(contextValue).toBeUndefined();

    const expectedOperationalKeys = [
      "agent",
      "agentId",
      "log",
      "signal",
      "sleep",
      "pipelineId",
      "runId",
      "artifactsDir",
      "itemIndex",
      "stageIndex",
      "stageName"
    ];
    for (const key of expectedOperationalKeys) {
      expect(recordedKeys).toContain(key);
    }
  });
});

