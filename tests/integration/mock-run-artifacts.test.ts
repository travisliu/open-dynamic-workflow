import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-integration-artifacts-runs");

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("Integration - mock run artifact layout", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("creates the expected MVP artifact directory layout on successful run", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/mock-success.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Root run directory files
    expect(await fileExists(path.join(runDir, "manifest.json"))).toBe(true);
    expect(await fileExists(path.join(runDir, "workflow.input.ts"))).toBe(true);
    expect(await fileExists(path.join(runDir, "config.resolved.json"))).toBe(true);
    expect(await fileExists(path.join(runDir, "events.jsonl"))).toBe(true);
    expect(await fileExists(path.join(runDir, "report.json"))).toBe(true);

    // Validate manifest content
    const manifest = JSON.parse(await fs.readFile(path.join(runDir, "manifest.json"), "utf8"));
    expect(manifest.schemaVersion).toBe("execflow.manifest.v1");
    expect(manifest.status).toBe("succeeded");
    expect(manifest.runId).toBe(runId);
    expect(typeof manifest.createdAt).toBe("string");
    expect(typeof manifest.updatedAt).toBe("string");

    // review-auth agent directory
    const reviewAuthDir = path.join(runDir, "agents/review-auth");
    expect(await fileExists(path.join(reviewAuthDir, "prompt.txt"))).toBe(true);
    expect(await fileExists(path.join(reviewAuthDir, "stdout.log"))).toBe(true);
    expect(await fileExists(path.join(reviewAuthDir, "stderr.log"))).toBe(true);
    expect(await fileExists(path.join(reviewAuthDir, "raw-result.json"))).toBe(true);
    expect(await fileExists(path.join(reviewAuthDir, "normalized-result.json"))).toBe(true);

    // Verify prompt content
    const prompt = await fs.readFile(path.join(reviewAuthDir, "prompt.txt"), "utf8");
    expect(prompt).toBe("Review src/auth.ts");

    // summary agent directory
    const summaryDir = path.join(runDir, "agents/summary");
    expect(await fileExists(path.join(summaryDir, "prompt.txt"))).toBe(true);
    expect(await fileExists(path.join(summaryDir, "stdout.log"))).toBe(true);
    expect(await fileExists(path.join(summaryDir, "stderr.log"))).toBe(true);

    // Validate report.json content
    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    expect(report.schemaVersion).toBe("execflow.report.v1");
    expect(report.runId).toBe(runId);
    expect(report.status).toBe("succeeded");

    // Validate events.jsonl - must have strictly increasing sequence numbers
    const eventsContent = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
    const eventLines = eventsContent.trim().split("\n").filter(Boolean);
    expect(eventLines.length).toBeGreaterThan(0);

    const events = eventLines.map((l) => JSON.parse(l));
    // Verify all events have the correct schema version
    for (const event of events) {
      expect(event.schemaVersion).toBe("execflow.event.v1");
    }
    // Sort by sequence and verify monotonic increase (out-of-order appends are
    // possible with parallel agents, but all sequence numbers should be unique and > 0)
    const sequences = events.map((e: { sequence: number }) => e.sequence).sort((a, b) => a - b);
    let prevSeq = 0;
    for (const seq of sequences) {
      expect(seq).toBeGreaterThan(prevSeq);
      prevSeq = seq;
    }

    // Validate config.resolved.json is valid JSON
    const config = JSON.parse(await fs.readFile(path.join(runDir, "config.resolved.json"), "utf8"));
    expect(config).toBeTruthy();
  });

  it("schema.json is written when agent uses a schema", async () => {
    // The mock-review.js example uses a schema for review-auth
    const result = await runCli([
      "run",
      "examples/mock-review.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);

    // review-auth uses a schema
    const reviewAuthDir = path.join(runDir, "agents/review-auth");
    expect(await fileExists(path.join(reviewAuthDir, "schema.json"))).toBe(true);

    const schema = JSON.parse(await fs.readFile(path.join(reviewAuthDir, "schema.json"), "utf8"));
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("findings");
  });
});
