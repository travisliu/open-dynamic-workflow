import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-validate-success");

async function runCli(args: string[]) {
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

  let error: any = null;

  try {
    await main(["node", "open-dynamic-workflow", ...args]);
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
    error
  };
}

describe("Valid metadata passes validation", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("CLI exits with code 0 and shows success message, creating no artifacts", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/valid-basic.workflow.js");
    const destPath = path.join(TEMP_DIR, "valid-basic.workflow.js");
    await fs.copyFile(workflowPath, destPath);

    const result = await runCli([
      "validate",
      destPath,
      "--cwd",
      TEMP_DIR
    ]);

    if (result.error) {
       console.error("CLI error:", result.error);
    }
    
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("valid-basic");
    expect(result.stdout.toLowerCase()).toContain("valid");

    // Ensure no .open-dynamic-workflow directory is created in TEMP_DIR
    const openDynamicWorkflowDir = path.join(TEMP_DIR, ".open-dynamic-workflow");
    const exists = await fs.stat(openDynamicWorkflowDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});
