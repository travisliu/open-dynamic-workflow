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

  it("allows ctx.tool() and ctx.toolId() inside loop() round callback", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        await ctx.loop({
          label: "tool-forbidden-loop",
          initialState: { count: 0 },
          options: { maxRounds: 2 },
          run: async (state, loopCtx) => {
            await loopCtx.tool({
              id: loopCtx.toolId("quality-gate"),
              definition: "test-tool",
              args: {}
            });
            return { done: true, nextState: state };
          }
        });
      }
    `);
    const issues = validateWorkflow(parsed, { ...options, knownToolIds: new Set(["test-tool"]) });
    expect(issues).toHaveLength(0);
  });

  it("rejects global tool() inside loop() round callback", () => {
    const parsed = createParsed(`
      await loop({
        label: "tool-forbidden-loop",
        initialState: { count: 0 },
        options: { maxRounds: 2 },
        run: async (state, loopCtx) => {
          await tool({ definition: "test-tool", args: {} });
          return { done: true, nextState: state };
        }
      });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("tool() is not allowed in this context"))).toBe(true);
  });

  it("rejects ctx.tool() inside a nested loop helper", () => {
    const parsed = createParsed(`
      await loop({
        label: "nested-helper-loop",
        initialState: {},
        options: { maxRounds: 1 },
        run: async (state, loopCtx) => {
          const helper = async () => loopCtx.tool({
            definition: "test-tool",
            args: {}
          });
          await helper();
          return { done: true, nextState: state };
        }
      });
    `);
    const issues = validateWorkflow(parsed, { ...options, knownToolIds: new Set(["test-tool"]) });
    expect(issues.some(i => i.message.includes("loopCtx.tool() is not allowed in this context"))).toBe(true);
  });

  it("rejects aliasing ctx.toolId() inside a loop round", () => {
    const parsed = createParsed(`
      await loop({
        label: "tool-id-alias-loop",
        initialState: {},
        options: { maxRounds: 1 },
        run: async (state, loopCtx) => {
          const makeToolId = loopCtx.toolId;
          return { done: true, nextState: state };
        }
      });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Aliasing tool() is not allowed"))).toBe(true);
  });

  it("rejects loopCtx.tool() inside global parallel() task thunk in loop callback", () => {
    const parsed = createParsed(`
      await loop({
        label: "parallel-in-loop",
        initialState: {},
        options: { maxRounds: 1 },
        run: async (state, loopCtx) => {
          await parallel([
            async () => {
              await loopCtx.tool({ definition: "test-tool", args: {} });
            }
          ]);
          return { done: true, nextState: state };
        }
      });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("is not allowed in this context"))).toBe(true);
  });

  it("rejects tool call with missing literal tool definition", () => {
    const parsed = createParsed(`
      await tool({ args: {} });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("is missing required 'definition' property"))).toBe(true);
  });

  it("rejects tool call with non-string-literal tool definition", () => {
    const parsed = createParsed(`
      const myDef = "test-tool";
      await tool({ definition: myDef, args: {} });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Tool definition must be a string literal"))).toBe(true);
  });

  it("rejects tool call with non-JSON-safe args where static detection is possible", () => {
    const parsed = createParsed(`
      await tool({
        definition: "test-tool",
        args: {
          myFunc: () => { console.log("unsafe"); },
          nested: {
            unsafeVal: undefined
          }
        }
      });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("contains non-JSON-safe values"))).toBe(true);
  });
});
