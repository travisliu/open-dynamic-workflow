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
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    exitCode: process.exitCode,
    error
  };
}

describe("Tool Serialization Integration", () => {
  let projectDir: string;
  let toolsDir: string;
  let workflowDir: string;
  let outDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(tmpdir(), "open-dynamic-workflow-tool-ser-"));
    toolsDir = path.join(projectDir, ".open-dynamic-workflow/tools");
    workflowDir = path.join(projectDir, "workflows");
    outDir = path.join(projectDir, "out");

    await fs.mkdir(toolsDir, { recursive: true });
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });

    const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
    await fs.writeFile(path.join(toolsDir, "echo.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({
        id: "echo",
        description: "echo tool",
        inputSchema: {},
        run: (input) => ({ reply: input })
      });
    `);
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("should fail before queueing for non-serializable args (BigInt) (WS-003)", async () => {
    const wfPath = path.join(workflowDir, "bad-args.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "bad-args", description: "desc" };
      export default async () => {
        // BigInt is not serializable to JSON
        return await tool({ definition: "echo", args: { val: 123n } });
      };
    `);

    const result = await runCli([
      "run",
      wfPath,
      "--out",
      outDir,
      "--report",
      "json"
    ], projectDir);

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("TOOL_SERIALIZATION_FAILED");
    expect(report.tools || []).toHaveLength(0); // Should not have been queued
  });

  it("should fail before queueing for non-serializable metadata (WS-003)", async () => {
    const wfPath = path.join(workflowDir, "bad-meta.workflow.ts");
    await fs.writeFile(wfPath, `
      export const meta = { name: "bad-meta", description: "desc" };
      export default async () => {
        return await tool({ 
          definition: "echo", 
          args: { msg: "hi" },
          metadata: { func: () => {} } 
        });
      };
    `);

    const result = await runCli([
      "run",
      wfPath,
      "--out",
      outDir,
      "--report",
      "json"
    ], projectDir);

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("TOOL_SERIALIZATION_FAILED");
    expect(report.tools || []).toHaveLength(0);
  });
});
