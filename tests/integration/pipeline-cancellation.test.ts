import { describe, expect, it } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { DefaultRuntimeRunner } from "../../src/workflow/runtime.js";
import type { ParsedWorkflow } from "../../src/types/workflow.js";
import type { ResolvedConfig } from "../../src/types/config.js";
import type { RuntimeEventSink } from "../../src/orchestration/scheduler.js";

class FakeEventSink implements RuntimeEventSink {
  events: { type: string; payload: unknown }[] = [];
  emit(type: string, payload: unknown) {
    this.events.push({ type, payload });
  }
}

const defaultConfig: ResolvedConfig = {
  defaultProvider: "mock",
  concurrency: 2,
  timeoutMs: 30000,
  providers: {},
  security: { allowWorkflowImports: false, passEnv: [], redactEnv: [] },
  reporting: { mode: "pretty", verbose: false },
  cwd: "/workspace",
  outDir: "/workspace/.openflow/runs",
  cliArgs: {}
};

describe("Pipeline cancellation integration", () => {
  it("aborts running stage work cleanly when workflow is cancelled", async () => {
    const runner = new DefaultRuntimeRunner();

    const fixturePath = path.resolve("tests/fixtures/workflows/pipeline-cancellation.workflow.js");
    const sourceText = await fs.readFile(fixturePath, "utf8");

    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "pipeline-cancellation", description: "test" },
      body: `
        const items = ["item1"];
        const stages = [
          {
            name: "stage1",
            run: async (item, ctx) => {
              ctx.log("stage1 started");
              await ctx.sleep(200);
              ctx.log("stage1 completed");
              return item;
            }
          }
        ];
        await pipeline(items, stages);
      `,
      sourcePath: "workflow.js",
      sourceText,
      sourceHash: "abc"
    };

    const controller = new AbortController();
    const eventSink = new FakeEventSink();

    const runPromise = runner.run(
      {
        parsedWorkflow,
        config: defaultConfig,
        cli: {
          workflowFile: "workflow.js",
          args: {},
          concurrency: 2,
          dryRun: false,
          failFast: false,
          verbose: false,
          outDir: path.resolve("tests/temp-pipeline-cancel")
        },
        signal: controller.signal
      },
      {
        agentExecutor: {
          execute: async () => ({} as any)
        },
        eventSink
      }
    );

    // Abort after a short delay (e.g. 50ms), while stage1 is sleeping
    setTimeout(() => {
      controller.abort("Cancel pipeline test");
    }, 50);

    const result = await runPromise;

    // Clean up temporary outDir
    await fs.rm(path.resolve("tests/temp-pipeline-cancel"), { recursive: true, force: true });

    expect(result.status).toBe("cancelled");

    const logMessages = eventSink.events
      .filter((e) => e.type === "workflow.log")
      .map((e: any) => e.payload.message);

    expect(logMessages).toContain("stage1 started");
    expect(logMessages).not.toContain("stage1 completed");
  });

  it("ensures no late pipeline logs, stage events, or child-agent work are performed after cancellation", async () => {
    const runner = new DefaultRuntimeRunner();

    let agentExecutionCount = 0;
    const fakeAgentExecutor = {
      execute: async () => {
        agentExecutionCount++;
        return { success: true, outputs: { data: "ok" } } as any;
      }
    };

    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "pipeline-late-work", description: "test" },
      body: `
        const items = ["item1"];
        const stages = [
          {
            name: "stage1",
            run: async (item, ctx) => {
              ctx.log("stage1 started");
              try {
                // Wait for the outer cancel to trigger
                await ctx.sleep(100);
              } catch (e) {
                // Stage body might catch the sleep rejection or continue executing
                ctx.log("sleep rejected but body continues");
              }

              // Attempt late log
              ctx.log("stage1 late log");

              // Attempt late agent call
              try {
                await ctx.agent({ provider: "mock", prompt: "hello" });
                ctx.log("agent success");
              } catch (err) {
                ctx.log(\`agent failed: \${err.message || err}\`);
              }

              return item;
            }
          }
        ];
        await pipeline(items, stages);
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "def"
    };

    const controller = new AbortController();
    const eventSink = new FakeEventSink();

    const runPromise = runner.run(
      {
        parsedWorkflow,
        config: defaultConfig,
        cli: {
          workflowFile: "workflow.js",
          args: {},
          concurrency: 2,
          dryRun: false,
          failFast: false,
          verbose: false,
          outDir: path.resolve("tests/temp-pipeline-late-work")
        },
        signal: controller.signal
      },
      {
        agentExecutor: fakeAgentExecutor,
        eventSink
      }
    );

    // Cancel while sleep is pending (e.g. at 50ms)
    setTimeout(() => {
      controller.abort("Cancel late work test");
    }, 50);

    const result = await runPromise;

    // Clean up temporary outDir
    await fs.rm(path.resolve("tests/temp-pipeline-late-work"), { recursive: true, force: true });

    // Assert that the pipeline returned with 'cancelled'
    expect(result.status).toBe("cancelled");

    // Wait extra time (e.g. 150ms) to let any late executing code in the stage body finish
    await new Promise((resolve) => setTimeout(resolve, 150));

    const logMessages = eventSink.events
      .filter((e) => e.type === "workflow.log")
      .map((e: any) => e.payload.message);

    // 1. Assert that the "stage1 started" log exists
    expect(logMessages).toContain("stage1 started");

    // 2. Assert that the guarded ctx.log ("stage1 late log" and "agent success" / "agent failed")
    // did NOT print anything to the log since ctx.log no-ops after the stage signal is aborted.
    expect(logMessages).not.toContain("stage1 late log");
    expect(logMessages).not.toContain("agent success");
    expect(logMessages).not.toContain("agent failed");

    // 3. Assert that the child-agent execution was NOT called after abort
    expect(agentExecutionCount).toBe(0);

    // 4. Assert that no late stage events are emitted (e.g. pipeline.stage.completed)
    const stageCompletedEvents = eventSink.events.filter((e) => e.type === "pipeline.stage.completed");
    expect(stageCompletedEvents.length).toBe(0);
  });
});
