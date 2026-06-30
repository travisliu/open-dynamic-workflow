import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink, unlink } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
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

    await expect(action).rejects.toThrow(/excluded by policy/);
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

  it("4. Broad runtime include patterns treat plain tool files as entrypoints", async () => {
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

    expect(registry.has("helper-tool")).toBe(true);
    expect(existsSync(markerFile)).toBe(true);
  });

  describe("Precollected Loader and Security Checks", () => {
    it("should load plain supported runtime file without .tool. marker when passed as precollected candidate", async () => {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir);
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
      await writeFile(join(toolsDir, "plain.ts"), `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({ id: "plain-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      const registry = await loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        precollected: {
          candidateFiles: [{
            relativePath: "tools/plain.ts",
            absolutePath: join(toolsDir, "plain.ts"),
            resourceType: "tool"
          }],
          discoveryPolicy: { exclude: [] }
        }
      });

      expect(registry.has("plain-tool")).toBe(true);
    });

    it("precollected wins over candidateFiles, discovery, and dir, and collector is not called", async () => {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir);
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
      await writeFile(join(toolsDir, "tool-a.ts"), `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({ id: "tool-a", description: "d", inputSchema: {}, run: () => {} });
      `);
      await writeFile(join(toolsDir, "tool-b.ts"), `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({ id: "tool-b", description: "d", inputSchema: {}, run: () => {} });
      `);

      const registry = await loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        candidateFiles: ["tools/tool-b.ts"],
        dir: "non-existent-dir",
        discovery: {
          include: ["non-existent-pattern"],
          exclude: [],
          compatibilityMode: "new-suffix-specific"
        },
        precollected: {
          candidateFiles: [{
            relativePath: "tools/tool-a.ts",
            absolutePath: join(toolsDir, "tool-a.ts"),
            resourceType: "tool"
          }],
          discoveryPolicy: { exclude: [] }
        }
      });

      expect(registry.has("tool-a")).toBe(true);
      expect(registry.has("tool-b")).toBe(false);
    });

    it("precollected candidates are sorted by relativePath", async () => {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir);
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
      await writeFile(join(toolsDir, "z.ts"), `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({ id: "z-tool", description: "d", inputSchema: {}, run: () => {} });
      `);
      await writeFile(join(toolsDir, "a.ts"), `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({ id: "a-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      const registry = await loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        precollected: {
          candidateFiles: [
            {
              relativePath: "tools/z.ts",
              absolutePath: join(toolsDir, "z.ts"),
              resourceType: "tool"
            },
            {
              relativePath: "tools/a.ts",
              absolutePath: join(toolsDir, "a.ts"),
              resourceType: "tool"
            }
          ],
          discoveryPolicy: { exclude: [] }
        }
      });

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list[0].definition.id).toBe("a-tool");
      expect(list[1].definition.id).toBe("z-tool");
    });

    it("maxDefinitions still applies to precollected candidates", async () => {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir);
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
      await writeFile(join(toolsDir, "a.ts"), `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({ id: "a-tool", description: "d", inputSchema: {}, run: () => {} });
      `);
      await writeFile(join(toolsDir, "b.ts"), `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({ id: "b-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      const action = () => loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 1,
        precollected: {
          candidateFiles: [
            { relativePath: "tools/a.ts", absolutePath: join(toolsDir, "a.ts"), resourceType: "tool" },
            { relativePath: "tools/b.ts", absolutePath: join(toolsDir, "b.ts"), resourceType: "tool" }
          ],
          discoveryPolicy: { exclude: [] }
        }
      });

      await expect(action).rejects.toThrow(/Maximum allowed is 1/);
    });

    it("outside-workspace and symlink-escape precollected candidates throw SECURITY_POLICY_VIOLATION", async () => {
      const outsideFile = join(outsideDir, "outside.ts");
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
      await writeFile(outsideFile, `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({ id: "outside-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      const action = () => loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        precollected: {
          candidateFiles: [{
            relativePath: "../outside.ts",
            absolutePath: outsideFile,
            resourceType: "tool"
          }],
          discoveryPolicy: { exclude: [] }
        }
      });

      await expect(action).rejects.toThrow(/points outside the workspace/);
    });

    it("included tool importing an excluded helper fails through precollected.discoveryPolicy.exclude and side-effect does not run", async () => {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir);
      const markerFile = join(tempBaseDir, "precollected-excluded-helper.marker");
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

      await writeFile(join(toolsDir, "included.ts"), `
        import { defineTool } from "${srcToolsPath}";
        import "./excluded.js";
        export default defineTool({ id: "included-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      await writeFile(join(toolsDir, "excluded.ts"), `
        import { defineTool } from "${srcToolsPath}";
        import * as fs from "node:fs";
        fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
        export default defineTool({ id: "excluded-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      const action = () => loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        precollected: {
          candidateFiles: [
            { relativePath: "tools/included.ts", absolutePath: join(toolsDir, "included.ts"), resourceType: "tool" }
          ],
          discoveryPolicy: {
            exclude: [{
              pattern: "tools/excluded.ts",
              normalizedPattern: "tools/excluded.ts",
              source: "config"
            }]
          }
        }
      });

      await expect(action).rejects.toThrow(/excluded by policy/);
      expect(existsSync(markerFile)).toBe(false);
    });

    it("included tool importing ../../outside/outside.js fails with SECURITY_POLICY_VIOLATION (legacy path)", async () => {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir);
      const markerFile = join(tempBaseDir, "outside-helper.marker");
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

      await writeFile(join(toolsDir, "included.ts"), `
        import { defineTool } from "${srcToolsPath}";
        import "../../outside.js";
        export default defineTool({ id: "included-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      const resolvedOutsidePath = join(dirname(tempBaseDir), "outside.js");
      await writeFile(resolvedOutsidePath, `
        import * as fs from "node:fs";
        fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      `);

      const action = () => loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        discovery: {
          include: ["tools/included.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific"
        }
      });

      await expect(action).rejects.toThrow(/points outside the workspace/);
      expect(existsSync(markerFile)).toBe(false);
      await rm(resolvedOutsidePath, { force: true });
    });

    it("included tool importing ../../outside/outside.js fails with SECURITY_POLICY_VIOLATION (precollected path)", async () => {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir);
      const markerFile = join(tempBaseDir, "outside-helper-precollected.marker");
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

      await writeFile(join(toolsDir, "included.ts"), `
        import { defineTool } from "${srcToolsPath}";
        import "../../outside2.js";
        export default defineTool({ id: "included-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      const resolvedOutsidePath = join(dirname(tempBaseDir), "outside2.js");
      await writeFile(resolvedOutsidePath, `
        import * as fs from "node:fs";
        fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      `);

      const action = () => loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        precollected: {
          candidateFiles: [
            { relativePath: "tools/included.ts", absolutePath: join(toolsDir, "included.ts"), resourceType: "tool" }
          ],
          discoveryPolicy: { exclude: [] }
        }
      });

      await expect(action).rejects.toThrow(/points outside the workspace/);
      expect(existsSync(markerFile)).toBe(false);
      await rm(resolvedOutsidePath, { force: true });
    });
  });
});
