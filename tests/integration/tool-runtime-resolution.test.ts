import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

import { loadToolRegistry } from "../../src/tools/load.js";
import { isDefinedTool } from "../../src/tools/define-tool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const lockPath = path.join(repoRoot, "tests", "packed-cli-build.lock");

import { acquireLock, releaseLock } from "../lock-helper.js";

const projects: string[] = [];


interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runFile(
  file: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<RunResult> {
  const env = { ...process.env, ...options.env };
  // Ensure the spawned process does not think it runs in a vitest/test environment
  // so it correctly runs cleanup actions designed for non-test environments.
  delete env.VITEST;
  delete env.NODE_ENV;

  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (error as any).code ?? 1 : 0,
          stdout,
          stderr
        });
      }
    );
  });
}

async function makeProject(prefix: string) {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), `odw-resolution-${prefix}-`));
  
  // Assert path is outside repository ancestry
  const relative = path.relative(repoRoot, cwd);
  expect(relative.startsWith("..")).toBe(true);
  expect(path.isAbsolute(relative)).toBe(false);

  projects.push(cwd);
  await fs.mkdir(path.join(cwd, ".open-dynamic-workflow", "tools"), { recursive: true });
  return cwd;
}

async function addTool(cwd: string, name: string, source: string) {
  const file = path.join(cwd, ".open-dynamic-workflow", "tools", name);
  await fs.writeFile(file, source);
  return file;
}

async function assertTmpAbsent(cwd: string) {
  const tmpPath = path.join(cwd, ".open-dynamic-workflow", "tmp");
  const toolsPath = path.join(cwd, ".open-dynamic-workflow", "tools");
  
  // Tmp must be absent
  await expect(fs.access(tmpPath)).rejects.toThrow();
  // Tools directory must still exist
  await expect(fs.access(toolsPath)).resolves.not.toThrow();
}

afterEach(async () => {
  for (const cwd of projects.splice(0)) {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

describe("tool runtime resolution compatibility", () => {
  it("loads no-import and legacy-import tools in a workspace with no manifest or dependencies", async () => {
    const cwd = await makeProject("zero-install");
    await addTool(cwd, "no-import.tool.js", `
      export default defineTool({
        id: "no-import",
        description: "no import",
        inputSchema: {},
        run: () => "no-import"
      });
    `);
    await addTool(cwd, "legacy.tool.js", `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "legacy-import",
        description: "legacy import",
        inputSchema: {},
        run: () => "legacy"
      });
    `);

    const registry = await loadToolRegistry({ cwd, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 });
    
    // Assert both forms load and execute
    const tools = registry.list().map(tool => tool.definition.id).sort();
    expect(tools).toEqual(["legacy-import", "no-import"]);

    const noImportTool = registry.require("no-import");
    const legacyTool = registry.require("legacy-import");

    expect(isDefinedTool(noImportTool.definition)).toBe(true);
    expect(isDefinedTool(legacyTool.definition)).toBe(true);

    expect(await noImportTool.definition.run({}, {} as any)).toBe("no-import");
    expect(await legacyTool.definition.run({}, {} as any)).toBe("legacy");

    // Assert no target package.json/node_modules
    await expect(fs.stat(path.join(cwd, "package.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, "node_modules"))).rejects.toThrow();
    
    // Assert tmp residue is absent
    await assertTmpAbsent(cwd);
  });

  it("supports a non-Node manifest without making ODW a target dependency", async () => {
    const cwd = await makeProject("non-node-manifest");
    
    // Create harmless non-Node manifest
    await fs.writeFile(path.join(cwd, "deno.json"), JSON.stringify({ name: "tool-project" }));

    await addTool(cwd, "no-import.tool.js", `
      export default defineTool({
        id: "no-import",
        description: "no import",
        inputSchema: {},
        run: () => "no-import"
      });
    `);
    await addTool(cwd, "legacy.tool.js", `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "legacy-import",
        description: "legacy import",
        inputSchema: {},
        run: () => "legacy"
      });
    `);

    const registry = await loadToolRegistry({ cwd, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 });
    
    // Assert both forms load and execute
    const tools = registry.list().map(tool => tool.definition.id).sort();
    expect(tools).toEqual(["legacy-import", "no-import"]);

    const noImportTool = registry.require("no-import");
    const legacyTool = registry.require("legacy-import");

    expect(isDefinedTool(noImportTool.definition)).toBe(true);
    expect(isDefinedTool(legacyTool.definition)).toBe(true);

    expect(await noImportTool.definition.run({}, {} as any)).toBe("no-import");
    expect(await legacyTool.definition.run({}, {} as any)).toBe("legacy");

    // Assert no target package.json/node_modules
    await expect(fs.stat(path.join(cwd, "package.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, "node_modules"))).rejects.toThrow();
    
    // Assert tmp residue is absent
    await assertTmpAbsent(cwd);
  });

  it("uses the active runtime despite a conflicting local package and preserves active branding", async () => {
    const cwd = await makeProject("collision");
    
    // Deliberately create conflicting node_modules/@travisliu/open-dynamic-workflow package
    const packageDir = path.join(cwd, "node_modules", "@travisliu", "open-dynamic-workflow");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "@travisliu/open-dynamic-workflow", type: "module", exports: "./index.js" })
    );
    await fs.writeFile(
      path.join(packageDir, "index.js"),
      `export function defineTool(definition) {
        globalThis.__COLLISION_FAKE_CALLED__ = true;
        return { ...definition, id: "wrong-local-runtime" };
      }`
    );

    // Initialize collision marker
    (globalThis as any).__COLLISION_FAKE_CALLED__ = undefined;

    await addTool(cwd, "no-import.tool.js", `
      export default defineTool({
        id: "no-import-tool",
        description: "no-import",
        inputSchema: {},
        run: () => "no-import-val"
      });
    `);
    await addTool(cwd, "legacy.tool.js", `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "legacy-tool",
        description: "legacy",
        inputSchema: {},
        run: () => "legacy-val"
      });
    `);

    try {
      const registry = await loadToolRegistry({ cwd, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 });

      // Assert local fake was not evaluated (marker remains absent/undefined)
      expect((globalThis as any).__COLLISION_FAKE_CALLED__).toBeUndefined();

      // Assert both tools loaded using active brand and execute properly
      const noImportTool = registry.require("no-import-tool");
      const legacyTool = registry.require("legacy-tool");

      expect(isDefinedTool(noImportTool.definition)).toBe(true);
      expect(isDefinedTool(legacyTool.definition)).toBe(true);

      expect(await noImportTool.definition.run({}, {} as any)).toBe("no-import-val");
      expect(await legacyTool.definition.run({}, {} as any)).toBe("legacy-val");

      expect(registry.has("wrong-local-runtime")).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, "__COLLISION_FAKE_CALLED__");
    }
  });

  it("verifies ordinary relative and tool-owned dependency imports", async () => {
    const cwd = await makeProject("ordinary-imports");

    // Relative helper
    await fs.mkdir(path.join(cwd, ".open-dynamic-workflow", "tools", "lib"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, ".open-dynamic-workflow", "tools", "lib", "helper.js"),
      `export const helperVal = "helper";`
    );

    // Tool-owned dependency in tools node_modules
    const depDir = path.join(cwd, ".open-dynamic-workflow", "tools", "node_modules", "my-bare-esm-package");
    await fs.mkdir(depDir, { recursive: true });
    await fs.writeFile(
      path.join(depDir, "package.json"),
      JSON.stringify({
        name: "my-bare-esm-package",
        type: "module",
        exports: {
          ".": "./index.js"
        }
      })
    );
    await fs.writeFile(
      path.join(depDir, "index.js"),
      `export const pkgVal = "pkg";`
    );

    await addTool(cwd, "import-test.tool.js", `
      import { helperVal } from "./lib/helper.js";
      import { pkgVal } from "my-bare-esm-package";
      export default defineTool({
        id: "import-tool",
        description: "imports helper and tool-owned dep",
        inputSchema: {},
        run: () => helperVal + "-" + pkgVal
      });
    `);

    await acquireLock(lockPath);
    try {
      const buildResult = await runFile("npm", ["run", "build"], { cwd: repoRoot });
      if (buildResult.code !== 0) {
        throw new Error(`npm run build failed:\nStdout: ${buildResult.stdout}\nStderr: ${buildResult.stderr}`);
      }

      // Write a standalone script to load and execute the tool using the built library.
      // This bypasses Vitest/Vite's custom module resolver and tests Node's native module resolution.
      const scriptPath = path.join(cwd, "test-run.mjs");
      const loadJsPath = path.join(repoRoot, "dist", "tools", "load.js");
      await fs.writeFile(
        scriptPath,
        `
        import { loadToolRegistry } from ${JSON.stringify(loadJsPath)};
        
        async function run() {
          try {
            const registry = await loadToolRegistry({
              cwd: ${JSON.stringify(cwd)},
              dir: ".open-dynamic-workflow/tools",
              maxDefinitions: 10
            });
            const tool = registry.require("import-tool");
            const result = await tool.definition.run({}, {});
            console.log(JSON.stringify({
              ok: true,
              result,
              registeredIds: registry.list().map(t => t.definition.id)
            }));
          } catch (err) {
            console.log(JSON.stringify({
              ok: false,
              error: err.message,
              stack: err.stack
            }));
          }
        }
        run();
        `
      );

      const runResult = await runFile("node", [scriptPath], { cwd });
      if (runResult.code !== 0) {
        throw new Error(`Standalone node script failed:\nStdout: ${runResult.stdout}\nStderr: ${runResult.stderr}`);
      }

      const parsed = JSON.parse(runResult.stdout.trim());
      if (!parsed.ok) {
        throw new Error(`Registry load in standalone process failed: ${parsed.error}\n${parsed.stack}`);
      }

      expect(parsed.result).toBe("helper-pkg");
      expect(parsed.registeredIds).toEqual(["import-tool"]);
    } finally {
      await releaseLock(lockPath);
    }

    // Assert that only my-bare-esm-package exists in tools node_modules, and specifically no @travisliu
    const toolsNodeModules = path.join(cwd, ".open-dynamic-workflow", "tools", "node_modules");
    const files = await fs.readdir(toolsNodeModules);
    expect(files).toEqual(["my-bare-esm-package"]);
    expect(files).not.toContain("@travisliu");

    // Assert the temporary workspace has no root package.json and no root node_modules
    await expect(fs.stat(path.join(cwd, "node_modules"))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, "package.json"))).rejects.toThrow();

    // Assert tmp residue is absent
    await assertTmpAbsent(cwd);
  }, 150000);

  it("proves deterministic same-process concurrency, FIFO queuing, and error recovery", async () => {
    const ws1 = await makeProject("concurrency-first");
    const ws2 = await makeProject("concurrency-second");

    // Snapshot pre-test own globalThis.defineTool descriptor
    const preTestDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");

    // Install concurrency controller on globalThis
    const events: string[] = [];

    let firstStartedResolve!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStartedResolve = resolve;
    });

    let releaseFirstResolve!: () => void;
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirstResolve = resolve;
    });

    (globalThis as any).__CONCURRENCY_CONTROLLER__ = {
      events,
      firstStarted: {
        promise: firstStartedPromise,
        resolve: firstStartedResolve
      },
      releaseFirst: {
        promise: releaseFirstPromise,
        resolve: releaseFirstResolve
      },
      record(event: string) {
        this.events.push(event);
        if (event === "first:start") {
          this.firstStarted.resolve();
        }
      }
    };

    // First tool file (in ws1) starts, records first:start, awaits release gate, records first:fail, throws error
    await addTool(ws1, "first.tool.js", `
      globalThis.__CONCURRENCY_CONTROLLER__.record("first:start");
      await globalThis.__CONCURRENCY_CONTROLLER__.releaseFirst.promise;
      globalThis.__CONCURRENCY_CONTROLLER__.record("first:fail");
      throw new Error("intentional first tool load failure");
      
      export default defineTool({
        id: "first-tool",
        description: "first",
        inputSchema: {},
        run: () => "first-val"
      });
    `);

    // Second tool file (in ws2) records second:start, exports valid definition
    await addTool(ws2, "second.tool.js", `
      globalThis.__CONCURRENCY_CONTROLLER__.record("second:start");
      
      export default defineTool({
        id: "second-tool",
        description: "second",
        inputSchema: {},
        run: () => "second-val"
      });
    `);

    try {
      // 1. Start load 1 in the background
      const load1Promise = loadToolRegistry({ cwd: ws1, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 });

      // 2. Await notification that load 1 evaluation has started
      await (globalThis as any).__CONCURRENCY_CONTROLLER__.firstStarted.promise;

      // 3. Start load 2 while load 1 is still evaluating/blocked
      const load2Promise = loadToolRegistry({ cwd: ws2, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 });

      // 4. Deterministic handshake: second:start must be absent before release
      expect(events).toContain("first:start");
      expect(events).not.toContain("second:start");

      // 5. Release load 1
      (globalThis as any).__CONCURRENCY_CONTROLLER__.releaseFirst.resolve();

      // 6. Assert load 1 failed as expected
      let load1Error: any;
      try {
        await load1Promise;
      } catch (err) {
        load1Error = err;
      }
      expect(load1Error).toBeDefined();

      // 7. Assert load 2 successfully queued, evaluated, and resolved
      const registry2 = await load2Promise;
      expect(registry2.has("second-tool")).toBe(true);
      expect(await registry2.require("second-tool").definition.run({}, {} as any)).toBe("second-val");

      // 8. Assert event order is strictly FIFO: first:start, first:fail, second:start
      expect(events).toEqual(["first:start", "first:fail", "second:start"]);

      // 9. Assert a third load is not poisoned by the previous failure
      const ws3 = await makeProject("concurrency-third");
      await addTool(ws3, "third.tool.js", `
        export default defineTool({
          id: "third-tool",
          description: "third",
          inputSchema: {},
          run: () => "third-val"
        });
      `);
      const registry3 = await loadToolRegistry({ cwd: ws3, dir: ".open-dynamic-workflow/tools", maxDefinitions: 10 });
      expect(registry3.has("third-tool")).toBe(true);
      expect(await registry3.require("third-tool").definition.run({}, {} as any)).toBe("third-val");

      // Check all workspaces lack tmp
      await assertTmpAbsent(ws1);
      await assertTmpAbsent(ws2);
      await assertTmpAbsent(ws3);
    } finally {
      // Clean up concurrency controller
      Reflect.deleteProperty(globalThis, "__CONCURRENCY_CONTROLLER__");

      // Restore and verify descriptor
      const postTestDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
      expect(postTestDescriptor).toEqual(preTestDescriptor);

      if (preTestDescriptor) {
        Object.defineProperty(globalThis, "defineTool", preTestDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "defineTool");
      }
    }
  });

  it("builds, packs, and executes CLI via npx from clean external directory using both syntax variants", async () => {
    await acquireLock(lockPath);
    try {
      // 1. Create fresh external workspace
      const cwd = await makeProject("packed-cli");
      const runOutDir = path.join(cwd, "out");
      await fs.mkdir(runOutDir, { recursive: true });

      // 2. Build package
      const buildResult = await runFile("npm", ["run", "build"], { cwd: repoRoot });
      if (buildResult.code !== 0) {
        throw new Error(`npm run build failed:\nStdout: ${buildResult.stdout}\nStderr: ${buildResult.stderr}`);
      }

      // 3. Pack package and retrieve exact filename from JSON
      const packResult = await runFile("npm", ["pack", "--pack-destination", cwd, "--json"], { cwd: repoRoot });
      if (packResult.code !== 0) {
        throw new Error(`npm pack failed:\nStdout: ${packResult.stdout}\nStderr: ${packResult.stderr}`);
      }

      const jsonStart = packResult.stdout.indexOf("[");
      if (jsonStart === -1) {
        throw new Error(`Could not find JSON array in npm pack output:\n${packResult.stdout}`);
      }
      const packInfo = JSON.parse(packResult.stdout.slice(jsonStart));
      const tarballFilename = packInfo[0].filename;
      const absoluteTarball = path.resolve(cwd, tarballFilename);

      let runSuccess = false;
      try {
        // 4. Assert target has no package.json or node_modules
        await expect(fs.access(path.join(cwd, "package.json"))).rejects.toThrow();
        await expect(fs.access(path.join(cwd, "node_modules"))).rejects.toThrow();

        // 5. Write minimal config.yaml
        await fs.writeFile(
          path.join(cwd, ".open-dynamic-workflow", "config.yaml"),
          `defaultProvider: mock
providers:
  mock:
    command: mock
`
        );

        // 6. Write no-import tool
        await addTool(cwd, "no-import.tool.js", `
          export default defineTool({
            id: "no-import-tool",
            description: "no-import tool",
            inputSchema: {},
            run: () => "no-import-success"
          });
        `);

        // 7. Write legacy-import tool
        await addTool(cwd, "legacy.tool.js", `
          import { defineTool } from "@travisliu/open-dynamic-workflow";
          export default defineTool({
            id: "legacy-tool",
            description: "legacy tool",
            inputSchema: {},
            run: () => "legacy-success"
          });
        `);

        // 8. Write workflow invoking both tools
        await fs.writeFile(
          path.join(cwd, "workflow.js"),
          `export const meta = {
            name: "packed-acceptance-workflow",
            description: "Acceptance workflow for packed CLI"
          };
          export default async () => {
            const res1 = await tool({
              definition: "no-import-tool",
              args: {}
            });
            const res2 = await tool({
              definition: "legacy-tool",
              args: {}
            });
            return { res1, res2 };
          };`
        );

        // 9. Invoke packed CLI via npx
        const npxArgs = [
          "--yes",
          "--package",
          absoluteTarball,
          "open-dynamic-workflow",
          "run",
          path.join(cwd, "workflow.js"),
          "--cwd",
          cwd,
          "--out",
          runOutDir,
          "--report",
          "json"
        ];
        
        const npxResult = await runFile("npx", npxArgs, { cwd });
        if (npxResult.code !== 0) {
          throw new Error(`npx run command failed with code ${npxResult.code}.\nStdout: ${npxResult.stdout}\nStderr: ${npxResult.stderr}`);
        }

        // 10. Assert stdout is parseable JSON report and verify contents
        const parsedReport = JSON.parse(npxResult.stdout.trim());
        expect(parsedReport.schemaVersion).toBe("open-dynamic-workflow.report.v1");
        expect(parsedReport.status).toBe("succeeded");
        
        // Verify workflow result
        expect(parsedReport.result).toEqual({
          res1: "no-import-success",
          res2: "legacy-success"
        });

        // Verify report evidence for both tool IDs/calls
        expect(parsedReport.tools).toBeDefined();
        expect(parsedReport.tools.length).toBe(2);

        const tool1 = parsedReport.tools.find((t: any) => t.definition === "no-import-tool");
        const tool2 = parsedReport.tools.find((t: any) => t.definition === "legacy-tool");

        expect(tool1).toBeDefined();
        expect(tool1.ok).toBe(true);
        expect(tool1.status).toBe("succeeded");

        expect(tool2).toBeDefined();
        expect(tool2.ok).toBe(true);
        expect(tool2.status).toBe("succeeded");

        // 11. Assert no package.json, no node_modules, and no tmp residue after command
        await expect(fs.access(path.join(cwd, "package.json"))).rejects.toThrow();
        await expect(fs.access(path.join(cwd, "node_modules"))).rejects.toThrow();
        await expect(fs.access(path.join(cwd, ".open-dynamic-workflow", "tmp"))).rejects.toThrow();

        runSuccess = true;
      } finally {
        // 12. Clean up exact tarball
        if (absoluteTarball) {
          await fs.rm(absoluteTarball, { force: true });
        }
      }
      expect(runSuccess).toBe(true);
    } finally {
      await releaseLock(lockPath);
    }
  }, 150000);
});
