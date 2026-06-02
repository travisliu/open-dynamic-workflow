import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../../src/workflow/types.js";

describe("Validate Workflow Restrictions", () => {
  const options = { allowImports: false as const, allowShell: false as const };

  const createParsed = (bodyText: string): ParsedWorkflow => ({
    meta: { name: "test", description: "test" },
    body: bodyText,
    sourcePath: "test.js",
    sourceText: `export const meta = { name: "test", description: "test" };\n${bodyText}`,
    sourceHash: "123"
  });

  it("passes a valid simple workflow using allowed primitives", () => {
    const parsed = createParsed(`
      phase("review");
      log("starting review");
      const res = await agent({ prompt: "hello" });
      export default res;
    `);

    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("flags require() calls", () => {
    const parsed = createParsed(`
      const fs = require("fs");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Direct module access"))).toBe(true);
  });

  it("flags import statements", () => {
    const parsed = createParsed(`
      import fs from "fs";
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Arbitrary imports"))).toBe(true);
  });

  it("flags process.env and process.cwd() access", () => {
    const parsed = createParsed(`
      const env = process.env;
      const cwd = process.cwd();
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Direct process access"))).toBe(true);
  });

  it("flags fs access", () => {
    const parsed = createParsed(`
      const files = fs.readdirSync(".");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Direct module access"))).toBe(true);
  });

  it("flags child_process access", () => {
    const parsed = createParsed(`
      const cp = child_process.spawn("ls");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Shell/process spawning"))).toBe(true);
  });

  it("flags fetch() calls", () => {
    const parsed = createParsed(`
      const res = await fetch("https://google.com");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Network APIs"))).toBe(true);
  });

  it("flags shell() calls", () => {
    const parsed = createParsed(`
      await shell("echo hello");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("shell() is not supported"))).toBe(true);
  });

  it("flags pipeline() calls", () => {
    const parsed = createParsed(`
      await pipeline([], x => x);
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("pipeline() is not supported"))).toBe(true);
  });

  it("flags Date.now() calls", () => {
    const parsed = createParsed(`
      const time = Date.now();
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Date.now() is not allowed"))).toBe(true);
  });

  it("flags Math.random() calls", () => {
    const parsed = createParsed(`
      const rand = Math.random();
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Math.random() is not allowed"))).toBe(true);
  });

  it("flags constructor access", () => {
    const parsed = createParsed(`
      const c = ({}).constructor;
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Access to 'constructor' is not allowed"))).toBe(true);
  });

  it("flags __proto__ access", () => {
    const parsed = createParsed(`
      const p = ({}).__proto__;
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Access to '__proto__' is not allowed"))).toBe(true);
  });

  it("flags globalThis access", () => {
    const parsed = createParsed(`
      const g = globalThis;
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Global object access is not allowed"))).toBe(true);
  });

  it("flags Function constructor", () => {
    const parsed = createParsed(`
      const f = new Function('return process');
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Dynamic function creation is not allowed"))).toBe(true);
  });

  it("flags indirect constructor access via bracket notation", () => {
    const parsed = createParsed(`
      const c = ({})['constructor'];
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Access to 'constructor' is not allowed"))).toBe(true);
  });
});
