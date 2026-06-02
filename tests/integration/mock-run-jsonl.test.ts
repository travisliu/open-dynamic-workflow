import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-integration-jsonl-runs");

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

  let error: unknown = null;
  try {
    await main(["node", "execflow", ...args]);
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

describe("Integration - mock run jsonl mode", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("stdout contains one event envelope per line with --report jsonl", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/mock-success.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl"
    ]);

    expect(result.error).toBeNull();

    const stdout = result.stdout;
    expect(stdout.trim().length).toBeGreaterThan(0);

    // Every non-empty line must be valid JSON
    const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);

    const parsedEvents: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      expect(() => {
        const parsed = JSON.parse(line);
        parsedEvents.push(parsed as Record<string, unknown>);
      }).not.toThrow();
    }

    // Every event must have schemaVersion: "execflow.event.v1"
    for (const event of parsedEvents) {
      expect(event.schemaVersion).toBe("execflow.event.v1");
    }

    // Sequence numbers must be strictly increasing
    const sequences = parsedEvents.map((e) => e.sequence as number);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]!);
    }

    // stdout should not contain pretty-progress text or debug logs
    expect(stdout).not.toContain("◇");
    expect(stdout).not.toContain("→ Phase:");
    expect(stdout).not.toContain("▶");
    expect(stdout).not.toContain("Artifacts:");
    expect(stdout).not.toContain("Action triggered!");

    // Stdout events should match persisted events.jsonl
    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const eventsContent = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
    const persistedLines = eventsContent.split("\n").filter((l) => l.trim().length > 0);

    // Both should have the same number of events
    expect(lines.length).toBe(persistedLines.length);

    // Each persisted event should match its stdout counterpart
    for (let i = 0; i < persistedLines.length; i++) {
      const persisted = JSON.parse(persistedLines[i]!);
      const fromStdout = JSON.parse(lines[i]!);
      expect(fromStdout).toEqual(persisted);
    }
  });

  it("includes workflow.started and workflow.completed events", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/mock-success.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl"
    ]);

    expect(result.error).toBeNull();

    const lines = result.stdout.split("\n").filter((l) => l.trim().length > 0);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const types = events.map((e) => e.type);

    expect(types).toContain("workflow.started");
    expect(types).toContain("agent.started");
    expect(types).toContain("agent.completed");
  });
});
