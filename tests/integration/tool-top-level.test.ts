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

describe("Tool Top-Level Integration", () => {
  let projectDir: string;
  let toolsDir: string;
  let workflowDir: string;
  let outDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(tmpdir(), "open-dynamic-workflow-tool-toplevel-"));
    toolsDir = path.join(projectDir, ".open-dynamic-workflow/tools");
    workflowDir = path.join(projectDir, "workflows");
    outDir = path.join(projectDir, "out");

    await fs.mkdir(toolsDir, { recursive: true });
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    // Create a real tool
    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    await fs.writeFile(path.join(toolsDir, "echo.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({
        id: "echo",
        description: "echo tool",
        inputSchema: { type: "object", properties: { msg: { type: "string" } } },
        run: (input) => ({ reply: input.msg })
      });
    `);
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("should succeed when root workflow uses module top-level tool()", async () => {
    const wfPath = path.join(workflowDir, "toplevel.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "toplevel", description: "desc" };
      const report = await tool({
        definition: "echo",
        args: { msg: "top-level-root" }
      });
      export default { report };
    `);

    const result = await runCli([
      "run",
      wfPath,
      "--out",
      outDir,
      "--report",
      "json"
    ], projectDir);

    expect(result.error).toBeNull();
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.result.report).toEqual({ reply: "top-level-root" });
  });

  it("should pass static validation when root workflow uses module top-level tool()", async () => {
    const wfPath = path.join(workflowDir, "validate-toplevel.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "validate-toplevel", description: "desc" };
      const report = await tool({
        definition: "echo",
        args: { msg: "top-level-root" }
      });
      export default { report };
    `);

    const result = await runCli(["validate", wfPath], projectDir);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("✓ Validated workflow \"validate-toplevel\" at workflows/validate-toplevel.workflow.ts");
  });

  it("should succeed when child workflow uses module top-level tool()", async () => {
    const childWfPath = path.join(workflowDir, "child.workflow.ts");
    await fs.writeFile(childWfPath, `
      export const meta = { name: "child-tool", description: "child desc" };
      const result = await tool({ definition: "echo", args: { msg: "top-level-child" } });
      export default result;
    `);

    const parentWfPath = path.join(workflowDir, "parent.workflow.ts");
    await fs.writeFile(parentWfPath, `
      export const meta = { name: "parent", description: "parent desc" };
      export default async ({ workflow }) => {
        return await workflow({ name: "child-tool" });
      };
    `);

    const result = await runCli([
      "run",
      parentWfPath,
      "--out",
      outDir,
      "--report",
      "json"
    ], projectDir);

    expect(result.error).toBeNull();
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.result).toEqual({ reply: "top-level-child" });
  });

  it("should succeed when child module top-level tool() is called from parallel task", async () => {
    const childWfPath = path.join(workflowDir, "child.workflow.ts");
    await fs.writeFile(childWfPath, `
      export const meta = { name: "child-tool", description: "child desc" };
      const result = await tool({ definition: "echo", args: { msg: "allowed-parallel-child" } });
      export default result;
    `);

    const parentWfPath = path.join(workflowDir, "parent.workflow.ts");
    await fs.writeFile(parentWfPath, `
      export const meta = { name: "parent", description: "parent desc" };
      export default async ({ parallel, workflow }) => {
        await parallel([
          async () => { await workflow({ name: "child-tool" }); }
        ]);
      };
    `);

    const result = await runCli([
      "run",
      parentWfPath,
      "--out",
      outDir,
      "--report",
      "json"
    ], projectDir);

    expect(result.error).toBeNull();
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
  });

  it("should reject destructured async tool alias in root workflow", async () => {
    const wfPath = path.join(workflowDir, "bypass.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "bypass", description: "desc" };
      export default async (ctx) => {
        const { tool: t } = ctx;
        return await Promise.resolve().then(() => t({ definition: "echo", args: { msg: "hi" } }));
      };
    `);

    // Should fail validation
    const validateResult = await runCli(["validate", wfPath], projectDir);
    expect(validateResult.stdout + validateResult.stderr + (validateResult.error?.message || "")).toContain("Aliasing tool() is not allowed");

    // Should fail run
    const runResult = await runCli([
      "run",
      wfPath,
      "--out",
      outDir,
      "--report",
      "json"
    ], projectDir);

    if (runResult.error) {
      expect(runResult.error.message).toContain("Aliasing tool() is not allowed");
    } else {
      const reportContent = runResult.stdout || runResult.stderr;
      expect(reportContent).toBeTruthy();
      const report = JSON.parse(reportContent);
      expect(report.status).toBe("failed");
      expect(report.error.message).toContain("Aliasing tool() is not allowed");
    }
  });
});
