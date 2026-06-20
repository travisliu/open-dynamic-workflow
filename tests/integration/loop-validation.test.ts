import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-loop-validation");

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
  const consoleSpy = vi.spyOn(console, "error").mockImplementation((msg) => {
    stderrData.push(msg);
  });

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err: any) {
    error = err;
    if (err.message) {
      stderrData.push(err.message);
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Loop Validation Integration", () => {
  it("fails validation if maxRounds exceeds default ceiling", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-loop-max-rounds.workflow.js");
    const result = await runCli(["validate", workflowPath]);

    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("maxRounds");
    expect(result.stderr).toContain("exceeds the configured ceiling of 20");
  });

  it("fails validation if tool() is used inside loop", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-loop-tool.js");
    const result = await runCli(["validate", workflowPath]);

    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("tool");
    expect(result.stderr).toContain("is not allowed in this context");
  });

  it("fails validation on multiple invalid static options", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-loop-options.workflow.js");
    const result = await runCli(["validate", workflowPath]);

    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("maxRounds must be a positive integer.");
    expect(result.stderr).toContain("timeoutMs must be a positive integer.");
    expect(result.stderr).toContain("failureMode must be 'throw' or 'settled'.");
    expect(result.stderr).toContain("label cannot be empty.");
  });
});
