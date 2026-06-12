import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../../src/workflow/types.js";

describe("Validate Workflow Pipeline AST Validation", () => {
  const options = { allowImports: false as const };

  const createParsed = (bodyText: string): ParsedWorkflow => ({
    meta: { name: "test", description: "test" },
    body: bodyText,
    sourcePath: "test.js",
    sourceText: `export const meta = { name: "test", description: "test" };\n${bodyText}`,
    sourceHash: "123"
  });

  it("passes a valid named-stage pipeline", () => {
    const parsed = createParsed(`
      await pipeline(items, [
        { name: "stage-1", run: async (item) => item },
        { name: "stage-2", run: async (item) => item }
      ]);
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("fails when a stage is missing a name", () => {
    const parsed = createParsed(`
      await pipeline(items, [
        { run: async (item) => item }
      ]);
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("missing 'name'"))).toBe(true);
  });

  it("fails when duplicate stage names exist in literal stages", () => {
    const parsed = createParsed(`
      await pipeline(items, [
        { name: "stage-1", run: async (item) => item },
        { name: "stage-1", run: async (item) => item }
      ]);
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("duplicate stage name"))).toBe(true);
  });

  it("fails when options specify invalid strategy", () => {
    const parsed = createParsed(`
      await pipeline(items, [
        { name: "stage-1", run: async (item) => item }
      ], { strategy: "waterfall" });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("strategy must be 'item-streaming' or 'stage-barrier'"))).toBe(true);
  });

  it("fails when options specify unsupported keys", () => {
    const parsed = createParsed(`
      await pipeline(items, [
        { name: "stage-1", run: async (item) => item }
      ], { retry: 3 });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("options contain unsupported key 'retry'"))).toBe(true);
  });

  it("fails when stages use function shorthand", () => {
    const parsed = createParsed(`
      await pipeline(items, [
        (item) => item
      ]);
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("stages must be named stage objects, not function shorthands"))).toBe(true);
  });
});
