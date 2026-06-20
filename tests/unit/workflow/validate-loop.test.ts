import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";

function makeWorkflow(body: string): ParsedWorkflow {
  return {
    meta: { name: "test", description: "" },
    body,
    sourcePath: "test.ts",
    sourceText: body,
    sourceHash: "hash"
  };
}

describe("Workflow static validation: loop()", () => {
  it("passes valid loop() call", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "my-loop",
          initialState: { count: 0 },
          options: { maxRounds: 5 },
          run: async (state, ctx) => {
            return { done: true, nextState: { count: state.count + 1 } };
          }
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues).toHaveLength(0);
  });

  it("passes valid global loop() call", () => {
    const workflow = makeWorkflow(`
      export default async () => {
        await loop({
          label: "my-loop",
          initialState: { count: 0 },
          options: { maxRounds: 5 },
          run: async (state) => {
            return { done: true, nextState: { count: state.count + 1 } };
          }
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues).toHaveLength(0);
  });

  it("fails loop() with zero arguments", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop();
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("accepts exactly one object argument"))).toBe(true);
  });

  it("fails loop() with too many arguments", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({}, "extra");
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("accepts exactly one object argument"))).toBe(true);
  });

  it("rejects positional loop calls", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({ count: 0 }, async () => {}, { maxRounds: 5 });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("accepts exactly one object argument"))).toBe(true);
  });

  it("rejects non-object static argument", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop("invalid-arg");
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("argument must be an object literal"))).toBe(true);
  });

  it("rejects spread properties in loop input object", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        const extra = { label: "l" };
        await ctx.loop({
          ...extra,
          initialState: {},
          options: { maxRounds: 5 },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("does not support spread properties"))).toBe(true);
  });

  it("rejects unsupported top-level keys", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "my-loop",
          initialState: {},
          options: { maxRounds: 5 },
          run: async () => ({ done: true, nextState: {} }),
          extraKey: 42
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("contains unsupported top-level key"))).toBe(true);
  });

  it("rejects missing required top-level fields", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "my-loop",
          initialState: {}
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("missing required 'options' property"))).toBe(true);
    expect(issues.some(i => i.message.includes("missing required 'run' property"))).toBe(true);
  });

  it("rejects empty static label", () => {
    const workflow = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "   ",
          initialState: {},
          options: { maxRounds: 5 },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    const issues = validateWorkflow(workflow, { allowImports: false });
    expect(issues.some(i => i.message.includes("label cannot be empty"))).toBe(true);
  });

  it("rejects invalid static maxRounds values", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: -1 },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("maxRounds must be a positive integer"))).toBe(true);

    const w2 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 0 },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w2, { allowImports: false }).some(i => i.message.includes("maxRounds must be a positive integer"))).toBe(true);

    const w3 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: "5" },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w3, { allowImports: false }).some(i => i.message.includes("maxRounds must be a positive integer"))).toBe(true);
  });

  it("rejects invalid static timeoutMs values", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5, timeoutMs: -10 },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("timeoutMs must be a positive integer"))).toBe(true);

    const w2 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5, timeoutMs: "100" },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w2, { allowImports: false }).some(i => i.message.includes("timeoutMs must be a positive integer"))).toBe(true);
  });

  it("rejects invalid failureMode static values", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5, failureMode: 1 },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("failureMode must be a string literal"))).toBe(true);

    const w2 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5, failureMode: "invalid" },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w2, { allowImports: false }).some(i => i.message.includes("failureMode must be"))).toBe(true);
  });

  it("rejects deprecated/unsupported option keys", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5, stopWhen: () => true },
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("option 'stopWhen' is deprecated or unsupported"))).toBe(true);
  });

  it("rejects runRound key explicitly", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5 },
          runRound: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("does not support 'runRound'. Use 'run' instead."))).toBe(true);
  });

  it("rejects ctx.break() inside loop run callback", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5 },
          run: async (state, ctx) => {
            ctx.break();
            return { done: true, nextState: {} };
          }
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("break() is not supported inside loop run callback"))).toBe(true);
  });

  it("rejects tool() and ctx.tool() inside loop run callback", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5 },
          run: async (state, ctx) => {
            await tool({ definition: "t", args: {} });
            return { done: true, nextState: {} };
          }
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("tool() is not allowed in this context"))).toBe(true);
  });

  it("rejects ctx.parallel() inside loop run callback", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5 },
          run: async (state, ctx) => {
            await ctx.parallel([]);
            return { done: true, nextState: {} };
          }
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("ctx.parallel() is not supported inside loop run callback"))).toBe(true);
  });

  it("rejects ctx['parallel']() inside loop run callback", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5 },
          run: async (state, ctx) => {
            await ctx["parallel"]([]);
            return { done: true, nextState: {} };
          }
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false }).some(i => i.message.includes("ctx.parallel() is not supported inside loop run callback"))).toBe(true);
  });


  it("rejects obvious invalid returns from loop run", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        await ctx.loop({
          label: "l",
          initialState: {},
          options: { maxRounds: 5 },
          run: async () => {
            return { result: 42 };
          }
        });
      }
    `);
    const issues = validateWorkflow(w1, { allowImports: false });
    expect(issues.some(i => i.message.includes("Loop run return must not contain 'result'"))).toBe(true);
    expect(issues.some(i => i.message.includes("Loop run return must contain 'done'"))).toBe(true);
    expect(issues.some(i => i.message.includes("Loop run return must contain 'nextState'"))).toBe(true);
  });

  it("allows dynamic options expression at static validation time", () => {
    const w1 = makeWorkflow(`
      export default async (ctx) => {
        const opts = getOptions();
        await ctx.loop({
          label: "l",
          initialState: {},
          options: opts,
          run: async () => ({ done: true, nextState: {} })
        });
      }
    `);
    expect(validateWorkflow(w1, { allowImports: false })).toHaveLength(0);
  });
});
