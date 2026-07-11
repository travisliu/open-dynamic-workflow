import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { loadToolRegistry } from "../../src/tools/load.js";
import { ErrorCode } from "../../src/errors/codes.js";
import { defineTool as activeDefineTool } from "../../src/tools/define-tool.js";

const projects: string[] = [];

async function project(prefix: string) {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), `odw-global-${prefix}-`));
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

async function assertToolsDirectoryIntact(cwd: string) {
  await expect(fs.access(path.join(cwd, ".open-dynamic-workflow", "tools"))).resolves.toBeUndefined();
  await expect(fs.access(path.join(cwd, ".open-dynamic-workflow", "tmp"))).rejects.toThrow();
}

afterEach(async () => {
  for (const cwd of projects.splice(0)) {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

describe("Group 1: Successful loading/execution", () => {
  it("loads no-import JavaScript and TypeScript definitions and executes them", async () => {
    const cwd = await project("success-run");
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

    // Assert workspace still lacks package.json and node_modules
    await expect(fs.access(path.join(cwd, "package.json"))).rejects.toThrow();
    await expect(fs.access(path.join(cwd, "node_modules"))).rejects.toThrow();

    // Assert both IDs are registered
    expect(registry.list().map(tool => tool.definition.id)).toEqual([
      "javascript-tool",
      "typescript-tool"
    ]);

    // Assert original source paths are registered
    expect(registry.require("javascript-tool").sourcePath).toContain("javascript.tool.js");
    expect(registry.require("typescript-tool").sourcePath).toContain("typescript.tool.ts");

    // Assert both tools return expected values through execution interface
    expect(await registry.require("javascript-tool").definition.run({ value: "ok" }, {} as any)).toEqual({ value: "ok" });
    expect(await registry.require("typescript-tool").definition.run({}, {} as any)).toEqual({ value: "ts" });

    // Assert temp cleanup
    await assertToolsDirectoryIntact(cwd);
  });
});

describe("Group 2: Global-session behavior and lifecycle", () => {
  it("observes defineTool global descriptor during execution", async () => {
    const cwd = await project("descriptor-obs");
    const before = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    try {
      delete (globalThis as any).__observedDescriptor;

      await writeTool(cwd, "observe.tool.js", `
        globalThis.__observedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
        export default defineTool({
          id: "observe-tool",
          description: "observes descriptor",
          inputSchema: {},
          run: () => "observed"
        });
      `);

      await load(cwd);

      const observed = (globalThis as any).__observedDescriptor;
      expect(observed).toBeDefined();
      expect(observed.value).toBe(activeDefineTool);
      expect(observed.writable).toBe(false);
      expect(observed.enumerable).toBe(false);
      expect(observed.configurable).toBe(true);

      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__observedDescriptor;
      if (before) Object.defineProperty(globalThis, "defineTool", before);
      else delete (globalThis as any).defineTool;
    }
  });

  it("restores the sentinel descriptor on success and evaluation failure", async () => {
    const cwdSuccess = await project("sentinel-ok");
    const cwdFailure = await project("sentinel-fail");
    const before = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    try {
      const customDescriptor = {
        value: activeDefineTool,
        writable: true,
        enumerable: true,
        configurable: true
      };
      Object.defineProperty(globalThis, "defineTool", customDescriptor);

      // Success path
      await writeTool(cwdSuccess, "ok.tool.js", `
        export default defineTool({ id: "cleanup-ok", description: "ok", inputSchema: {}, run: () => "ok" });
      `);
      await load(cwdSuccess);

      const afterSuccess = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
      expect(afterSuccess).toBeDefined();
      expect(afterSuccess!.value).toBe(activeDefineTool);
      expect(afterSuccess!.writable).toBe(true);
      expect(afterSuccess!.enumerable).toBe(true);
      expect(afterSuccess!.configurable).toBe(true);
      await assertToolsDirectoryIntact(cwdSuccess);

      // Evaluation failure path (occurs during top-level module evaluation after static validation)
      await writeTool(cwdFailure, "bad.tool.js", `
        throw new Error("deliberate top-level failure");
        export default defineTool({ id: "cleanup-bad", description: "bad", inputSchema: {}, run: () => "bad" });
      `);
      await expectLoadFailure(cwdFailure);

      const afterFailure = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
      expect(afterFailure).toBeDefined();
      expect(afterFailure!.value).toBe(activeDefineTool);
      expect(afterFailure!.writable).toBe(true);
      expect(afterFailure!.enumerable).toBe(true);
      expect(afterFailure!.configurable).toBe(true);
      await assertToolsDirectoryIntact(cwdFailure);
    } finally {
      if (before) Object.defineProperty(globalThis, "defineTool", before);
      else delete (globalThis as any).defineTool;
    }
  });

  it("ensures own property defineTool is absent after success and failure", async () => {
    const cwdSuccess = await project("absent-ok");
    const cwdFailure = await project("absent-fail");
    const before = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    try {
      delete (globalThis as any).defineTool;

      // Success path
      await writeTool(cwdSuccess, "ok.tool.js", `
        export default defineTool({ id: "absent-ok", description: "ok", inputSchema: {}, run: () => "ok" });
      `);
      await load(cwdSuccess);
      expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
      await assertToolsDirectoryIntact(cwdSuccess);

      // Evaluation failure path
      await writeTool(cwdFailure, "bad.tool.js", `
        throw new Error("deliberate failure");
        export default defineTool({ id: "absent-bad", description: "bad", inputSchema: {}, run: () => "bad" });
      `);
      await expectLoadFailure(cwdFailure);
      expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
      await assertToolsDirectoryIntact(cwdFailure);
    } finally {
      if (before) Object.defineProperty(globalThis, "defineTool", before);
      else delete (globalThis as any).defineTool;
    }
  });

  it("protects foreign own defineTool data value", async () => {
    const cwd = await project("foreign-data");
    const before = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    try {
      const foreignDescriptor = { value: "foreign-value", writable: true, enumerable: true, configurable: true };
      Object.defineProperty(globalThis, "defineTool", foreignDescriptor);

      delete (globalThis as any).__foreignEvalMarker;

      await writeTool(cwd, "ok.tool.js", `
        globalThis.__foreignEvalMarker = true;
        export default defineTool({ id: "foreign-tool", description: "desc", inputSchema: {}, run: () => "ok" });
      `);

      await expectLoadFailure(cwd, ErrorCode.TOOL_INVALID_DEFINITION);

      expect((globalThis as any).__foreignEvalMarker).toBeUndefined();

      const currentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
      expect(currentDescriptor).toEqual(foreignDescriptor);
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__foreignEvalMarker;
      if (before) Object.defineProperty(globalThis, "defineTool", before);
      else delete (globalThis as any).defineTool;
    }
  });

  it("protects foreign own defineTool accessor and proves getter is not invoked", async () => {
    const cwd = await project("foreign-accessor");
    const before = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    try {
      let getterInvoked = false;
      const accessorDescriptor = {
        get() {
          getterInvoked = true;
          return () => {};
        },
        configurable: true,
        enumerable: true
      };
      Object.defineProperty(globalThis, "defineTool", accessorDescriptor);

      delete (globalThis as any).__accessorEvalMarker;

      await writeTool(cwd, "ok.tool.js", `
        globalThis.__accessorEvalMarker = true;
        export default defineTool({ id: "accessor-tool", description: "desc", inputSchema: {}, run: () => "ok" });
      `);

      await expectLoadFailure(cwd, ErrorCode.TOOL_INVALID_DEFINITION);

      expect((globalThis as any).__accessorEvalMarker).toBeUndefined();
      expect(getterInvoked).toBe(false);

      const currentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
      expect(currentDescriptor).toBeDefined();
      expect(currentDescriptor!.get).toBeDefined();
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__accessorEvalMarker;
      if (before) Object.defineProperty(globalThis, "defineTool", before);
      else delete (globalThis as any).defineTool;
    }
  });

  it("preserves candidate evaluation order matching discovery", async () => {
    const cwd = await project("candidate-order");
    const before = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    try {
      delete (globalThis as any).__evalEvents;

      await writeTool(cwd, "a-tool.tool.js", `
        if (!globalThis.__evalEvents) globalThis.__evalEvents = [];
        globalThis.__evalEvents.push("a-tool");
        export default defineTool({ id: "a-tool", description: "a", inputSchema: {}, run: () => "a" });
      `);
      await writeTool(cwd, "b-tool.tool.js", `
        if (!globalThis.__evalEvents) globalThis.__evalEvents = [];
        globalThis.__evalEvents.push("b-tool");
        export default defineTool({ id: "b-tool", description: "b", inputSchema: {}, run: () => "b" });
      `);

      const registry = await load(cwd);

      expect((globalThis as any).__evalEvents).toEqual(["a-tool", "b-tool"]);
      expect(registry.list().map(t => t.definition.id)).toEqual(["a-tool", "b-tool"]);
      expect(registry.require("a-tool").sourcePath).toContain("a-tool.tool.js");
      expect(registry.require("b-tool").sourcePath).toContain("b-tool.tool.js");

      expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__evalEvents;
      if (before) Object.defineProperty(globalThis, "defineTool", before);
      else delete (globalThis as any).defineTool;
    }
  });

  it("serializes same-process loads and releases the lock after a rejected load", async () => {
    const first = await project("lock-first");
    const second = await project("lock-second");
    await writeTool(first, "first.tool.js", `export default defineTool({ id: "first", description: "first", inputSchema: {}, run: () => "first" });`);
    await writeTool(second, "second.tool.js", `export default defineTool({ id: "second", description: "second", inputSchema: {}, run: () => "second" });`);

    const [one, two] = await Promise.all([load(first), load(second)]);
    expect(one.has("first")).toBe(true);
    expect(two.has("second")).toBe(true);
    await assertToolsDirectoryIntact(first);
    await assertToolsDirectoryIntact(second);

    await fs.rm(path.join(first, ".open-dynamic-workflow", "tools", "first.tool.js"));
    await writeTool(first, "reject.tool.js", `throw new Error("reject lock");`);
    await expectLoadFailure(first);
    await assertToolsDirectoryIntact(first);

    const recovered = await load(second);
    expect(recovered.has("second")).toBe(true);
    await assertToolsDirectoryIntact(second);
  });
});

describe("Group 3: Validation and cleanup failures", () => {
  it("rejects malformed JS/TS syntax with no evaluation", async () => {
    const cwd = await project("fail-syntax");
    try {
      delete (globalThis as any).__malformedEval;

      await writeTool(cwd, "malformed.tool.js", `
        globalThis.__malformedEval = true;
        const = 1;
      `);

      const error = await expectLoadFailure(cwd, ErrorCode.TOOL_INVALID_DEFINITION);
      expect(error.message).toContain("malformed.tool.js");
      expect((globalThis as any).__malformedEval).toBeUndefined();
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__malformedEval;
    }
  });

  it("rejects definition missing a required field with no evaluation", async () => {
    const cwd = await project("fail-missing");
    try {
      delete (globalThis as any).__missingFieldEval;

      await writeTool(cwd, "missing-field.tool.js", `
        globalThis.__missingFieldEval = true;
        export default defineTool({
          id: "missing-field",
          description: "missing",
          run: () => {}
        });
      `);

      const error = await expectLoadFailure(cwd, ErrorCode.TOOL_INVALID_DEFINITION);
      expect(error.message).toContain("missing-field.tool.js");
      expect(error.message).toContain("inputSchema");
      expect((globalThis as any).__missingFieldEval).toBeUndefined();
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__missingFieldEval;
    }
  });

  it("rejects unbranded definition produced by local fake defineTool after evaluation", async () => {
    const cwd = await project("fail-unbranded");
    try {
      delete (globalThis as any).__fakeBrandEval;

      await writeTool(cwd, "fake-brand.tool.js", `
        globalThis.__fakeBrandEval = true;
        function defineTool(def) { return def; }
        export default defineTool({
          id: "fake-brand",
          description: "fake brand",
          inputSchema: {},
          run: () => {}
        });
      `);

      const error = await expectLoadFailure(cwd, ErrorCode.TOOL_INVALID_DEFINITION);
      expect(error.message).toContain("fake-brand.tool.js");
      expect((globalThis as any).__fakeBrandEval).toBe(true);
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__fakeBrandEval;
    }
  });

  it("rejects static/runtime definition mismatch after evaluation", async () => {
    const cwd = await project("fail-mismatch");
    try {
      delete (globalThis as any).__mismatchEval;

      await writeTool(cwd, "mismatch.tool.js", `
        globalThis.__mismatchEval = true;
        const meta = { id: "mismatched-id" };
        meta.id = "mutated-id";
        export default defineTool({
          id: meta.id,
          description: "desc",
          inputSchema: {},
          run: () => {}
        });
      `);

      const error = await expectLoadFailure(cwd, ErrorCode.TOOL_INVALID_DEFINITION);
      expect(error.message).toContain("mismatch.tool.js");
      expect((globalThis as any).__mismatchEval).toBe(true);
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__mismatchEval;
    }
  });

  it("rejects duplicate IDs before evaluation", async () => {
    const cwd = await project("fail-duplicate");
    try {
      delete (globalThis as any).__dupOneEval;
      delete (globalThis as any).__dupTwoEval;

      await writeTool(cwd, "one.tool.js", `
        globalThis.__dupOneEval = true;
        export default defineTool({
          id: "duplicate-id",
          description: "one",
          inputSchema: {},
          run: () => {}
        });
      `);
      await writeTool(cwd, "two.tool.js", `
        globalThis.__dupTwoEval = true;
        export default defineTool({
          id: "duplicate-id",
          description: "two",
          inputSchema: {},
          run: () => {}
        });
      `);

      const error = await expectLoadFailure(cwd, ErrorCode.TOOL_DUPLICATE_DEFINITION);
      expect(error.message).toContain("one.tool.js");
      expect(error.message).toContain("two.tool.js");
      expect((globalThis as any).__dupOneEval).toBeUndefined();
      expect((globalThis as any).__dupTwoEval).toBeUndefined();
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__dupOneEval;
      delete (globalThis as any).__dupTwoEval;
    }
  });

  it("rejects invalid JSON Schema with no evaluation", async () => {
    const cwd = await project("fail-schema");
    try {
      delete (globalThis as any).__invalidSchemaEval;

      await writeTool(cwd, "invalid-schema.tool.js", `
        globalThis.__invalidSchemaEval = true;
        export default defineTool({
          id: "invalid-schema",
          description: "invalid",
          inputSchema: { type: "not-a-valid-type" },
          run: () => {}
        });
      `);

      const error = await expectLoadFailure(cwd, ErrorCode.TOOL_INVALID_DEFINITION);
      expect(error.message).toContain("invalid-schema.tool.js");
      expect(error.message).toContain("inputSchema");
      expect((globalThis as any).__invalidSchemaEval).toBeUndefined();
      await assertToolsDirectoryIntact(cwd);
    } finally {
      delete (globalThis as any).__invalidSchemaEval;
    }
  });
});
