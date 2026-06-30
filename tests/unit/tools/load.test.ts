import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadToolRegistry } from "../../../src/tools/load.js";
import { compileResourceDiscovery } from "../../../src/discovery/compile-patterns.js";

describe("loadToolRegistry", () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-"));
  });

  afterEach(async () => {
    await rm(tempBaseDir, { recursive: true, force: true });
  });

  it("should return empty registry if directory is missing", async () => {
    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "non-existent",
      maxDefinitions: 10
    });
    expect(registry.list().length).toBe(0);
  });

  it("should discover only top-level supported files in canonical order (Case 13)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    await mkdir(join(toolsDir, "nested"));
    
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    const toolTemplate = (id: string) => `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "${id}", description: "${id}", inputSchema: {}, run: () => {} });
    `;

    await writeFile(join(toolsDir, "z.ts"), toolTemplate("z"));
    await writeFile(join(toolsDir, "a.js"), toolTemplate("a"));
    await writeFile(join(toolsDir, "c.mjs"), toolTemplate("c"));
    await writeFile(join(toolsDir, "ignored.txt"), "not a tool");
    await writeFile(join(toolsDir, "nested", "nested.ts"), toolTemplate("nested"));

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list[0].definition.id).toBe("a");
    expect(list[1].definition.id).toBe("c");
    expect(list[2].definition.id).toBe("z");
  });

  it("should load trusted tool modules that import Node APIs (Case 14)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    await writeFile(join(toolsDir, "node-tool.js"), `
      import { defineTool } from "${srcToolsPath}";
      import * as os from "node:os";
      import * as fs from "node:fs";
      export default defineTool({
        id: "node-tool",
        description: "node tool",
        inputSchema: { type: "object" },
        run: () => os.platform()
      });
    `);

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    expect(registry.has("node-tool")).toBe(true);
    // run has not been called
  });

  it("should reject malformed or unbranded module exports (Case 15)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    // No default export
    await writeFile(join(toolsDir, "no-export.js"), "export const x = 1;");
    
    const action = () => loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    await expect(action).rejects.toThrow(/does not have a valid default export/);
    try {
      await action();
    } catch (err: any) {
      expect(err.code).toBe("TOOL_INVALID_DEFINITION");
    }
  });

  it("should delegate duplicate IDs to registry validation (Case 16)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    const toolTemplate = (id: string) => `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "${id}", description: "d", inputSchema: {}, run: () => {} });
    `;

    await writeFile(join(toolsDir, "t1.ts"), toolTemplate("dup"));
    await writeFile(join(toolsDir, "t2.ts"), toolTemplate("dup"));

    await expect(loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    })).rejects.toThrow(/Duplicate tool ID 'dup'/);
  });

  it("should respect configured maxDefinitions before execution (Case 17)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    const toolTemplate = (id: string) => `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "${id}", description: "d", inputSchema: {}, run: () => {} });
    `;

    await writeFile(join(toolsDir, "t1.ts"), toolTemplate("t1"));
    await writeFile(join(toolsDir, "t2.ts"), toolTemplate("t2"));

    await expect(loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 1
    })).rejects.toThrow(/Too many tool definitions/);
  });

  it("should support sibling and nested helper imports and discover top-level files regardless of name (Issue 4, ISSUE-003)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);

    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    
    // Sibling helper in nested dir (recommended pattern)
    await mkdir(join(toolsDir, "utils"), { recursive: true });
    await writeFile(join(toolsDir, "utils", "helper.ts"), `
      export function add(a: number, b: number) { return a + b; }
    `);

    // Nested helper
    await mkdir(join(toolsDir, "nested"), { recursive: true });
    await writeFile(join(toolsDir, "nested", "format.ts"), `
      export function formatResult(val: number) { return "Result: " + val; }
    `);

    // Tool entry importing both helpers using .js extension
    await writeFile(join(toolsDir, "math.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import { add } from "./utils/helper.js";
      import { formatResult } from "./nested/format.js";
      export default defineTool({
        id: "math-tool",
        description: "adds numbers",
        inputSchema: {},
        run: () => formatResult(add(2, 3))
      });
    `);

    // Top-level file with 'helper' in name that IS a valid tool
    await writeFile(join(toolsDir, "github-helper.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({
        id: "github-tool",
        description: "gh",
        inputSchema: {},
        run: () => "ok"
      });
    `);

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    expect(registry.has("math-tool")).toBe(true);
    expect(registry.has("github-tool")).toBe(true);
    expect(registry.list().length).toBe(2);

    // Run the tool to verify helper imports are resolved at runtime
    const tool = registry.require("math-tool");
    const result = await tool.definition.run({}, {} as any);
    expect(result).toBe("Result: 5");
  });

  it("should support relative .js helper imports in .js tool files (WORKSTREAM-001)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);

    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    
    // JS helper
    await mkdir(join(toolsDir, "utils"), { recursive: true });
    await writeFile(join(toolsDir, "utils", "helper.js"), `
      export function getSecret() { return 42; }
    `);

    // JS tool importing JS helper
    await writeFile(join(toolsDir, "js-tool.js"), `
      import { defineTool } from "${srcToolsPath}";
      import { getSecret } from "./utils/helper.js";
      export default defineTool({
        id: "js-tool",
        description: "js tool",
        inputSchema: {},
        run: () => getSecret()
      });
    `);

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    expect(registry.has("js-tool")).toBe(true);
    const tool = registry.require("js-tool");
    const result = await tool.definition.run({}, {} as any);
    expect(result).toBe(42);
  });

  it("should fail to load if a top-level supported file is not a valid tool (ISSUE-003)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    await writeFile(join(toolsDir, "not-a-tool.ts"), "export const x = 1;");
    
    const action = () => loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    await expect(action).rejects.toThrow(/does not have a valid default export/);
  });



  it("precollected discovery policy blocks excluded helper imports with compiled glob semantics", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    await mkdir(join(toolsDir, "helpers"), { recursive: true });
    const markerFile = join(tempBaseDir, "excluded-helper.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

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
        discoveryPolicy: { exclude: compiledDiscovery.discovery.exclude }
      }
    });

    await expect(action).rejects.toThrow(/excluded by policy/);
    const { existsSync } = await import("node:fs");
    expect(existsSync(markerFile)).toBe(false);
  });

  it("precollected discovery policy blocks excluded helper imports using brace-expanded exclude pattern from compileResourceDiscovery", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    await mkdir(join(toolsDir, "private"), { recursive: true });
    const markerFile = join(tempBaseDir, "brace-excluded-helper.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "included.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import "./private/secret.js";
      export default defineTool({ id: "included-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    await writeFile(join(toolsDir, "private", "secret.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      export default defineTool({ id: "secret-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

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

    await expect(action).rejects.toThrow(/excluded by policy/);
    try {
      await action();
    } catch (err: any) {
      expect(err.code).toBe("SECURITY_POLICY_VIOLATION");
    }

    const { existsSync } = await import("node:fs");
    expect(existsSync(markerFile)).toBe(false);
  });
});
