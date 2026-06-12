import { describe, it, expect, beforeEach } from "vitest";
import { DefaultRuntimeRunner } from "../../../src/workflow/runtime.js";
import { ParsedWorkflow } from "../../../src/types/workflow.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("Tool Alias Hardening - Runtime Enforcement", () => {
  let runner: DefaultRuntimeRunner;
  const agentExecutor = {
    execute: async () => ({} as any)
  };

  beforeEach(() => {
    runner = new DefaultRuntimeRunner();
  });

  const mockWorkflow = (sourceText: string): ParsedWorkflow => ({
    sourcePath: "test.ts",
    sourceText,
    sourceHash: "hash",
    body: sourceText,
    meta: { name: "test", description: "test", version: "1.0.0" }
  });

  it("rejects tool call from a promise callback even if aliased", async () => {
    // We use a trick to bypass static validation if needed.
    const body = `
      export default async (ctx) => {
        const key = "tool";
        const t = ctx[key];
        return await Promise.resolve().then(() => t({ definition: "echo", args: { message: "hi" } }));
      };
    `;

    const result = await runner.run({
      parsedWorkflow: mockWorkflow(body),
      config: { providers: {} } as any,
      cli: { cwd: "/tmp" } as any,
      toolRegistry: {
        require: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        get: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        list: () => []
      } as any,
    }, {
      agentExecutor,
      eventSink: { emit: () => {} } as any,
      toolExecutor: {
        execute: async () => ({ ok: true, output: "echoed" }),
        getSummaries: () => [],
        close: async () => {},
        cancel: () => {}
      } as any
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.TOOL_INVALID_CONTEXT);
    expect(result.error?.message).toContain("asynchronous callback");
  });

  it("still allows direct top-level tool calls with await", async () => {
    const body = `
      export default async (ctx) => {
        await ctx.tool({ definition: "echo", args: { message: "hi" } });
        return "ok";
      };
    `;

    const result = await runner.run({
      parsedWorkflow: mockWorkflow(body),
      config: { providers: {} } as any,
      cli: { cwd: "/tmp" } as any,
      toolRegistry: {
        require: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        get: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        list: () => []
      } as any,
    }, {
      agentExecutor,
      eventSink: { emit: () => {} } as any,
      toolExecutor: {
        execute: async () => ({ ok: true, output: "echoed" }),
        getSummaries: () => [],
        close: async () => {},
        cancel: () => {}
      } as any
    });

    expect(result.status).toBe("succeeded");
    expect(result.result).toBe("ok");
  });

  it("still allows direct top-level global tool() calls with await", async () => {
    const body = `
      export default async (ctx) => {
        await tool({ definition: "echo", args: { message: "hi" } });
        return "ok";
      };
    `;

    const result = await runner.run({
      parsedWorkflow: mockWorkflow(body),
      config: { providers: {} } as any,
      cli: { cwd: "/tmp" } as any,
      toolRegistry: {
        require: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        get: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        list: () => []
      } as any,
    }, {
      agentExecutor,
      eventSink: { emit: () => {} } as any,
      toolExecutor: {
        execute: async () => ({ ok: true, output: "echoed" }),
        getSummaries: () => [],
        close: async () => {},
        cancel: () => {}
      } as any
    });

    expect(result.status).toBe("succeeded");
    expect(result.result).toBe("ok");
  });

  it("still allows direct top-level tool calls after await on a sandbox promise", async () => {
    const body = `
      export default async (ctx) => {
        await Promise.resolve(); // This is a sandbox promise
        await ctx.tool({ definition: "echo", args: { message: "hi" } });
        return "ok";
      };
    `;

    const result = await runner.run({
      parsedWorkflow: mockWorkflow(body),
      config: { providers: {} } as any,
      cli: { cwd: "/tmp" } as any,
      toolRegistry: {
        require: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        get: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        list: () => []
      } as any,
    }, {
      agentExecutor,
      eventSink: { emit: () => {} } as any,
      toolExecutor: {
        execute: async () => ({ ok: true, output: "echoed" }),
        getSummaries: () => [],
        close: async () => {},
        cancel: () => {}
      } as any
    });

    expect(result.status).toBe("succeeded");
    expect(result.result).toBe("ok");
  });

  it("rejects tool call from setTimeout", async () => {
    const body = `
      export default async (ctx) => {
        return new Promise((resolve) => {
          setTimeout(async () => {
            try {
              await ctx.tool({ definition: "echo", args: { message: "hi" } });
              resolve("ok");
            } catch (err) {
              resolve("failed: " + err.message);
            }
          }, 10);
        });
      };
    `;

    const result = await runner.run({
      parsedWorkflow: mockWorkflow(body),
      config: { providers: {} } as any,
      cli: { cwd: "/tmp" } as any,
      toolRegistry: {
        require: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        get: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        list: () => []
      } as any,
    }, {
      agentExecutor,
      eventSink: { emit: () => {} } as any,
      toolExecutor: {
        execute: async () => ({ ok: true, output: "echoed" }),
        getSummaries: () => [],
        close: async () => {},
        cancel: () => {}
      } as any
    });

    expect(result.status).toBe("succeeded");
    expect(result.result).toContain("failed: tool() is not allowed in asynchronous callback context");
  });

  it("rejects tool call from a nested helper even if static validation is bypassed (WS-001)", async () => {
    const body = `
      export default async (ctx) => {
        const helper = async () => {
          const key = "tool";
          return await ctx[key]({ definition: "echo", args: { message: "hi" } });
        };
        return await helper();
      };
    `;

    const result = await runner.run({
      parsedWorkflow: mockWorkflow(body),
      config: { providers: {} } as any,
      cli: { cwd: "/tmp" } as any,
      toolRegistry: {
        require: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        get: () => ({ 
          definition: { id: "echo" },
          validateInput: () => ({ ok: true })
        }),
        list: () => []
      } as any,
    }, {
      agentExecutor,
      eventSink: { emit: () => {} } as any,
      toolExecutor: {
        execute: async () => ({ ok: true, output: "echoed" }),
        getSummaries: () => [],
        close: async () => {},
        cancel: () => {}
      } as any
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.TOOL_INVALID_CONTEXT);
    expect(result.error?.message).toContain("nested helper or callback");
  });
});
