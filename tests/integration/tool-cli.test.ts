import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";
import { tmpdir } from "node:os";

async function runCli(args: string[], cwd?: string) {
  const stdoutData: string[] = [];
  const stderrData: string[] = [];

  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdoutData.push(chunk.toString());
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrData.push(chunk.toString());
    return true;
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderrData.push(args.join(" ") + "\n");
  });

  const finalArgs = [...args];
  if (cwd) {
    finalArgs.push("--cwd", cwd);
  }

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...finalArgs]);
  } catch (err) {
    error = err;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    exitCode: process.exitCode,
    error
  };
}

describe("Tool CLI Integration", () => {
  let projectDir: string;
  let toolsDir: string;
  let workflowDir: string;
  let markerFile: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(tmpdir(), "open-dynamic-workflow-tool-cli-"));
    toolsDir = path.join(projectDir, ".open-dynamic-workflow/tools");
    workflowDir = path.join(projectDir, "workflows");
    markerFile = path.join(projectDir, "marker.txt");

    await fs.mkdir(toolsDir, { recursive: true });
    await fs.mkdir(workflowDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("validate should load definitions without running them (Case 58)", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    await fs.writeFile(path.join(toolsDir, "marker-tool.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      export default defineTool({
        id: "marker-tool",
        description: "marker",
        inputSchema: {},
        run: () => {
          fs.writeFileSync("${markerFile}", "called");
          return "ok";
        }
      });
    `);

    const wfPath = path.join(workflowDir, "marker.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "marker", description: "desc" };
      export default async () => {
        await tool({ definition: "marker-tool", args: {} });
      };
    `);

    const result = await runCli(["validate", wfPath], projectDir);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("✓ Validated workflow \"marker\" at workflows/marker.workflow.ts");
    
    // Ensure run() was NOT called
    await expect(fs.stat(markerFile)).rejects.toThrow();
  });

  it("doctor should report malformed tool definitions (Case 59)", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    
    // Duplicate ID tool
    await fs.writeFile(path.join(toolsDir, "t1.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "dup", description: "d", inputSchema: {}, run: () => {} });
    `);
    await fs.writeFile(path.join(toolsDir, "t2.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "dup", description: "d", inputSchema: {}, run: () => {} });
    `);

    const result = await runCli(["doctor"], projectDir);

    expect(result.stdout).toContain("Duplicate tool ID 'dup'");
  });

  it("JSONL output should remain machine-readable with tool events (Case 60)", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    await fs.writeFile(path.join(toolsDir, "echo.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "echo", description: "d", inputSchema: {}, run: () => "ok" });
    `);

    const wfPath = path.join(workflowDir, "echo.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "echo", description: "desc" };
      export default async () => {
        await tool({ definition: "echo", args: {} });
      };
    `);

    const result = await runCli(["run", wfPath, "--report", "jsonl"], projectDir);

    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    
    let foundStarted = false;
    let foundCompleted = false;

    for (const line of lines) {
      const event = JSON.parse(line);
      expect(event.schemaVersion).toBe("open-dynamic-workflow.event.v1");
      if (event.type === "tool.started") foundStarted = true;
      if (event.type === "tool.completed") foundCompleted = true;
    }

    expect(foundStarted).toBe(true);
    expect(foundCompleted).toBe(true);
  });

  it("should run a workflow with a TS tool that imports a helper (Issue 4)", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");

    await fs.mkdir(path.join(projectDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(projectDir, ".open-dynamic-workflow/config.yaml"), `
tools:
  include:
    - ".open-dynamic-workflow/tools/*.tool.ts"
`);
    
    // Helper file in nested directory
    await fs.mkdir(path.join(toolsDir, "utils"), { recursive: true });
    await fs.writeFile(path.join(toolsDir, "utils", "math-helper.ts"), `
      export function multiply(a: number, b: number) { return a * b; }
    `);

    // Tool file importing helper using .js
    await fs.writeFile(path.join(toolsDir, "calc-tool.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import { multiply } from "./utils/math-helper.js";
      export default defineTool({
        id: "calc-tool",
        description: "multiplies",
        inputSchema: {},
        run: () => multiply(3, 4)
      });
    `);

    const wfPath = path.join(workflowDir, "calc.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "calc", description: "desc" };
      export default async () => {
        return await tool({ definition: "calc-tool", args: {} });
      };
    `);

    const result = await runCli(["run", wfPath, "--report", "json"], projectDir);
    expect(result.error).toBeNull();

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.result).toBe(12);
  });

  it("should generate deterministic tool IDs in CLI runs with omitted ID (WS-002)", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    await fs.writeFile(path.join(toolsDir, "echo.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "echo", description: "d", inputSchema: {}, run: () => "ok" });
    `);

    const wfPath = path.join(workflowDir, "echo.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "echo", description: "desc" };
      export default async () => {
        await tool({ definition: "echo", args: {} });
      };
    `);

    const result = await runCli(["run", wfPath, "--report", "json"], projectDir);
    expect(result.error).toBeNull();
    const report = JSON.parse(result.stdout);
    
    expect(report.tools).toHaveLength(1);
    expect(report.tools[0].toolCallId).toBe("tool-0001-echo");
  });

  it("should fail validation for unknown tool called via custom parameter name (WS-001)", async () => {
    const wfPath = path.join(workflowDir, "missing.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "missing", description: "desc" };
      export default async (flow) => {
        return await flow.tool({ definition: "missing-tool", args: {} });
      };
    `);

    const result = await runCli(["validate", wfPath], projectDir);
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain("Tool 'missing-tool' was not found");
  });

  it("should load tools that import @travisliu/open-dynamic-workflow from project node_modules (T001)", async () => {
    // Setup mock @travisliu/open-dynamic-workflow in project node_modules
    const nodeModules = path.join(projectDir, "node_modules/@travisliu/open-dynamic-workflow");
    await fs.mkdir(nodeModules, { recursive: true });
    await fs.writeFile(path.join(nodeModules, "package.json"), JSON.stringify({
      name: "@travisliu/open-dynamic-workflow",
      version: "0.1.0",
      type: "module"
    }));
    await fs.writeFile(path.join(nodeModules, "index.js"), `
      const marker = Symbol.for("open-dynamic-workflow.toolDefinition");
      export function defineTool(def) {
        const copy = { ...def };
        Object.defineProperty(copy, marker, {
          value: true,
          enumerable: false,
          configurable: false,
          writable: false
        });
        return copy;
      }
    `);

    await fs.writeFile(path.join(toolsDir, "bare-import-tool.tool.ts"), `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "bare-import-tool",
        description: "bare",
        inputSchema: {},
        run: () => "ok"
      });
    `);

    const wfPath = path.join(workflowDir, "bare.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "bare", description: "desc" };
      export default async () => {
        await tool({ definition: "bare-import-tool", args: {} });
      };
    `);

    const result = await runCli(["validate", wfPath], projectDir);
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("✓ Validated workflow \"bare\" at workflows/bare.workflow.ts");
  });

  it("Scenario 1: Valid same-file const/property-access tool is accepted consistently", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    await fs.writeFile(path.join(toolsDir, "valid-same-file.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      const SCHEMA_FRAGMENT = {
        properties: {
          inputMsg: { type: "string" }
        }
      };
      export default defineTool({
        id: "same-file-const-tool",
        description: "valid same-file const description",
        inputSchema: {
          type: "object",
          properties: SCHEMA_FRAGMENT.properties
        },
        run: (args) => {
          return "result: " + args.inputMsg;
        }
      });
    `);

    const wfPath = path.join(workflowDir, "valid-same-file.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "valid-same-file-wf", description: "desc" };
      export default async () => {
        return await tool({ definition: "same-file-const-tool", args: { inputMsg: "hello-world" } });
      };
    `);

    // Assertion 1: list tools --report json
    const listResult = await runCli(["list", "tools", "--report", "json"], projectDir);
    expect(listResult.error).toBeNull();
    const listJson = JSON.parse(listResult.stdout);
    const toolRes = listJson.resources.find((r: any) => r.id === "same-file-const-tool");
    expect(toolRes).toBeDefined();
    // has no diagnostic for that tool
    const warnings = listJson.warnings || [];
    const toolWarnings = warnings.filter((w: any) => w.path && w.path.includes("valid-same-file.tool.ts"));
    expect(toolWarnings).toHaveLength(0);

    // Assertion 2: validate exits successfully
    const valResult = await runCli(["validate", wfPath], projectDir);
    expect(valResult.error).toBeNull();

    // Assertion 3: run --report json exits successfully and returns the expected tool result
    const runResult = await runCli(["run", wfPath, "--report", "json"], projectDir);
    expect(runResult.error).toBeNull();
    const runJson = JSON.parse(runResult.stdout);
    expect(runJson.status).toBe("succeeded");
    expect(runJson.result).toBe("result: hello-world");
  });

  it("Scenario 2: Imported or computed schema/metadata is rejected consistently", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    
    // We will create a tool with computed inputSchema (which is unsupported and not statically extractable)
    await fs.writeFile(path.join(toolsDir, "computed-schema.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      const getSchema = () => ({ type: "object", properties: {} });
      export default defineTool({
        id: "computed-schema-tool",
        description: "computed schema description",
        inputSchema: getSchema(),
        run: () => "ok"
      });
    `);

    const wfPath = path.join(workflowDir, "computed-schema.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "computed-schema-wf", description: "desc" };
      export default async () => {
        return await tool({ definition: "computed-schema-tool", args: {} });
      };
    `);

    // Assertion 1: list tools --strict or JSON diagnostic output rejects candidate with a static tool diagnostic
    const listResult = await runCli(["list", "tools", "--report", "json"], projectDir);
    const listJson = JSON.parse(listResult.stdout);
    const warnings = listJson.warnings || [];
    const targetWarning = warnings.find((w: any) => w.path && w.path.includes("computed-schema.tool.ts"));
    expect(targetWarning).toBeDefined();
    expect(targetWarning.code).toBe("TOOL_DEFINITION_INVALID");
    expect(targetWarning.message).toContain("inputSchema");

    const listStrictResult = await runCli(["list", "tools", "--strict"], projectDir);
    expect(listStrictResult.exitCode).not.toBe(0);

    // Assertion 2: validate rejects with TOOL_INVALID_DEFINITION
    const valResult = await runCli(["validate", wfPath], projectDir);
    expect(valResult.error).toBeDefined();
    expect(valResult.error.code).toBe("TOOL_INVALID_DEFINITION");
    expect(valResult.error.message).toContain("computed-schema.tool.ts");
    expect(valResult.error.message).toContain("inputSchema");

    // Assertion 3: run rejects with TOOL_INVALID_DEFINITION when workflow can reach loader validation
    const runResult = await runCli(["run", wfPath], projectDir);
    expect(runResult.error).toBeDefined();
    expect(runResult.error.code).toBe("TOOL_INVALID_DEFINITION");
    expect(runResult.error.message).toContain("computed-schema.tool.ts");
    expect(runResult.error.message).toContain("inputSchema");
  });

  it("Scenario 2b: Imported metadata is rejected consistently", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");

    await fs.writeFile(path.join(toolsDir, "tool-metadata.ts"), `
      export const TOOL_METADATA = {
        tags: ["imported"]
      };
    `);

    await fs.writeFile(path.join(toolsDir, "imported-metadata.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import { TOOL_METADATA } from "./tool-metadata.js";
      export default defineTool({
        id: "imported-metadata-tool",
        description: "imported metadata description",
        inputSchema: { type: "object" },
        metadata: TOOL_METADATA,
        run: () => "ok"
      });
    `);

    const wfPath = path.join(workflowDir, "imported-metadata.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "imported-metadata-wf", description: "desc" };
      export default async () => {
        return await tool({ definition: "imported-metadata-tool", args: {} });
      };
    `);

    // Arrange: temporary tool project contains an imported metadata value.
    // Act: ask the CLI to discover, validate, and run it.
    const listResult = await runCli(["list", "tools", "--report", "json"], projectDir);
    const listJson = JSON.parse(listResult.stdout);
    const warnings = listJson.warnings || [];
    const targetWarning = warnings.find((w: any) => w.path && w.path.includes("imported-metadata.tool.ts"));
    expect(targetWarning).toBeDefined();
    expect(targetWarning.code).toBe("TOOL_DEFINITION_INVALID");
    expect(targetWarning.message).toContain("metadata");

    const listStrictResult = await runCli(["list", "tools", "--strict"], projectDir);
    expect(listStrictResult.exitCode).not.toBe(0);

    // Assert: validation and run both fail with the stable tool-definition error.
    const valResult = await runCli(["validate", wfPath], projectDir);
    expect(valResult.error).toBeDefined();
    expect(valResult.error.code).toBe("TOOL_INVALID_DEFINITION");
    expect(valResult.error.message).toContain("imported-metadata.tool.ts");
    expect(valResult.error.message).toContain("metadata");

    const runResult = await runCli(["run", wfPath], projectDir);
    expect(runResult.error).toBeDefined();
    expect(runResult.error.code).toBe("TOOL_INVALID_DEFINITION");
    expect(runResult.error.message).toContain("imported-metadata.tool.ts");
    expect(runResult.error.message).toContain("metadata");
  });

  it("Scenario 3: Invalid JSON Schema is rejected consistently", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    await fs.writeFile(path.join(toolsDir, "invalid-schema.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({
        id: "invalid-schema-tool",
        description: "invalid schema description",
        inputSchema: {
          type: "definitely-not-json-schema-type"
        },
        run: () => "ok"
      });
    `);

    const wfPath = path.join(workflowDir, "invalid-schema.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "invalid-schema-wf", description: "desc" };
      export default async () => {
        return await tool({ definition: "invalid-schema-tool", args: {} });
      };
    `);

    // Assertion 1: list tools reports a diagnostic mentioning inputSchema
    const listResult = await runCli(["list", "tools", "--report", "json"], projectDir);
    const listJson = JSON.parse(listResult.stdout);
    const warnings = listJson.warnings || [];
    const targetWarning = warnings.find((w: any) => w.path && w.path.includes("invalid-schema.tool.ts"));
    expect(targetWarning).toBeDefined();
    expect(targetWarning.code).toBe("TOOL_DEFINITION_INVALID");
    expect(targetWarning.message).toContain("inputSchema");

    // Assertion 2: validate rejects with TOOL_INVALID_DEFINITION
    const valResult = await runCli(["validate", wfPath], projectDir);
    expect(valResult.error).toBeDefined();
    expect(valResult.error.code).toBe("TOOL_INVALID_DEFINITION");
    expect(valResult.error.message).toContain("invalid-schema.tool.ts");
    expect(valResult.error.message).toContain("inputSchema");

    // Assertion 3: run rejects with TOOL_INVALID_DEFINITION
    const runResult = await runCli(["run", wfPath], projectDir);
    expect(runResult.error).toBeDefined();
    expect(runResult.error.code).toBe("TOOL_INVALID_DEFINITION");
    expect(runResult.error.message).toContain("invalid-schema.tool.ts");
    expect(runResult.error.message).toContain("inputSchema");
  });

  it("Scenario 4: Duplicate static tool IDs fail before runtime execution", async () => {
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    
    // Create two tool files with the same id: "dup"
    await fs.writeFile(path.join(toolsDir, "dup1.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({
        id: "dup",
        description: "dup tool 1",
        inputSchema: {},
        run: () => "ok"
      });
    `);

    await fs.writeFile(path.join(toolsDir, "dup2.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({
        id: "dup",
        description: "dup tool 2",
        inputSchema: {},
        run: () => "ok"
      });
    `);

    const wfPath = path.join(workflowDir, "dup.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "dup-wf", description: "desc" };
      import * as fs from "node:fs";
      export default async () => {
        fs.writeFileSync("${markerFile}", "executed");
        return await tool({ definition: "dup", args: {} });
      };
    `);

    // Assertion 1: validate reports a duplicate ID failure
    const valResult = await runCli(["validate", wfPath], projectDir);
    expect(valResult.error).toBeDefined();
    expect(valResult.error.message).toContain("Duplicate tool ID");

    // Assertion 2: doctor reports a duplicate ID failure
    const docResult = await runCli(["doctor"], projectDir);
    expect(docResult.stdout + docResult.stderr).toContain("Duplicate tool ID");

    // Assertion 3: run reports a duplicate ID failure, and side-effect marker is not created
    const runResult = await runCli(["run", wfPath], projectDir);
    expect(runResult.error).toBeDefined();
    expect(runResult.error.message).toContain("Duplicate tool ID");

    // Ensure the side-effect marker was NOT created
    await expect(fs.stat(markerFile)).rejects.toThrow();
  });
});
