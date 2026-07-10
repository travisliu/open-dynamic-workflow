import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { exitCodeForError } from "../../src/errors/exit-codes.js";

const TEMP_DIR = path.resolve("tests/temp-tc-11");

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

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    error = err;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  const exitCode = error ? exitCodeForError(error) : 0;

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error,
    exitCode
  };
}

describe("Exit Codes", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Success returns exit code 0", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/mock-success.workflow.js",
      "--config", "tests/fixtures/config/mock.config.yaml",
      "--out", TEMP_DIR
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("Workflow failure returns exit code 1", async () => {
    // We need fail-fast so the workflow fails immediately and throws to main
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/mock-failure.workflow.js",
      "--config", "tests/fixtures/config/mock.config.yaml",
      "--out", TEMP_DIR,
      "--fail-fast"
    ]);
    expect(result.exitCode).toBe(1);
  });

  it("Invalid CLI usage returns exit code 2", async () => {
    const result = await runCli([
      "run",
      // missing required argument
    ]);
    expect(result.exitCode).toBe(2);
  });

  it("Parse or validation error returns exit code 3", async () => {
    const result = await runCli([
      "validate",
      "tests/fixtures/workflows/invalid-missing-meta.workflow.js",
      "--config", "tests/fixtures/config/mock.config.yaml"
    ]);
    expect(result.exitCode).toBe(3);
  });

  it("Workflow file not found returns exit code 4", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/non-existent-workflow.workflow.js",
      "--out", TEMP_DIR
    ]);
    expect(result.exitCode).toBe(4);
  });

  // (Security), (User cancellation), (Timeout) 
  // are covered by existing tests or hard to simulate perfectly here without full fixtures.
  // We can just rely on the unit tests for those, and the integration tests already done (e.g., for cancel, for security).
});
