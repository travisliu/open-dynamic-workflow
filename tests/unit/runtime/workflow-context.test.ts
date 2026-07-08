import { describe, expect, it } from "vitest";
import { DefaultRuntimeRunner } from "../../../src/workflow/runtime.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig, CliRunOptions } from "../../../src/types/config.js";
import type { AgentExecutor, AgentExecutionInput } from "../../../src/agents/execution-types.js";
import type { AgentResult } from "../../../src/types/agent.js";
import type { RuntimeEventSink } from "../../../src/orchestration/scheduler.js";
import { ErrorCode } from "../../../src/errors/codes.js";

class FakeAgentExecutor implements AgentExecutor {
  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    throw new Error(`Agent executor should not run in context-only tests: ${input.id}`);
  }
}

class FakeEventSink implements RuntimeEventSink {
  events: { type: string; payload: any }[] = [];
  emit(type: string, payload: any) {
    this.events.push({ type, payload });
  }
}

const mockClock = {
  now() {
    return new Date("2026-07-08T00:00:00.000Z");
  }
};

const mockIdGenerator = {
  nextId(prefix: string) {
    return `${prefix}-mock-1`;
  }
};

const defaultCliOptions: CliRunOptions = {
  workflowFile: "workflow.js",
  args: {},
  concurrency: 2,
  dryRun: false,
  failFast: false,
  verbose: false
};

const defaultResolvedConfig: ResolvedConfig = {
  defaultProvider: "mock",
  concurrency: 2,
  timeoutMs: 30000,
  providers: {},
  security: {
    allowWorkflowImports: false,
    passEnv: [],
    redactEnv: []
  },
  reporting: {
    mode: "pretty",
    verbose: false
  },
  cwd: "/workspace",
  outDir: "/workspace/.open-dynamic-workflow/runs"
};

describe("Workflow Context Top-Level Runtime Integration", () => {
  it("supports script-style workflows using the global context facade", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "global-context", description: "test global context" },
      body: `
        context.set("features.plan.goal", "ship");
        context.append("features.review.findings", { title: "one" });
        context.merge("features.plan", { files: ["src/a.ts"] });
        export default context.snapshot();
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({
      features: {
        plan: {
          goal: "ship",
          files: ["src/a.ts"]
        },
        review: {
          findings: [
            { title: "one" }
          ]
        }
      }
    });
  });

  it("supports ctx.context inside default-exported workflow functions", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "callback-context", description: "test callback context" },
      body: `
        export default async (ctx) => {
          ctx.context.set("workflow.status", "ok");
          return ctx.context.get("workflow.status");
        };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("succeeded");
    expect(result.result).toBe("ok");
  });

  it("shares one store between global and callback facades", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "shared-store", description: "test shared store" },
      body: `
        context.set("shared", "global-val");
        export default async (ctx) => {
          const v1 = ctx.context.get("shared");
          ctx.context.set("shared", "callback-val");
          const v2 = context.get("shared");
          return { v1, v2 };
        };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({
      v1: "global-val",
      v2: "callback-val"
    });
  });

  it("fails fast on invalid paths during workflow execution", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "invalid-path", description: "test invalid path" },
      body: `
        context.set("features.__proto__.polluted", true);
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_PATH);
    expect(result.error?.message).toContain("Prototype pollution segments are not allowed");
  });

  it("fails fast on non-finite numbers during workflow execution", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "bad-number", description: "test bad number" },
      body: `
        context.set("workflow.bad", Infinity);
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_VALUE);
    expect(result.error?.message).toContain("number must be finite");
  });

  it("keeps the global context binding enumerable, non-configurable, and non-writable", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "inspect-context-binding", description: "test binding descriptor" },
      body: `
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "context");
        export default {
          hasContext: "context" in globalThis,
          enumerable: Object.prototype.propertyIsEnumerable.call(globalThis, "context"),
          configurable: descriptor?.configurable,
          writable: descriptor?.writable
        };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({
      hasContext: true,
      enumerable: true,
      configurable: false,
      writable: false
    });
  });

  it("isolates context between separate workflow runs", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();

    const run1: ParsedWorkflow = {
      meta: { name: "run-1", description: "write to context" },
      body: `
        context.set("val", "hello");
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Arrange
    const run2: ParsedWorkflow = {
      meta: { name: "run-2", description: "read from context" },
      body: `
        export default context.get("val");
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "456"
    };

    // Act
    const result1 = await runner.run(
      { parsedWorkflow: run1, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result1.status).toBe("succeeded");

    // Act
    const result2 = await runner.run(
      { parsedWorkflow: run2, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result2.status).toBe("succeeded");
    expect(result2.result).toBeUndefined();
  });

  it("rejects non-plain objects with constructor name spoofed as Object on context.set", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "spoofed-object-set", description: "test spoofed object on set" },
      body: `
        const Spoof = class Object {
          constructor() {
            this.value = 1;
          }
        };
        context.set("bad", new Spoof());
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_VALUE);
    expect(result.error?.message).toContain("value is not a plain object or array");
  });

  it("rejects non-plain objects with constructor name spoofed as Object on context.merge", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "spoofed-object-merge", description: "test spoofed object on merge" },
      body: `
        const Spoof = class Object {
          constructor() {
            this.value = 1;
          }
        };
        context.merge("bad", new Spoof());
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_VALUE);
    expect(result.error?.message).toContain("value is not a plain object or array");
  });

  it("rejects non-plain objects with constructor name spoofed as Object on context.append", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "spoofed-object-append", description: "test spoofed object on append" },
      body: `
        const Spoof = class Object {
          constructor() {
            this.value = 1;
          }
        };
        context.append("bad", new Spoof());
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_VALUE);
    expect(result.error?.message).toContain("value is not a plain object or array");
  });

  it("rejects plain objects with a getter named then without executing the getter", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "accessor-then-set", description: "test accessor then on set" },
      body: `
        const value = {};
        Object.defineProperty(value, "then", {
          enumerable: true,
          get() {
            throw new Error("getter executed");
          }
        });
        context.set("bad", value);
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_VALUE);
    expect(result.error?.message).toContain("contains accessors");
    expect(result.error?.message).not.toContain("getter executed");
  });

  it("rejects plain objects with a custom then function as thenable", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "function-then-set", description: "test function then on set" },
      body: `
        const value = {
          then() {}
        };
        context.set("bad", value);
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_VALUE);
    expect(result.error?.message).toContain("value contains a Promise or thenable");
  });

  it("rejects arrays with an index accessor without executing the getter", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "array-index-accessor-set", description: "test array index accessor on set" },
      body: `
        const value = [];
        Object.defineProperty(value, "0", {
          enumerable: true,
          get() {
            throw new Error("array getter executed");
          }
        });
        context.set("bad", value);
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_VALUE);
    expect(result.error?.message).toContain("contains accessors");
    expect(result.error?.message).not.toContain("array getter executed");
  });

  it("rejects arrays with a custom string-keyed accessor without executing the getter", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "array-string-accessor-set", description: "test array string accessor on set" },
      body: `
        const value = [];
        Object.defineProperty(value, "meta", {
          enumerable: true,
          get() {
            throw new Error("array custom getter executed");
          }
        });
        context.set("bad", value);
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    // Act
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.CONTEXT_INVALID_VALUE);
    expect(result.error?.message).toContain("contains accessors");
    expect(result.error?.message).not.toContain("array custom getter executed");
  });
});
