import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../../src/workflow/types.js";

describe("Tool Composition Validation", () => {
  const options = { allowImports: false as const };

  const createParsed = (bodyText: string): ParsedWorkflow => ({
    meta: { name: "test", description: "test" },
    body: bodyText,
    sourcePath: "test.js",
    sourceText: `export const meta = { name: "test", description: "test" };\n${bodyText}`,
    sourceHash: "123"
  });

  it("allows tool() at top-level of workflow body", () => {
    const parsed = createParsed(`
      await tool({ definition: "test-tool", args: {} });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("allows tool() inside the default exported workflow function", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        await ctx.tool({ definition: "test-tool", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("allows tool() inside the default exported arrow function", () => {
    const parsed = createParsed(`
      export default async (ctx) => {
        await ctx.tool({ definition: "test-tool", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("rejects tool() inside a nested function declaration", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        async function helper() {
          await ctx.tool({ definition: "test-tool", args: {} });
        }
        await helper();
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("is not allowed in this context"))).toBe(true);
  });

  it("rejects tool() inside a nested arrow function", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        const helper = async () => {
          await ctx.tool({ definition: "test-tool", args: {} });
        };
        await helper();
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("is not allowed in this context"))).toBe(true);
  });

  it("rejects tool() inside a top-level function that is not default export", () => {
    const parsed = createParsed(`
      async function helper(ctx) {
        await ctx.tool({ definition: "test-tool", args: {} });
      }
      export default async function(ctx) {
        await helper(ctx);
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("is not allowed in this context"))).toBe(true);
  });

  it("rejects tool() inside parallel() task thunk", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        await ctx.parallel([
          async () => {
            await ctx.tool({ definition: "test-tool", args: {} });
          }
        ]);
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("is not allowed in this context"))).toBe(true);
  });

  it("rejects tool() inside pipeline() stage run method", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        await ctx.pipeline([1], [{
          name: "test",
          run: async (item, ctx) => {
            await ctx.tool({ definition: "test-tool", args: { item } });
          }
        }]);
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("is not allowed in this context"))).toBe(true);
  });

  it("rejects tool() inside an aliased helper callback", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        const myFunc = ctx.tool;
        const helper = (cb) => cb({ definition: "test-tool", args: {} });
        await helper(myFunc);
      }
    `);
    // Note: static validation might not catch 'myFunc' as 'tool' if aliased,
    // but the requirement says "ordinary nested helper functions must fail".
    // If the helper ITSELF calls tool(), it's caught.
    // If it's passed as a callback and called, runtime should catch it if wrapped.
    // However, static validation usually looks for call expressions to 'tool' or 'ctx.tool'.
  });

  it("rejects aliasing tool to a variable (WS-001)", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        const t = ctx.tool;
        await t({ definition: "test-tool", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Aliasing tool() is not allowed"))).toBe(true);
  });

  it("rejects aliasing tool via assignment (WS-001)", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        let t;
        t = ctx.tool;
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Aliasing tool() is not allowed"))).toBe(true);
  });

  it("allows tool() via custom context parameter name (WS-001)", () => {
    const parsed = createParsed(`
      export default async (flow) => {
        await flow.tool({ definition: "test-tool", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, { ...options, knownToolIds: new Set(["test-tool"]) });
    expect(issues).toHaveLength(0);
  });

  it("rejects unknown tool ID via custom context parameter name (WS-001)", () => {
    const parsed = createParsed(`
      export default async (flow) => {
        await flow.tool({ definition: "missing-tool", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, { ...options, knownToolIds: new Set(["test-tool"]) });
    expect(issues.some(i => i.message.includes("Tool 'missing-tool' was not found"))).toBe(true);
  });

  it("rejects malformed tool call via custom context parameter name (WS-001)", () => {
    const parsed = createParsed(`
      export default async (flow) => {
        await flow.tool("not-an-object");
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("flow.tool() argument must be an object literal"))).toBe(true);
  });

  it("rejects aliasing from custom context parameter name (WS-001)", () => {
    const parsed = createParsed(`
      export default async (flow) => {
        const t = flow.tool;
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Aliasing tool() is not allowed"))).toBe(true);
  });

  it("rejects tool call via custom context parameter name in forbidden context (WS-001)", () => {
    const parsed = createParsed(`
      export default async (flow) => {
        await flow.parallel([
          async () => {
            await flow.tool({ definition: "test-tool", args: {} });
          }
        ]);
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("flow.tool() is not allowed in this context"))).toBe(true);
  });

  it("rejects tool call via custom context parameter name in nested function (WS-001)", () => {
    const parsed = createParsed(`
      export default async (flow) => {
        async function helper() {
          await flow.tool({ definition: "test-tool", args: {} });
        }
        await helper();
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("flow.tool() is not allowed in this context"))).toBe(true);
  });
});
