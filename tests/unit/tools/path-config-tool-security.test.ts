import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { loadToolRegistry } from "../../../src/tools/load.js";

describe("Tool Loader Security - Unit Tests", () => {
  let tempBaseDir: string;
  let outsideDir: string;
  let symlinksSupported = true;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "odw-tool-sec-unit-"));
    outsideDir = await mkdtemp(join(tmpdir(), "odw-tool-sec-unit-outside-"));
    try {
      const testLink = join(tempBaseDir, "test-symlink-support");
      await symlink("target", testLink);
      await unlink(testLink);
    } catch {
      symlinksSupported = false;
    }
  });

  afterEach(async () => {
    await rm(tempBaseDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("1. Excluded tool files are not imported (asserting via side-effect marker)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const markerFile = join(tempBaseDir, "excluded-side-effect.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "safe.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "safe-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    await writeFile(join(toolsDir, "excluded.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      export default defineTool({ id: "excluded-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      maxDefinitions: 10,
      discovery: {
        include: ["tools/safe.tool.ts", "tools/excluded.tool.ts"],
        exclude: ["tools/excluded.tool.ts"],
        compatibilityMode: "new-suffix-specific",
      }
    });

    expect(registry.has("safe-tool")).toBe(true);
    expect(registry.has("excluded-tool")).toBe(false);
    expect(existsSync(markerFile)).toBe(false);
  });

  it("2. Excluded tool imported by an included tool does not execute silently and fails loading", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const markerFile = join(tempBaseDir, "excluded-import-side-effect.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "safe.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import "./excluded.tool.js";
      export default defineTool({ id: "safe-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    await writeFile(join(toolsDir, "excluded.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      export default defineTool({ id: "excluded-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    const action = () => loadToolRegistry({
      cwd: tempBaseDir,
      maxDefinitions: 10,
      discovery: {
        include: ["tools/safe.tool.ts", "tools/excluded.tool.ts"],
        exclude: ["tools/excluded.tool.ts"],
        compatibilityMode: "new-suffix-specific",
      }
    });

    await expect(action).rejects.toThrow(/Failed to load tool definition/);
    expect(existsSync(markerFile)).toBe(false);
  });

  it("3. Symlinked tool escaping cwd is rejected before import and does not execute", async () => {
    if (!symlinksSupported) {
      console.warn("Skipping symlink test because platform does not support symlinks.");
      return;
    }

    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);

    const markerFile = join(tempBaseDir, "symlink-side-effect.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    // Write a real tool file OUTSIDE the workspace
    const outsideToolFile = join(outsideDir, "escaped.tool.ts");
    await writeFile(outsideToolFile, `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      export default defineTool({ id: "escaped-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    // Symlink it inside the tools directory
    const symlinkPath = join(toolsDir, "escaped.tool.ts");
    await symlink(outsideToolFile, symlinkPath);

    // Call tool loader with discovery matching the symlink
    const action = () => loadToolRegistry({
      cwd: tempBaseDir,
      maxDefinitions: 10,
      discovery: {
        include: ["tools/escaped.tool.ts"],
        exclude: [],
        compatibilityMode: "new-suffix-specific",
      }
    });

    // Should reject symlink pointing outside the workspace before importing it
    await expect(action).rejects.toThrow(/points outside the workspace/);
    expect(existsSync(markerFile)).toBe(false);
  });

  it("4. Helper file in directory with .tool. in name is not loaded in suffix-specific mode", async () => {
    const toolHelpersDir = join(tempBaseDir, "my.tool.helpers");
    await mkdir(toolHelpersDir);
    const markerFile = join(tempBaseDir, "helper-side-effect.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolHelpersDir, "helper.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      export default defineTool({ id: "helper-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      maxDefinitions: 10,
      discovery: {
        include: ["**/*.ts"],
        exclude: [],
        compatibilityMode: "new-suffix-specific",
      }
    });

    expect(registry.has("helper-tool")).toBe(false);
    expect(existsSync(markerFile)).toBe(false);
  });
});
