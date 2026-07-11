import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { loadToolRegistry } from "../../src/tools/load.js";
import { ErrorCode } from "../../src/errors/codes.js";

const projects: string[] = [];

async function makeProject(prefix: string) {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), `odw-acceptance-${prefix}-`));
  projects.push(cwd);
  await fs.mkdir(path.join(cwd, ".open-dynamic-workflow", "tools"), { recursive: true });
  return cwd;
}

async function addTool(cwd: string, name: string, source: string) {
  const file = path.join(cwd, ".open-dynamic-workflow", "tools", name);
  await fs.writeFile(file, source);
  return file;
}

describe("Phase 1: Host-Provided Global Runtime Loading and Compatibility AAA Acceptance Tests", () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Snapshot the globalThis.defineTool own descriptor before mutation
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    // Clear any leftover state
    // @ts-ignore
    delete globalThis.__evalOrderAcceptance;
  });

  afterEach(async () => {
    // Restore the original global descriptor
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "defineTool", originalDescriptor);
    } else {
      // @ts-ignore
      delete globalThis.defineTool;
    }

    // Clean up temporary project directories
    for (const cwd of projects.splice(0)) {
      await fs.rm(cwd, { recursive: true, force: true });
    }

    // @ts-ignore
    delete globalThis.__evalOrderAcceptance;
  });

  it("AT-01: loads no-import JavaScript and legacy ODW import tools in zero-install workspace (AC-08, AC-10, AC-14, AC-15)", async () => {
    // -----------------------------------------------------------------
    // Arrange: Set up isolated, zero-install workspace directory with
    // temporary files for no-import JS and legacy ODW import tools.
    // Ensure no local package.json or node_modules exists.
    // -----------------------------------------------------------------
    const cwd = await makeProject("js-legacy");
    
    await addTool(cwd, "no-import.tool.js", `
      export default defineTool({
        id: "no-import-js-tool",
        description: "Global JavaScript tool",
        inputSchema: { type: "object" },
        run: async () => ({ ok: true, type: "no-import" })
      });
    `);

    await addTool(cwd, "legacy-import.tool.js", `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "legacy-import-js-tool",
        description: "Legacy import tool",
        inputSchema: { type: "object" },
        run: async () => ({ ok: true, type: "legacy" })
      });
    `);

    // Ensure it's zero-install
    await expect(fs.stat(path.join(cwd, "package.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, "node_modules"))).rejects.toThrow();

    // -----------------------------------------------------------------
    // Act: Invoke loadToolRegistry to load the tools
    // -----------------------------------------------------------------
    const registry = await loadToolRegistry({
      cwd,
      dir: ".open-dynamic-workflow/tools",
      maxDefinitions: 10
    });

    // -----------------------------------------------------------------
    // Assert: Verify that definitions are successfully branded and loaded,
    // and execution produces the correct outcome.
    // -----------------------------------------------------------------
    expect(registry.list().map(tool => tool.definition.id).sort()).toEqual([
      "legacy-import-js-tool",
      "no-import-js-tool"
    ]);

    const noImportTool = registry.require("no-import-js-tool");
    const legacyTool = registry.require("legacy-import-js-tool");

    const BRAND = Symbol.for("open-dynamic-workflow.toolDefinition");
    expect((noImportTool.definition as any)[BRAND]).toBe(true);
    expect((legacyTool.definition as any)[BRAND]).toBe(true);

    const noImportRes = await noImportTool.definition.run({}, {} as any);
    const legacyRes = await legacyTool.definition.run({}, {} as any);

    expect(noImportRes).toEqual({ ok: true, type: "no-import" });
    expect(legacyRes).toEqual({ ok: true, type: "legacy" });

    // Verify loader-created temp shim is cleaned up
    const tempRoot = path.join(cwd, ".open-dynamic-workflow", "tmp");
    await expect(fs.stat(tempRoot)).rejects.toThrow();
  });

  it("AT-02: loads no-import TypeScript tools via transpilation path (AC-09, AC-14, AC-15)", async () => {
    // -----------------------------------------------------------------
    // Arrange: Set up isolated, zero-install workspace directory with
    // a temporary file for no-import TypeScript tool with TS-specific types.
    // -----------------------------------------------------------------
    const cwd = await makeProject("ts-no-import");

    await addTool(cwd, "no-import.tool.ts", `
      interface ToolInput {
        value: string;
      }
      export default defineTool<ToolInput, { ok: boolean; value: string }>({
        id: "no-import-ts-tool",
        description: "Global TypeScript tool",
        inputSchema: { type: "object" },
        run: async (input: ToolInput) => ({ ok: true, value: input.value })
      });
    `);

    // Ensure it's zero-install
    await expect(fs.stat(path.join(cwd, "package.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, "node_modules"))).rejects.toThrow();

    // -----------------------------------------------------------------
    // Act: Invoke loadToolRegistry to transpile and load the tool
    // -----------------------------------------------------------------
    const registry = await loadToolRegistry({
      cwd,
      dir: ".open-dynamic-workflow/tools",
      maxDefinitions: 10
    });

    // -----------------------------------------------------------------
    // Assert: Verify that definition is successfully loaded and executable,
    // and the temp files are cleaned up.
    // -----------------------------------------------------------------
    expect(registry.has("no-import-ts-tool")).toBe(true);

    const tsTool = registry.require("no-import-ts-tool");
    const BRAND = Symbol.for("open-dynamic-workflow.toolDefinition");
    expect((tsTool.definition as any)[BRAND]).toBe(true);

    const res = await tsTool.definition.run({ value: "hello-ts" }, {} as any);
    expect(res).toEqual({ ok: true, value: "hello-ts" });

    // Verify temp files inside .open-dynamic-workflow are cleaned up
    const tempRoot = path.join(cwd, ".open-dynamic-workflow", "tmp");
    await expect(fs.stat(tempRoot)).rejects.toThrow();
  });

  it("AT-03: rejects accessor and foreign collisions before candidate evaluation (AC-05)", async () => {
    // -----------------------------------------------------------------
    // Arrange: Set up isolated directory, and write a candidate tool
    // file with an evaluation marker. Snapshot and set a foreign data
    // or accessor property on globalThis.defineTool.
    // -----------------------------------------------------------------
    const cwd = await makeProject("collisions");
    const markerFile = path.join(cwd, "eval.marker");

    await addTool(cwd, "tool.js", `
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "evaluated");
      export default defineTool({
        id: "collision-tool",
        description: "description",
        inputSchema: {},
        run: () => {}
      });
    `);

    // Inject foreign accessor descriptor to trigger collision
    let getterInvoked = false;
    const foreignVal = () => "foreign";
    Object.defineProperty(globalThis, "defineTool", {
      get: () => {
        getterInvoked = true;
        return foreignVal;
      },
      configurable: true,
      enumerable: true
    });

    // Ensure descriptor is as defined before load
    const initialDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(initialDesc).toBeDefined();
    expect(initialDesc?.get).toBeDefined();

    // -----------------------------------------------------------------
    // Act: Invoke loadToolRegistry which should reject the collision
    // -----------------------------------------------------------------
    let error: any;
    try {
      await loadToolRegistry({
        cwd,
        dir: ".open-dynamic-workflow/tools",
        maxDefinitions: 10
      });
    } catch (caught) {
      error = caught;
    }

    // -----------------------------------------------------------------
    // Assert: Verify collision is rejected with TOOL_INVALID_DEFINITION,
    // the evaluation marker is NOT written, the original global descriptor
    // is preserved, and the getter was not invoked during check (or at least
    // mutation didn't occur).
    // -----------------------------------------------------------------
    expect(error).toBeDefined();
    expect(error.code).toBe(ErrorCode.TOOL_INVALID_DEFINITION);
    expect(error.message).toContain("Cannot install the active tool runtime");

    // Accessor getter must not be invoked during check
    expect(getterInvoked).toBe(false);

    // Evaluation marker must not exist (proving module code did not execute)
    const markerExists = await fs.stat(markerFile).then(() => true).catch(() => false);
    expect(markerExists).toBe(false);

    // Verify original descriptor is preserved
    const currentDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(currentDesc).toBeDefined();
    expect(currentDesc?.get).toBeDefined();
  });

  it("AT-04: serializes concurrent loadToolRegistry calls without interleaving (AC-11)", async () => {
    // -----------------------------------------------------------------
    // Arrange: Create two separate workspace directories with two tools each.
    // Each tool writes its ID to a global evaluation list when executed/imported.
    // -----------------------------------------------------------------
    const wsA = await makeProject("concurrent-a");
    const wsB = await makeProject("concurrent-b");

    await addTool(wsA, "toolA1.js", `
      globalThis.__evalOrderAcceptance = globalThis.__evalOrderAcceptance || [];
      globalThis.__evalOrderAcceptance.push("A1");
      export default defineTool({ id: "toolA1", description: "desc", inputSchema: {}, run: () => {} });
    `);
    await addTool(wsA, "toolA2.js", `
      globalThis.__evalOrderAcceptance = globalThis.__evalOrderAcceptance || [];
      globalThis.__evalOrderAcceptance.push("A2");
      export default defineTool({ id: "toolA2", description: "desc", inputSchema: {}, run: () => {} });
    `);

    await addTool(wsB, "toolB1.js", `
      globalThis.__evalOrderAcceptance = globalThis.__evalOrderAcceptance || [];
      globalThis.__evalOrderAcceptance.push("B1");
      export default defineTool({ id: "toolB1", description: "desc", inputSchema: {}, run: () => {} });
    `);
    await addTool(wsB, "toolB2.js", `
      globalThis.__evalOrderAcceptance = globalThis.__evalOrderAcceptance || [];
      globalThis.__evalOrderAcceptance.push("B2");
      export default defineTool({ id: "toolB2", description: "desc", inputSchema: {}, run: () => {} });
    `);

    // -----------------------------------------------------------------
    // Act: Run both loadToolRegistry sessions concurrently in a Promise.all
    // -----------------------------------------------------------------
    const [regA, regB] = await Promise.all([
      loadToolRegistry({ cwd: wsA, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 }),
      loadToolRegistry({ cwd: wsB, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 })
    ]);

    // -----------------------------------------------------------------
    // Assert: Verify both load operations completed successfully and
    // imports did not interleave (meaning all of A finished before B,
    // or all of B finished before A).
    // -----------------------------------------------------------------
    expect(regA.has("toolA1")).toBe(true);
    expect(regA.has("toolA2")).toBe(true);
    expect(regB.has("toolB1")).toBe(true);
    expect(regB.has("toolB2")).toBe(true);

    const evalOrder = (globalThis as any).__evalOrderAcceptance as string[];
    expect(evalOrder).toBeDefined();
    expect(evalOrder).toHaveLength(4);

    // Order must be completely serialized: [A1, A2, B1, B2] or [B1, B2, A1, A2]
    const isSeqAFirst = evalOrder[0].startsWith("A") && evalOrder[1].startsWith("A") && evalOrder[2].startsWith("B") && evalOrder[3].startsWith("B");
    const isSeqBFirst = evalOrder[0].startsWith("B") && evalOrder[1].startsWith("B") && evalOrder[2].startsWith("A") && evalOrder[3].startsWith("A");

    expect(isSeqAFirst || isSeqBFirst).toBe(true);

    // Verify global descriptor is restored to original state (absent in this case)
    expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
  });

  it("AT-05: cleans up temporary shim and mirrored tools on success and import failure (AC-04, AC-15)", async () => {
    // -----------------------------------------------------------------
    // Arrange: Create a workspace directory without pre-creating .open-dynamic-workflow.
    // Create a success tool and a failing syntax-error tool candidate.
    // -----------------------------------------------------------------
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "odw-acceptance-cleanup-"));
    projects.push(cwd);
    const successToolsDir = path.join(cwd, "success");
    const failToolsDir = path.join(cwd, "fail");

    await fs.mkdir(successToolsDir, { recursive: true });
    await fs.mkdir(failToolsDir, { recursive: true });

    await fs.writeFile(
      path.join(successToolsDir, "good.js"),
      `export default defineTool({ id: "good", description: "desc", inputSchema: {}, run: () => "good" });`
    );

    await fs.writeFile(
      path.join(failToolsDir, "bad.js"),
      `export default defineTool({ id: "bad"` // deliberate syntax error
    );

    // -----------------------------------------------------------------
    // Act & Assert: Load success tools and verify cleanup
    // -----------------------------------------------------------------
    const successRegistry = await loadToolRegistry({
      cwd,
      dir: "success",
      maxDefinitions: 10
    });
    expect(successRegistry.has("good")).toBe(true);

    // Unique temporary root must be gone after success
    const odwDir = path.join(cwd, ".open-dynamic-workflow");
    const odwExistsSuccess = await fs.stat(odwDir).then(() => true).catch(() => false);
    expect(odwExistsSuccess).toBe(false);

    // -----------------------------------------------------------------
    // Act & Assert: Load failing tools and verify cleanup + descriptor restoration
    // -----------------------------------------------------------------
    let err: any;
    try {
      await loadToolRegistry({
        cwd,
        dir: "fail",
        maxDefinitions: 10
      });
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeDefined();

    // Unique temporary root must be gone after failure
    const odwExistsFailure = await fs.stat(odwDir).then(() => true).catch(() => false);
    expect(odwExistsFailure).toBe(false);

    // Original global descriptor must be restored
    expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
  });
});
