import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-loop-acceptance");

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
  let exitCode: number | undefined;

  // Mock process.exit
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    exitCode = code as number;
    throw new Error(`Process.exit(${code})`);
  });

  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err: any) {
    if (err.message.startsWith("Process.exit")) {
      // expected from mock
    } else {
      error = err;
      console.error(err.message);
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error,
    exitCode
  };
}

describe("Loop Acceptance (AAA)", () => {
  const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("verifies serial state progression and explicit ctx.break", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    
    // Check loop summary in JSON report
    expect(parsed.loops).toBeDefined();
    expect(parsed.loops[0].status).toBe("succeeded");
    expect(parsed.loops[0].roundsCompleted).toBe(2);

    // Check artifacts
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]);
    const loopDir = path.join(runDir, "loops", "loop-break");
    
    expect(await fs.stat(path.join(loopDir, "loop.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "initial-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "final-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "result.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/input-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/run-result.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/next-state.json"))).toBeDefined();

    const loopMeta = JSON.parse(await fs.readFile(path.join(loopDir, "loop.json"), "utf8"));
    expect(loopMeta.options.maxRounds).toBe(5);
  });

  it("verifies stopWhen history evaluation", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-stop-when.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.loops[0].status).toBe("succeeded");
    expect(parsed.loops[0].roundsCompleted).toBe(3);
  });

  it("verifies maxRounds terminal behavior", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-max-rounds.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("failed");
    expect(parsed.loops[0].status).toBe("max_rounds");
    expect(parsed.loops[0].roundsCompleted).toBe(2);
  });

  it("verifies failureMode: settled", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-failure-settled.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.loops[0].status).toBe("failed");
    expect(parsed.loops[0].roundsCompleted).toBe(1);
    // In settled mode, it should complete the loop even if rounds fail
    expect(parsed.status).toBe("succeeded"); 
  });

  it("verifies forbidden tool() usage inside loop", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-loop-tool.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR
    ]);

    // Assert
    // Should fail validation (exit code 1 or stderr message)
    expect(result.stderr).toContain("not allowed");
    expect(result.stderr).toContain("tool");
  });

  it("verifies allowed ctx.agent(), ctx.workflow(), and ctx.parallel()", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-nested-parallel.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.loops[0].roundsCompleted).toBe(1);
    
    // Verify nested loop artifacts exist
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]);
    const roundDir = path.join(runDir, "loops/nested-parallel-loop/rounds/0001");
    expect(await fs.stat(roundDir)).toBeDefined();
    expect(await fs.stat(path.join(roundDir, "run-result.json"))).toBeDefined();
  });

  it("verifies existing non-loop workflows continue to function normally", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/valid-basic.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.loops).toEqual([]);
  });

  it("verifies compact event payloads in JSONL", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl"
    ]);

    // Assert
    const lines = result.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    
    const loopStarted = events.find(e => e.type === "loop.started");
    expect(loopStarted.payload).toBeDefined();
    expect(loopStarted.payload.loopId).toBe("loop-break");

    const roundCompleted = events.find(e => e.type === "loop.round.completed");
    expect(roundCompleted.payload.roundIndex).toBe(0);
    expect(roundCompleted.payload.historyEntry).toBeUndefined();
  });

  it("verifies pretty report contains loop information", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty"
    ]);

    // Assert
    expect(result.error).toBeNull();
    // Check for loop node in execution section
    expect(result.stdout).toContain("loop loop-break");
    expect(result.stdout).toContain("2/5 rounds");
    // Check for loops summary line
    expect(result.stdout).toContain("loops:     1 succeeded");
  });
});
