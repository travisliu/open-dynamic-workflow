import { describe, expect, it } from "vitest";
import { runStageBarrier } from "../../../src/pipeline/stage-barrier.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { PipelineStage, NormalizedPipelineOptions } from "../../../src/pipeline/types.js";

describe("runStageBarrier", () => {
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
      cwd: "/root/projects/execflow",
      outDir: "/root/projects/execflow/.execflow/runs/run-123",
      defaultProvider: "mock",
      timeoutMs: 30000,
      concurrency: 1,
      failFast: false
    },
    args: {},
    cwd: "/root/projects/execflow",
    artifactsDir: "/root/projects/execflow/.execflow/runs/run-123",
    agentResults: [],
    scheduler: {} as any,
    agentExecutor: {} as any,
    eventSink: { emit: () => {} } as any,
    abortController: new AbortController(),
    agentCounter: 0,
    startedAt: new Date().toISOString()
  };

  const options: NormalizedPipelineOptions = {
    strategy: "stage-barrier",
    preserveOrder: true,
    failFast: false,
    stageConcurrency: {}
  };

  it("completes stages in barrier order", async () => {
    const items = ["a", "b"];
    const stage1Order: string[] = [];
    const stage2Order: string[] = [];

    const stages: PipelineStage<string, string>[] = [
      {
        name: "stage1",
        run: async (item) => {
          stage1Order.push(item);
          if (item === "a") {
            // A takes longer
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          return `${item}-1`;
        }
      },
      {
        name: "stage2",
        run: (item) => {
          stage2Order.push(item);
          return `${item}-2`;
        }
      }
    ];

    const results = await runStageBarrier(
      items,
      stages,
      options,
      "pipeline-1",
      dummyState,
      new AbortController().signal
    );

    // Verify stage 2 only started after stage 1 finished for both a and b
    expect(stage1Order).toContain("a");
    expect(stage1Order).toContain("b");
    expect(stage2Order).toHaveLength(2);
    expect(results[0]?.value).toBe("a-1-2");
    expect(results[1]?.value).toBe("b-1-2");
  });

  it("drops failed items from proceeding to next stage", async () => {
    const items = ["a", "b"];
    const stage2Executed: string[] = [];

    const stages: PipelineStage<string, string>[] = [
      {
        name: "stage1",
        run: (item) => {
          if (item === "a") {
            throw new Error("a failed");
          }
          return `${item}-1`;
        }
      },
      {
        name: "stage2",
        run: (item) => {
          stage2Executed.push(item);
          return `${item}-2`;
        }
      }
    ];

    const results = await runStageBarrier(
      items,
      stages,
      options,
      "pipeline-1",
      dummyState,
      new AbortController().signal
    );

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.itemIndex === 0)?.status).toBe("failed");
    expect(results.find((r) => r.itemIndex === 1)?.status).toBe("succeeded");
    expect(stage2Executed).toEqual(["b-1"]);
  });

  it("honors the strictest stage-local limit over options overrides", async () => {
    const items = ["a", "b", "c", "d"];
    let active = 0;
    let maxActive = 0;

    const stages: PipelineStage<string, string>[] = [
      {
        name: "stage1",
        concurrency: 2, // Strictest limit
        run: async (item) => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active--;
          return `${item}-1`;
        }
      }
    ];

    const pipelineOptions: NormalizedPipelineOptions = {
      strategy: "stage-barrier",
      preserveOrder: true,
      failFast: false,
      concurrency: 5, // Pipeline options concurrency
      stageConcurrency: {
        stage1: 3 // Option override
      }
    };

    const results = await runStageBarrier(
      items,
      stages,
      pipelineOptions,
      "pipeline-1",
      dummyState,
      new AbortController().signal
    );

    expect(results).toHaveLength(4);
    // It should have never exceeded 2 concurrent executions for stage1
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
