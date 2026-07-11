import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { loadToolRegistry } from "../../src/tools/load.js";

const projects: string[] = [];

async function makeProject(prefix: string) {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), `odw-resolution-${prefix}-`));
  projects.push(cwd);
  await fs.mkdir(path.join(cwd, ".open-dynamic-workflow", "tools"), { recursive: true });
  return cwd;
}

async function addTool(cwd: string, name: string, source: string) {
  const file = path.join(cwd, ".open-dynamic-workflow", "tools", name);
  await fs.writeFile(file, source);
  return file;
}

afterEach(async () => {
  for (const cwd of projects.splice(0)) await fs.rm(cwd, { recursive: true, force: true });
});

describe("tool runtime resolution compatibility", () => {
  it("loads no-import and legacy-import tools in a workspace with no manifest or dependencies", async () => {
    const cwd = await makeProject("zero-install");
    await addTool(cwd, "no-import.tool.js", `export default defineTool({ id: "no-import", description: "no import", inputSchema: {}, run: () => "no-import" });`);
    await addTool(cwd, "legacy.tool.js", `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({ id: "legacy-import", description: "legacy import", inputSchema: {}, run: () => "legacy" });
    `);

    const registry = await loadToolRegistry({ cwd, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 });
    expect(registry.list().map(tool => tool.definition.id)).toEqual(["legacy-import", "no-import"]);
    expect(await registry.require("legacy-import").definition.run({}, {} as any)).toBe("legacy");
    await expect(fs.stat(path.join(cwd, "package.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, "node_modules"))).rejects.toThrow();
  });

  it("uses the active runtime despite a conflicting local package and preserves ordinary relative imports", async () => {
    const cwd = await makeProject("collision");
    const packageDir = path.join(cwd, "node_modules", "@travisliu", "open-dynamic-workflow");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({ name: "@travisliu/open-dynamic-workflow", type: "module" }));
    await fs.writeFile(path.join(packageDir, "index.js"), `export function defineTool(definition) { return { ...definition, id: "wrong-local-runtime" }; }`);
    await fs.writeFile(path.join(cwd, ".open-dynamic-workflow", "tools", "helper.js"), `export const suffix = "ordinary-import";`);
    await addTool(cwd, "collision.tool.js", `
      import { suffix } from "./helper.js";
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({ id: "active-runtime", description: "ordinary-import", inputSchema: {}, run: () => suffix });
    `);

    const registry = await loadToolRegistry({
      cwd,
      maxDefinitions: 10,
      precollected: {
        candidateFiles: [
          {
            resourceType: "tool",
            absolutePath: path.join(cwd, ".open-dynamic-workflow", "tools", "collision.tool.js"),
            relativePath: ".open-dynamic-workflow/tools/collision.tool.js",
            realPath: path.join(cwd, ".open-dynamic-workflow", "tools", "collision.tool.js"),
            sourcePattern: ".open-dynamic-workflow/tools/collision.tool.js",
            sourceConfigPath: "tools.include[0]",
            source: "config"
          }
        ],
        discoveryPolicy: {
          exclude: []
        }
      }
    });
    const tool = registry.require("active-runtime");
    expect(tool.sourcePath).toContain("collision.tool.js");
    expect(await tool.definition.run({}, {} as any)).toBe("ordinary-import");
    expect(registry.has("wrong-local-runtime")).toBe(false);
  });

  it("supports a non-Node manifest without making ODW a target dependency", async () => {
    const cwd = await makeProject("manifest");
    await fs.writeFile(path.join(cwd, "deno.json"), JSON.stringify({ name: "tool-project" }));
    await addTool(cwd, "manifest.tool.ts", `
      export default defineTool({
        id: "manifest-tool",
        description: "manifest tool",
        inputSchema: { type: "object" },
        run: () => ({ ok: true })
      });
    `);
    const registry = await loadToolRegistry({ cwd, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 });
    expect(await registry.require("manifest-tool").definition.run({}, {} as any)).toEqual({ ok: true });
    await expect(fs.stat(path.join(cwd, "package.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, "node_modules"))).rejects.toThrow();
  });
});
