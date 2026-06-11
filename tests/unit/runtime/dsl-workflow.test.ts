import { describe, it, expect, vi } from "vitest";
import { DefaultRuntimeRunner } from "../../../src/workflow/runtime.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("workflow() DSL", () => {
  const createDeps = () => ({
    agentExecutor: { execute: vi.fn() },
    eventSink: { emit: vi.fn() },
    artifactStore: { 
      isRunCreated: () => true,
      getRunArtifacts: () => ({ reportPath: "r.json", eventsPath: "e.jsonl" }),
      createRun: vi.fn(),
      updateManifest: vi.fn(),
      writeJson: vi.fn().mockResolvedValue(undefined)
    }
  } as any);

  it("exposes workflow() to the sandbox", async () => {
    const deps = createDeps();
    const runner = new DefaultRuntimeRunner();
    
    const parsedWorkflow = {
      meta: { name: "parent" },
      body: `export default async () => {
        return await workflow({ name: "child", args: { val: 123 } });
      }`,
      sourcePath: "parent.ts"
    } as any;

    const childDef = {
      name: "child",
      parsedWorkflow: {
        meta: { name: "child" },
        body: `export default async () => { return args.val; }`,
        sourcePath: "child.ts"
      }
    };

    const registry = {
      require: (name: string) => {
        if (name === "parent") return { name: "parent", parsedWorkflow };
        if (name === "child") return childDef;
        throw new Error(`Missing ${name}`);
      },
      get: (name: string) => {
        if (name === "parent") return { name: "parent", parsedWorkflow };
        if (name === "child") return childDef;
        return undefined;
      },
      names: () => new Set(["parent", "child"])
    } as any;

    const result = await runner.run({
      parsedWorkflow,
      workflowRegistry: registry,
      config: { concurrency: 1 } as any,
      cli: { args: {} } as any
    }, deps);

    if (result.status === "failed") {
      console.error(result.error);
    }

    expect(result.status).toBe("succeeded");
    expect(result.result).toBe(123);
  });

  it("provides isolated args to child", async () => {
     const deps = createDeps();
    const runner = new DefaultRuntimeRunner();
    
    const parsedWorkflow = {
      meta: { name: "parent" },
      body: `export default async () => {
        await workflow({ name: "child", args: { x: 1 } });
        return args.x; // Should be parent's x, not child's x
      }`,
      sourcePath: "parent.ts"
    } as any;

    const childDef = {
      name: "child",
      parsedWorkflow: {
        meta: { name: "child" },
        body: `export default async () => { return args.x; }`,
        sourcePath: "child.ts"
      }
    };

    const registry = {
      require: (name: string) => {
        if (name === "parent") return { name: "parent", parsedWorkflow };
        if (name === "child") return childDef;
        throw new Error(`Missing ${name}`);
      },
      get: (name: string) => {
        if (name === "parent") return { name: "parent", parsedWorkflow };
        if (name === "child") return childDef;
        return undefined;
      },
      names: () => new Set(["parent", "child"])
    } as any;

    const result = await runner.run({
      parsedWorkflow,
      workflowRegistry: registry,
      config: { concurrency: 1 } as any,
      cli: { args: { x: "parent-x" } } as any
    }, deps);

    if (result.status === "failed") {
      console.error(result.error);
    }

    expect(result.status).toBe("succeeded");
    expect(result.result).toBe("parent-x");
  });
});
