import { describe, it, expect } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import { ParsedWorkflow } from "../../../src/types/workflow.js";

describe("Tool Alias Hardening - Static Validation", () => {
  const mockWorkflow = (sourceText: string): ParsedWorkflow => ({
    sourcePath: "test.ts",
    sourceText,
    sourceHash: "hash",
    body: sourceText,
    meta: { name: "test", description: "test" }
  });

  it("rejects destructured tool alias from ctx", () => {
    const source = `
      export const meta = { name: "test", description: "test" };
      export default async (ctx) => {
        const { tool: t } = ctx;
        await t({ definition: "echo", args: {} });
      };
    `;
    const issues = validateWorkflow(mockWorkflow(source), {
      allowImports: false
    });
    expect(issues.some(i => i.message.includes("Aliasing tool() is not allowed"))).toBe(true);
  });

  it("rejects destructured tool alias from parameters", () => {
    const source = `
      export const meta = { name: "test", description: "test" };
      export default async ({ tool: t }) => {
        await t({ definition: "echo", args: {} });
      };
    `;
    const issues = validateWorkflow(mockWorkflow(source), {
      allowImports: false
    });
    expect(issues.some(i => i.message.includes("Aliasing tool() is not allowed"))).toBe(true);
  });

  it("rejects shorthand destructured tool alias", () => {
    const source = `
      export const meta = { name: "test", description: "test" };
      export default async (ctx) => {
        const { tool } = ctx;
        await tool({ definition: "echo", args: {} });
      };
    `;
    const issues = validateWorkflow(mockWorkflow(source), {
      allowImports: false
    });
    expect(issues.some(i => i.message.includes("Aliasing tool() is not allowed"))).toBe(true);
  });
});
