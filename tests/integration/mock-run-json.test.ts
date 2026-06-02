import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-integration-json-runs");

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

describe("Integration - mock run json mode", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("stdout is clean parseable JSON with --report json", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/mock-success.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    expect(result.error).toBeNull();

    // stdout should be valid JSON
    const stdout = result.stdout.trim();
    expect(stdout).toBeTruthy();

    // Should parse to exactly one JSON object
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(stdout);
    }).not.toThrow();

    // Should match WorkflowRunResult schema
    const report = parsed as Record<string, unknown>;
    expect(report.schemaVersion).toBe("execflow.report.v1");
    expect(typeof report.runId).toBe("string");
    expect(report.status).toBe("succeeded");
    expect(Array.isArray(report.agents)).toBe(true);
    expect(typeof report.startedAt).toBe("string");
    expect(typeof report.finishedAt).toBe("string");
    expect(typeof report.artifactsDir).toBe("string");

    // stdout should not contain progress symbols or debug logs
    expect(stdout).not.toContain("◇");
    expect(stdout).not.toContain("→ Phase:");
    expect(stdout).not.toContain("▶");
    expect(stdout).not.toContain("✓");
    expect(stdout).not.toContain("Action triggered!");

    // Verify the entire stdout (excluding whitespace) is exactly one JSON object
    // JSON.parse(result.stdout.trim()) above already ensures this.
    // If there were any non-JSON text before or after, it would have failed to parse.

    // Verify persisted report matches
    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const reportJson = await fs.readFile(path.join(runDir, "report.json"), "utf8");
    const persistedReport = JSON.parse(reportJson) as Record<string, unknown>;
    expect(persistedReport.schemaVersion).toBe("execflow.report.v1");
    expect(persistedReport.status).toBe("succeeded");
  });

  it("stderr may contain operational warnings but stdout stays clean", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/mock-success.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // stdout should still be valid JSON even if stderr has content
    expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
  });
});
