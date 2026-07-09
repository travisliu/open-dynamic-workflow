import { describe, expect, it } from "vitest";
import { createSandboxContext } from "../../../src/workflow/sandbox.js";
import { createDsl } from "../../../src/workflow/dsl.js";
import type { RuntimeState } from "../../../src/workflow/types.js";
import { createWorkflowContextRuntime } from "../../../src/context/index.js";
import * as vm from "node:vm";

describe("DSL pipeline exposure", () => {
  const dummyState: RuntimeState = {
    runId: "run-123",
    parsedWorkflow: {
      meta: { name: "test", description: "test desc" },
      body: "export default async () => {};",
      sourcePath: "workflow.ts",
      sourceText: "export default async () => {};",
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
    eventSink: {} as any,
    abortController: new AbortController(),
    agentCounter: 0,
    startedAt: new Date().toISOString(),
    contextRuntime: createWorkflowContextRuntime({ runId: "run-123" })
  };

  it("exposes pipeline in createDsl", () => {
    const dsl = createDsl(dummyState);
    expect(dsl.pipeline).toBeDefined();
    expect(typeof dsl.pipeline).toBe("function");
  });

  it("exposes pipeline in sandbox context", () => {
    const context = createSandboxContext(dummyState);
    expect(context.pipeline).toBeDefined();
    expect(typeof context.pipeline).toBe("function");
  });

  it("can execute sandbox code containing pipeline and fail on validation", async () => {
    const context = createSandboxContext(dummyState);
    const code = `
      (async () => {
        // This should fail runtime argument validation because stages is not an array
        await pipeline([], "not-an-array");
      })()
    `;
    const promise = vm.runInContext(code, context);
    await expect(promise).rejects.toThrow("pipeline() stages must be an array.");
  });
});
