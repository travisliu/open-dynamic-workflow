import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-tc-08");

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
    await main(["node", "openflow", ...args]);
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

describe("Reporter modes", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Pretty reporter displays human progress", async () => {
    const workflowPath = path.join(TEMP_DIR, "tc-08.01.workflow.js");
    const configPath = path.join(TEMP_DIR, "tc-08.01.config.yaml");

    // Pre-create fixtures inside TEMP_DIR
    await fs.writeFile(workflowPath, `
export const meta = {
  name: "Pretty Progress",
  description: "Test for pretty reporter"
};

phase("init");
log("Initializing");
await agent({ id: "agent1", label: "Agent One", provider: "mock", prompt: "task 1" });

phase("process");
await agent({ id: "agent2", label: "Agent Two", provider: "mock", prompt: "task 2" });
    `, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  mock:
    command: mock
    responses:
      agent1:
        text: "response 1"
      agent2:
        text: "response 2"
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();

    // Assert: Output includes workflow name
    expect(result.stdout).toContain("Pretty Progress");

    // Assert: Output includes current or completed phase
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("process");

    // Assert: Output includes agent labels, provider names, statuses, and durations
    expect(result.stdout).toContain("Agent One");
    expect(result.stdout).toContain("Agent Two");
    expect(result.stdout).toContain("mock");
    expect(result.stdout).toContain("succeeded");
    expect(result.stdout).toMatch(/\d+ms/);

    // Assert: Output includes artifact directory path
    expect(result.stdout).toContain(TEMP_DIR);
  });

  it("JSON reporter emits final JSON only to stdout", async () => {
    const workflowPath = "tests/fixtures/workflows/mock-success.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeNull();

    const stdout = result.stdout.trim();
    
    // Assert: stdout is exactly one valid JSON object
    let parsed: any;
    expect(() => {
      parsed = JSON.parse(stdout);
    }, `Expected stdout to be valid JSON, but got: ${stdout}`).not.toThrow();

    // Assert: stdout parses as WorkflowRunResult and includes required fields
    expect(parsed.schemaVersion).toBe("openflow.report.v1");
    expect(typeof parsed.runId).toBe("string");
    expect(parsed.status).toBe("succeeded");
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.name).toBe("mock-success");
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents.length).toBeGreaterThan(0);
    
    // Assert: JSON includes durations
    expect(typeof parsed.durationMs).toBe("number");
    for (const agent of parsed.agents) {
      expect(typeof agent.durationMs).toBe("number");
    }

    // Assert: JSON includes artifact paths
    expect(typeof parsed.artifactsDir).toBe("string");
    expect(typeof parsed.reportPath).toBe("string");
    expect(typeof parsed.eventsPath).toBe("string");
    for (const agent of parsed.agents) {
      expect(agent.artifacts).toBeDefined();
      expect(typeof agent.artifacts.stdoutPath).toBe("string");
      expect(typeof agent.artifacts.stderrPath).toBe("string");
    }

    // Assert: stdout does not contain progress text (pretty reporter symbols)
    expect(stdout).not.toContain("◇");
    expect(stdout).not.toContain("✔");
    expect(stdout).not.toContain("✖");
    expect(stdout).not.toContain("Artifacts:");

    // Assert: Operational logs, if any, are on stderr
    expect(result.stderr).not.toContain("DEBUG");
  });

  it("JSONL reporter emits ordered event stream", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/reporter-modes.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl"
    ]);

    expect(result.error).toBeNull();

    const stdout = result.stdout;
    const lines = stdout.split("\n").filter((line) => line.trim().length > 0);

    // Assert: stdout contains one valid JSON event envelope per line.
    const parsedEvents: Array<any> = [];
    for (const line of lines) {
      expect(() => {
        const parsed = JSON.parse(line);
        parsedEvents.push(parsed);
      }).not.toThrow();
    }

    // Assert: Every event sequence is strictly increasing.
    const sequences = parsedEvents.map((e) => e.sequence as number);
    expect(sequences.length).toBeGreaterThan(0);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }

    // Assert: Event stream includes workflow.started and terminal workflow event.
    const types = parsedEvents.map((e) => e.type);
    expect(types).toContain("workflow.started");
    const terminalEvent = types[types.length - 1];
    expect(["workflow.completed", "workflow.failed"]).toContain(terminalEvent);

    // Assert: Event stream includes phase, log, and agent events.
    expect(types).toContain("phase.started");
    expect(types).toContain("workflow.log");
    expect(types).toContain("agent.started");
    expect(types).toContain("agent.completed");

    // Assert: stdout does not contain pretty progress text.
    expect(stdout).not.toContain("◇");
    expect(stdout).not.toContain("→ Phase:");
    expect(stdout).not.toContain("▶");
    expect(stdout).not.toContain("Artifacts:");

    // Assert: Persisted events.jsonl matches emitted event stream.
    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const eventsContent = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
    const persistedLines = eventsContent.split("\n").filter((l) => l.trim().length > 0);

    expect(lines.length).toBe(persistedLines.length);
    for (let i = 0; i < persistedLines.length; i++) {
      const persisted = JSON.parse(persistedLines[i]!);
      const fromStdout = JSON.parse(lines[i]!);
      expect(fromStdout).toEqual(persisted);
    }
  });

  it("Pretty reporter visibly marks dangerous write mode (AC-11)", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/dangerously-full-access-valid.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();

    // Assert: Output stays human-readable and doesn't crash
    const stdout = result.stdout;
    expect(stdout).toBeTruthy();

    // Assert: The agent line visibly marks dangerous write mode
    expect(stdout).toContain("[dangerously-full-access]");

    // Assert: The output still includes normal progress and final artifact location
    expect(stdout).toContain("dangerously-full-access-valid"); // Workflow name
    expect(stdout).toContain("succeeded");
    expect(stdout).toContain("Artifacts:");
    expect(stdout).toContain(TEMP_DIR);
  });
});
