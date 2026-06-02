import { describe, expect, it } from "vitest";
import { runItemStreaming } from "../../../src/pipeline/item-streaming.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { PipelineStage, NormalizedPipelineOptions } from "../../../src/pipeline/types.js";

describe("runItemStreaming", () => {
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
    strategy: "item-streaming",
    preserveOrder: true,
    failFast: false,
    stageConcurrency: {}
  };

  it("succeeds when all stages succeed", async () => {
    const items = ["a", "b"];
    const stages: PipelineStage<string, string>[] = [
      {
        name: "stage1",
        run: (item) => `${item}-1`
      },
      {
        name: "stage2",
        run: (item) => `${item}-2`
      }
    ];

    const results = await runItemStreaming(
      items,
      stages,
      options,
      "pipeline-1",
      dummyState,
      new AbortController().signal
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe("succeeded");
    expect(results[0]?.value).toBe("a-1-2");
    expect(results[1]?.status).toBe("succeeded");
    expect(results[1]?.value).toBe("b-1-2");
  });

  it("skips subsequent stages on failure", async () => {
    const items = ["a"];
    const stages: PipelineStage<string, string>[] = [
      {
        name: "stage1",
        run: () => {
          throw new Error("stage1 fail");
        }
      },
      {
        name: "stage2",
        run: (item) => `${item}-2`
      }
    ];

    const results = await runItemStreaming(
      items,
      stages,
      options,
      "pipeline-1",
      dummyState,
      new AbortController().signal
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.stages).toHaveLength(2);
    expect(results[0]?.stages[0]?.status).toBe("failed");
    expect(results[0]?.stages[1]?.status).toBe("skipped");
  });

  it("cancels other items when failFast is true", async () => {
    const items = ["a", "b"];
    const stages: PipelineStage<string, string>[] = [
      {
        name: "stage1",
        run: async (item) => {
          if (item === "a") {
            throw new Error("stage1 fail for a");
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
          return `${item}-1`;
        }
      }
    ];

    const results = await runItemStreaming(
      items,
      stages,
      { ...options, failFast: true },
      "pipeline-1",
      dummyState,
      new AbortController().signal
    );

    const aRes = results.find((r) => r.itemIndex === 0);
    const bRes = results.find((r) => r.itemIndex === 1);

    expect(aRes?.status).toBe("failed");
    expect(bRes?.status).toBe("cancelled");
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
      strategy: "item-streaming",
      preserveOrder: true,
      failFast: false,
      concurrency: 5, // Pipeline options concurrency
      stageConcurrency: {
        stage1: 3 // Option override
      }
    };

    const results = await runItemStreaming(
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
