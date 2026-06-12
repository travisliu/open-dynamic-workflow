import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../../src/workflow/types.js";

describe("Tool Computed Access Validation", () => {
  const options = { allowImports: false as const };

  const createParsed = (bodyText: string): ParsedWorkflow => ({
    meta: { name: "test", description: "test" },
    body: bodyText,
    sourcePath: "test.js",
    sourceText: `export const meta = { name: "test", description: "test" };\n${bodyText}`,
    sourceHash: "123"
  });

  it("rejects tool() via computed access at top-level (direct call bypass)", () => {
    const parsed = createParsed(`
      export default async (ctx) => {
        await ctx["tool"]({ definition: "test-tool", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.toLowerCase().includes("is not allowed in this context") || i.message.toLowerCase().includes("computed access"))).toBe(true);
  });

  it("rejects tool() via computed access in nested helper", () => {
    const parsed = createParsed(`
      export default async (ctx) => {
        const helper = async () => ctx["tool"]({ definition: "test-tool", args: {} });
        await helper();
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.toLowerCase().includes("is not allowed in this context") || i.message.toLowerCase().includes("computed access"))).toBe(true);
  });

  it("rejects tool() aliasing via computed access", () => {
    const parsed = createParsed(`
      export default async (ctx) => {
        const t = ctx["tool"];
        await t({ definition: "test-tool", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.toLowerCase().includes("aliasing tool() is not allowed") || i.message.toLowerCase().includes("computed access"))).toBe(true);
  });

  it("handles custom context parameter name with computed access", () => {
    const parsed = createParsed(`
      export default async (flow) => {
        await flow["tool"]({ definition: "test-tool", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.toLowerCase().includes("is not allowed in this context") || i.message.toLowerCase().includes("computed access"))).toBe(true);
  });
});
