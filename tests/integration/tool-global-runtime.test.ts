import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { loadToolRegistry } from "../../src/tools/load.js";
import { ErrorCode } from "../../src/errors/codes.js";

const projects: string[] = [];

async function project(prefix: string) {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), `odw-${prefix}-`));
  projects.push(cwd);
  await fs.mkdir(path.join(cwd, ".open-dynamic-workflow", "tools"), { recursive: true });
  return cwd;
}

async function writeTool(cwd: string, name: string, source: string) {
  const file = path.join(cwd, ".open-dynamic-workflow", "tools", name);
  await fs.writeFile(file, source);
  return file;
}

async function load(cwd: string) {
  return loadToolRegistry({
    cwd,
    dir: ".open-dynamic-workflow/tools",
    maxDefinitions: 20
  });
}

async function expectLoadFailure(cwd: string, code = ErrorCode.TOOL_INVALID_DEFINITION) {
  let error: any;
  try {
    await load(cwd);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeDefined();
  expect(error.code).toBe(code);
  return error;
}

afterEach(async () => {
  for (const cwd of projects.splice(0)) {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

describe("active tool runtime loading", () => {
  it("loads no-import JavaScript and TypeScript definitions and executes them", async () => {
    const cwd = await project("global-success");
    await writeTool(cwd, "javascript.tool.js", `
      export default defineTool({
        id: "javascript-tool",
        description: "JavaScript tool",
        inputSchema: { type: "object" },
        outputSchema: { type: "object", required: ["value"] },
        run: (input) => ({ value: input.value || "js" })
      });
    `);
    await writeTool(cwd, "typescript.tool.ts", `
      type Input = { value?: string };
      export default defineTool<Input, { value: string }>({
        id: "typescript-tool",
        description: "TypeScript tool",
        inputSchema: { type: "object" },
        run: (input) => ({ value: input.value || "ts" })
      });
    `);

    const registry = await load(cwd);
    expect(registry.list().map(tool => tool.definition.id)).toEqual([
      "javascript-tool",
      "typescript-tool"
    ]);
    expect(await registry.require("javascript-tool").definition.run({ value: "ok" }, {} as any)).toEqual({ value: "ok" });
    expect(await registry.require("typescript-tool").definition.run({}, {} as any)).toEqual({ value: "ts" });
    expect(registry.require("javascript-tool").sourcePath).toContain("javascript.tool.js");
  });

  it("preserves the sentinel global on success and failure, and removes temporary modules", async () => {
    const cwd = await project("global-cleanup");
    const { defineTool: activeDefineTool } = await import("../../src/tools/define-tool.js");
    const sentinel = activeDefineTool;
    const descriptor = { value: sentinel, writable: false, enumerable: false, configurable: true };

    const before = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    Object.defineProperty(globalThis, "defineTool", descriptor);

    try {
      await writeTool(cwd, "ok.tool.js", `
        export default defineTool({ id: "cleanup-ok", description: "ok", inputSchema: {}, run: () => "ok" });
      `);
      await load(cwd);
      expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toEqual(descriptor);
      expect((globalThis as any).defineTool).toBe(sentinel);

      await fs.rm(path.join(cwd, ".open-dynamic-workflow", "tools", "ok.tool.js"));
      await writeTool(cwd, "bad.tool.js", `
        throw new Error("deliberate import failure");
        export default defineTool({ id: "cleanup-bad", description: "bad", inputSchema: {}, run: () => "bad" });
      `);
      await expectLoadFailure(cwd);
      expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toEqual(descriptor);
    } finally {
      if (before) Object.defineProperty(globalThis, "defineTool", before);
      else delete (globalThis as any).defineTool;
    }

    const tmp = path.join(cwd, ".open-dynamic-workflow", "tmp");
    await expect(fs.readdir(tmp)).rejects.toThrow();
  });

  it("restores an absent global after successful and rejected loads", async () => {
    const cwd = await project("global-absent");
    const before = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    try {
      if (before) delete (globalThis as any).defineTool;
      await writeTool(cwd, "ok.tool.js", `
        export default defineTool({ id: "absent-ok", description: "ok", inputSchema: {}, run: () => "ok" });
      `);
      await load(cwd);
      expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);

      await fs.rm(path.join(cwd, ".open-dynamic-workflow", "tools", "ok.tool.js"));
      await writeTool(cwd, "bad.tool.js", `export default defineTool({ id: "bad", description: "bad", inputSchema: {}, run: () => { throw new Error("run") } });`);
      await fs.appendFile(path.join(cwd, ".open-dynamic-workflow", "tools", "bad.tool.js"), "\nthrow new Error('load failure');\n");
      await expectLoadFailure(cwd);
      expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
    } finally {
      if (before) Object.defineProperty(globalThis, "defineTool", before);
      else delete (globalThis as any).defineTool;
    }
  });

  it("keeps static validation, source diagnostics, branding, and registry validation authoritative", async () => {
    const cwd = await project("global-validation");
    const malformed = await writeTool(cwd, "malformed.tool.js", `export default { id: "plain", description: "plain", inputSchema: {}, run: () => "no brand" };`);
    const error = await expectLoadFailure(cwd);
    expect(error.message).toContain(path.relative(cwd, malformed));

    await fs.rm(path.dirname(malformed), { recursive: true, force: true });
    await fs.mkdir(path.dirname(malformed), { recursive: true });
    await writeTool(cwd, "missing-field.tool.js", `export default defineTool({ id: "missing-field", description: "missing", run: () => {} });`);
    const missing = await expectLoadFailure(cwd);
    expect(missing.message).toContain("inputSchema");

    await fs.rm(path.dirname(malformed), { recursive: true, force: true });
    await fs.mkdir(path.dirname(malformed), { recursive: true });
    await writeTool(cwd, "invalid-schema.tool.js", `export default defineTool({ id: "invalid-schema", description: "invalid", inputSchema: { type: "not-a-schema-type" }, run: () => "bad" });`);
    const schema = await expectLoadFailure(cwd);
    expect(schema.message).toContain("inputSchema");
  });

  it("rejects malformed static syntax and duplicate IDs before registry creation", async () => {
    const cwd = await project("global-static");
    await writeTool(cwd, "one.tool.js", `export default defineTool({ id: "same", description: "one", inputSchema: {}, run: () => "one" });`);
    await writeTool(cwd, "two.tool.js", `export default defineTool({ id: "same", description: "two", inputSchema: {}, run: () => "two" });`);
    const duplicate = await expectLoadFailure(cwd, ErrorCode.TOOL_DUPLICATE_DEFINITION);
    expect(duplicate.message).toContain("same");

    await fs.rm(path.join(cwd, ".open-dynamic-workflow", "tools"), { recursive: true, force: true });
    await fs.mkdir(path.join(cwd, ".open-dynamic-workflow", "tools"), { recursive: true });
    await writeTool(cwd, "unsupported.tool.js", `export default defineTool({ id: "unsupported", description: "unsupported", inputSchema: {}, run: () => "bad", myMethod() {} });`);
    const unsupported = await expectLoadFailure(cwd);
    expect(unsupported.message).toContain("Method");
  });

  it("serializes same-process loads and releases the lock after a rejected load", async () => {
    const first = await project("lock-first");
    const second = await project("lock-second");
    await writeTool(first, "first.tool.js", `export default defineTool({ id: "first", description: "first", inputSchema: {}, run: () => "first" });`);
    await writeTool(second, "second.tool.js", `export default defineTool({ id: "second", description: "second", inputSchema: {}, run: () => "second" });`);

    const [one, two] = await Promise.all([load(first), load(second)]);
    expect(one.has("first")).toBe(true);
    expect(two.has("second")).toBe(true);

    await fs.rm(path.join(first, ".open-dynamic-workflow", "tools", "first.tool.js"));
    await writeTool(first, "reject.tool.js", `throw new Error("reject lock");`);
    await expectLoadFailure(first);
    const recovered = await load(second);
    expect(recovered.has("second")).toBe(true);
  });
});
