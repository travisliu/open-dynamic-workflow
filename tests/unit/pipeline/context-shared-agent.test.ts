import { describe, expect, it, vi } from "vitest";
import { runStage } from "../../../src/pipeline/stage-runner.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import type { PipelineStage, NormalizedPipelineOptions } from "../../../src/pipeline/types.js";
import { SharedAgentRegistry } from "../../../src/shared-agents/registry.js";
import { defineAgent } from "../../../src/shared-agents/define-agent.js";

describe("PipelineStageContext.agent", () => {
  const registry = new SharedAgentRegistry();
  const definition = defineAgent({
    id: "test-agent",
    description: "test",
    inputSchema: {
      type: "object",
      properties: {
        foo: { type: "string" }
      }
    },
    agentPrompt: "Test: {{foo}}",
    run: async (context, runtime) => {
      return await runtime.agent({ prompt: runtime.renderAgentPrompt(context) });
    }
  });

  registry.register({
    id: "test-agent",
    sourcePath: "test.agent.js",
    definition,
    validatedAt: new Date().toISOString()
  });

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
      cwd: "/root/projects/openflow",
      outDir: "/root/projects/openflow/.openflow/runs/run-123",
      defaultProvider: "mock",
      timeoutMs: 30000,
      concurrency: 1,
      failFast: false
    },
    args: {},
    cwd: "/root/projects/openflow",
    artifactsDir: "/root/projects/openflow/.openflow/runs/run-123",
    agentResults: [],
    scheduler: {
      schedule: vi.fn().mockImplementation((task) => {
        return Promise.resolve({
          ok: true,
          status: "succeeded",
          id: task.id,
          provider: "mock",
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 5,
          metadata: task.metadata,
          artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
        });
      }),
      drain: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({})
    } as any,
    agentExecutor: {
      execute: vi.fn()
    } as any,
    eventSink: { emit: vi.fn() } as any,
    artifactStore: {
      writeJson: vi.fn(async () => "/mock-root/stage-result.json")
    } as any,
    sharedAgentRegistry: registry,
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

  it("delegates agent call correctly with pipeline metadata", async () => {
    // Arrange
    const stage: PipelineStage<string, any> = {
      name: "agentStage",
      run: async (item, ctx) => {
        return await ctx.agent({ definition: "test-agent", foo: item });
      }
    };

    // Act
    const result = await runStage({
      stage,
      stageIndex: 0,
      item: "bar",
      itemIndex: 0,
      pipelineId: "pipe-1",
      options,
      runtime: dummyState,
      parentSignal: new AbortController().signal
    });

    // Assert
    if (result.status !== "succeeded") {
      console.error("Stage failed with error:", result.error);
    }
    expect(result.status).toBe("succeeded");
    expect(dummyState.scheduler.schedule).toHaveBeenCalled();
    
    const task = (dummyState.scheduler.schedule as any).mock.calls[0][0];
    expect(task.metadata).toMatchObject({
      sharedAgentId: "test-agent",
      sharedAgentSource: "registry",
      pipelineId: "pipe-1",
      itemIndex: 0,
      stageIndex: 0,
      stageName: "agentStage"
    });

    expect(result.childAgentIds).toContain(task.id);
  });
});

