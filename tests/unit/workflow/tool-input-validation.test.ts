import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../../src/workflow/types.js";

describe("Tool Input Static Validation (T002)", () => {
  const options = {
    allowImports: false as const,
    knownToolIds: new Set(["read-json"]),
    toolRegistry: {
      get: (id: string) => {
        if (id === "read-json") {
          return {
            definition: {
              id: "read-json",
              inputSchema: {
                type: "object",
                properties: {
                  path: { type: "string" }
                },
                required: ["path"]
              }
            }
          };
        }
        return undefined;
      },
      list: () => []
    } as any
  };

  const createParsed = (bodyText: string): ParsedWorkflow => ({
    meta: { name: "test", description: "test" },
    body: bodyText,
    sourcePath: "test.js",
    sourceText: `export const meta = { name: "test", description: "test" };\n${bodyText}`,
    sourceHash: "123"
  });

  it("allows tool() with dynamic args (Identifier)", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        const argsObj = { path: "test.json" };
        await ctx.tool({ definition: "read-json", args: argsObj });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("allows tool() with partially dynamic args (Object with dynamic props)", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        const p = "test.json";
        await ctx.tool({ definition: "read-json", args: { path: p } });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("allows tool() with dynamic args (CallExpression)", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        await ctx.tool({ definition: "read-json", args: makeArgs() });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("rejects tool() with invalid static literal args", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        await ctx.tool({ definition: "read-json", args: { path: 123 } });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("must be string"))).toBe(true);
  });

  it("rejects tool() with missing required args property in object literal", () => {
    const parsed = createParsed(`
      export default async function(ctx) {
        await ctx.tool({ definition: "read-json", args: {} });
      }
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("must have required property 'path'"))).toBe(true);
  });

  it("skips schema validation for workflow() with missing args", () => {
    const optionsWithWorkflow = {
      ...options,
      knownWorkflowNames: new Set(["other"]),
      workflowInputSchemas: new Map([
        ["other", {
          type: "object",
          properties: { requiredField: { type: "string" } },
          required: ["requiredField"]
        }]
      ])
    };
    const parsed = createParsed(`
      export default async function(ctx) {
        await ctx.workflow({ name: "other" });
      }
    `);
    const issues = validateWorkflow(parsed, optionsWithWorkflow);
    expect(issues).toHaveLength(0);
  });
});
