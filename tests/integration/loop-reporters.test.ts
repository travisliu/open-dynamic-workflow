import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-loop-reporters");

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

describe("Loop Reporters Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("JSON reporter contains loop summary information", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeNull();

    const stdout = result.stdout.trim();
    const parsed = JSON.parse(stdout);

    expect(parsed.status).toBe("succeeded");
    expect(parsed.loops).toBeDefined();
    expect(parsed.loops.length).toBe(1);

    const loopSummary = parsed.loops[0];
    expect(loopSummary.status).toBe("succeeded");
    expect(loopSummary.roundsCompleted).toBe(2);
  });

  it("JSONL reporter outputs all loop and round lifecycle events", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl"
    ]);

    expect(result.error).toBeNull();

    const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);
    const events = lines.map((line) => JSON.parse(line));
    const eventTypes = events.map((e) => e.type);

    expect(eventTypes).toContain("loop.started");
    expect(eventTypes).toContain("loop.round.started");
    expect(eventTypes).toContain("loop.round.completed");
    expect(eventTypes).toContain("loop.completed");

    const loopEvents = events.filter((e) => e.type.startsWith("loop."));
    expect(loopEvents.length).toBeGreaterThan(0);
    for (const e of loopEvents) {
      expect(e.payload.workflowInvocationId).toBeDefined();
      expect(e.payload.workflowInvocationId).not.toBe("unknown");
    }
  });

  it("Pretty reporter formats loop details clearly", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty"
    ]);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("loop loop-break");
    expect(result.stdout).toContain("2/5 rounds");
    expect(result.stdout).toContain("loops:     1 succeeded");
    expect(result.stderr).not.toContain("[DEBUG] PrettyViewBuilder");
  });

  it("does not leak secret-like values in events or summaries and asserts terminal statePreview shape", async () => {
    process.env.MY_SECRET = "SECRET_SHOULD_NOT_BE_IN_EVENTS";
    try {
      const workflowPath = path.resolve("tests/fixtures/workflows/loop-secret.workflow.js");
      const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

      // 1. Check JSONL report
      const jsonlResult = await runCli([
        "run",
        workflowPath,
        "--config", configPath,
        "--out", TEMP_DIR,
        "--report", "jsonl"
      ]);
      expect(jsonlResult.error).toBeNull();
      expect(jsonlResult.stdout).not.toContain("SECRET_SHOULD_NOT_BE_IN_EVENTS");

      const lines = jsonlResult.stdout.split("\n").filter((line) => line.trim().length > 0);
      const events = lines.map((line) => JSON.parse(line));
      const loopCompleted = events.find((e) => e.type === "loop.completed");
      expect(loopCompleted).toBeDefined();
      expect(loopCompleted.payload.statePreview).toBeDefined();
      expect(loopCompleted.payload.finalState).toBeUndefined();
      expect(JSON.stringify(loopCompleted.payload.statePreview)).toContain("[REDACTED]");

      // 2. Check JSON report
      const jsonResult = await runCli([
        "run",
        workflowPath,
        "--config", configPath,
        "--out", TEMP_DIR,
        "--report", "json"
      ]);
      expect(jsonResult.error).toBeNull();
      expect(jsonResult.stdout).not.toContain("SECRET_SHOULD_NOT_BE_IN_EVENTS");

      // 3. Check artifacts (which SHOULD contain the secret)
      const runs = await fs.readdir(TEMP_DIR);
      expect(runs.length).toBeGreaterThan(0);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      const resultJsonPath = path.join(runDir, "loops/secret-loop/result.json");
      const resultJson = await fs.readFile(resultJsonPath, "utf8");
      expect(resultJson).toContain("SECRET_SHOULD_NOT_BE_IN_EVENTS");
    } finally {
      delete process.env.MY_SECRET;
    }
  });

  it("truncates long strings in loop terminal event statePreview", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-long-string.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    const fixtureContent = `
export const meta = {
  name: "loop-long-string",
  description: "Test loop preview size-limiting"
};

const result = await loop({
  label: "long-string-loop",
  initialState: { data: "a".repeat(2000) },
  options: { maxRounds: 1 },
  run: async (state, ctx) => {
    return {
      done: true,
      nextState: { data: "b".repeat(3000) }
    };
  }
});

export default result;
`;
    const fixturePath = path.resolve("tests/fixtures/workflows/loop-long-string.workflow.js");
    await fs.writeFile(fixturePath, fixtureContent, "utf8");

    try {
      const result = await runCli([
        "run",
        workflowPath,
        "--config", configPath,
        "--out", TEMP_DIR,
        "--report", "jsonl"
      ]);

      expect(result.error).toBeNull();
      const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);
      const events = lines.map((line) => JSON.parse(line));
      const loopCompleted = events.find((e) => e.type === "loop.completed");
      expect(loopCompleted).toBeDefined();
      expect(loopCompleted.payload.statePreview).toBeDefined();
      expect(loopCompleted.payload.statePreview.data).toContain("... [TRUNCATED]");
      expect(loopCompleted.payload.statePreview.data.length).toBeLessThan(1100);
    } finally {
      await fs.rm(fixturePath, { force: true });
    }
  });
});
