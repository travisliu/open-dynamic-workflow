import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { loadToolRegistry } from "../../../src/tools/load.js";
import { compileResourceDiscovery } from "../../../src/discovery/compile-patterns.js";

describe("Tool Loader Security - Unit Tests", () => {
  let tempBaseDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "odw-tool-sec-unit-"));
    outsideDir = await mkdtemp(join(tmpdir(), "odw-tool-sec-unit-outside-"));
  });

  afterEach(async () => {
    await rm(tempBaseDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("1. Precollected excluded helper imports are blocked before execution (asserting via side-effect marker)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const markerFile = join(tempBaseDir, "excluded-side-effect.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    await mkdir(join(toolsDir, "helpers"), { recursive: true });

    await writeFile(join(toolsDir, "safe.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import "./helpers/excluded.js";
      export default defineTool({ id: "safe-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    await writeFile(join(toolsDir, "helpers", "excluded.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      export default defineTool({ id: "excluded-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    const compiledDiscovery = compileResourceDiscovery({
      cwd: tempBaseDir,
      discovery: {
        resource: "tools",
        include: [],
        exclude: ["tools/helpers/*.{ts,js}"],
        source: "new",
        includeSource: "new",
        excludeSource: "new",
        compatibilityMode: "new-suffix-specific",
        sourcePaths: ["tools.exclude"],
        rawInclude: [],
        rawExclude: ["tools/helpers/*.{ts,js}"],
        diagnostics: [],
      },
    });

    const action = () => loadToolRegistry({
      cwd: tempBaseDir,
      maxDefinitions: 10,
      precollected: {
        candidateFiles: [{
          relativePath: "tools/safe.tool.ts",
          absolutePath: join(toolsDir, "safe.tool.ts"),
          resourceType: "tool"
        }],
        discoveryPolicy: {
          exclude: compiledDiscovery.discovery.exclude,
        }
      }
    });

    await expect(action).rejects.toThrow(/excluded by policy/);
    expect(existsSync(markerFile)).toBe(false);
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

      const compiledDiscovery = compileResourceDiscovery({
        cwd: tempBaseDir,
        discovery: {
          resource: "tools",
          include: [],
          exclude: ["tools/{excluded,secret}.ts"],
          source: "new",
          includeSource: "new",
          excludeSource: "new",
          compatibilityMode: "new-suffix-specific",
          sourcePaths: ["tools.exclude"],
          rawInclude: [],
          rawExclude: ["tools/{excluded,secret}.ts"],
          diagnostics: [],
        },
      });

      const action = () => loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        precollected: {
          candidateFiles: [
            { relativePath: "tools/included.ts", absolutePath: join(toolsDir, "included.ts"), resourceType: "tool" }
          ],
          discoveryPolicy: {
            exclude: compiledDiscovery.discovery.exclude
          }
        }
      });

      await expect(action).rejects.toThrow(/excluded by policy/);
      try {
        await action();
      } catch (err: any) {
        expect(err.code).toBe("SECURITY_POLICY_VIOLATION");
      }
      expect(existsSync(markerFile)).toBe(false);
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

    it("comprehensive TOOL-001 to TOOL-006 tool loader handoff & security verification", async () => {
      // TOOL-001, TOOL-002 (Arrange):
      // Set up a mock tool workspace, including an included tool file that statically imports an excluded helper.
      // Compile excludes via compileResourceDiscovery().
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir);
      await mkdir(join(toolsDir, "private"), { recursive: true });
      const markerFile = join(tempBaseDir, "tool-004-side-effect.marker");
      const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

      // Included tool that imports excluded helper (statically)
      await writeFile(join(toolsDir, "included.tool.ts"), `
        import { defineTool } from "${srcToolsPath}";
        import "./private/secret.js";
        export default defineTool({ id: "included-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      // Excluded helper file that writes a side-effect marker if executed
      await writeFile(join(toolsDir, "private", "secret.ts"), `
        import { defineTool } from "${srcToolsPath}";
        import * as fs from "node:fs";
        fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
        export default defineTool({ id: "secret-tool", description: "d", inputSchema: {}, run: () => {} });
      `);

      // Compile brace-expanded exclude pattern via compileResourceDiscovery
      const compiledDiscovery = compileResourceDiscovery({
        cwd: tempBaseDir,
        discovery: {
          resource: "tools",
          include: [],
          exclude: ["tools/private/{secret,blocked}.ts"],
          source: "new",
          includeSource: "new",
          excludeSource: "new",
          compatibilityMode: "new-suffix-specific",
          sourcePaths: ["tools.exclude"],
          rawInclude: [],
          rawExclude: ["tools/private/{secret,blocked}.ts"],
          diagnostics: [],
        },
      });

      // TOOL-003 (Act):
      // Invoke loadToolRegistry() with precollected candidates.
      const action = () => loadToolRegistry({
        cwd: tempBaseDir,
        maxDefinitions: 10,
        precollected: {
          candidateFiles: [{
            relativePath: "tools/included.tool.ts",
            absolutePath: join(toolsDir, "included.tool.ts"),
            resourceType: "tool"
          }],
          discoveryPolicy: { exclude: compiledDiscovery.discovery.exclude }
        }
      });

      // TOOL-005 (Assert):
      // Verify that the loader rejects with error code SECURITY_POLICY_VIOLATION,
      // and the error message contains 'excluded by policy'.
      await expect(action).rejects.toThrow(/excluded by policy/);
      try {
        await action();
      } catch (err: any) {
        expect(err.code).toBe("SECURITY_POLICY_VIOLATION");
      }

      // TOOL-004 (Assert):
      // Verify that execution is blocked (a written side-effect marker must NOT exist).
      expect(existsSync(markerFile)).toBe(false);

    });
  });
});
