import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-loop-artifacts");

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

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Loop Artifacts Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("creates loop artifact directory tree", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const loopsDir = path.join(runDir, "loops");

    expect(await fs.stat(loopsDir)).toBeDefined();
    const loopDirs = await fs.readdir(loopsDir);
    expect(loopDirs.length).toBeGreaterThan(0);

    const loopDir = path.join(loopsDir, loopDirs[0]!);
    expect(await fs.stat(path.join(loopDir, "loop.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "initial-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "final-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "result.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/input-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/run-result.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/next-state.json"))).toBeDefined();
  });
});
