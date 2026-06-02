import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-integration-failure-runs");

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

describe("Integration - mock run failure", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("preserves partial artifacts after agent failure", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/mock-failure.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    // Run directory should exist even if workflow fails
    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Manifest should exist
    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.schemaVersion).toBe("execflow.manifest.v1");
    // Status can be succeeded or failed depending on runtime failure policy
    expect(["succeeded", "failed", "cancelled"]).toContain(manifest.status);

    // Events file should exist
    expect(await fs.stat(path.join(runDir, "events.jsonl"))).toBeDefined();

    // Report should exist
    expect(await fs.stat(path.join(runDir, "report.json"))).toBeDefined();

    // Both agent directories should exist
    const reviewOkDir = path.join(runDir, "agents/review-ok");
    expect(await fs.stat(path.join(reviewOkDir, "prompt.txt"))).toBeDefined();
    expect(await fs.stat(path.join(reviewOkDir, "stdout.log"))).toBeDefined();
    expect(await fs.stat(path.join(reviewOkDir, "stderr.log"))).toBeDefined();

    const reviewFailDir = path.join(runDir, "agents/review-fail");
    expect(await fs.stat(path.join(reviewFailDir, "prompt.txt"))).toBeDefined();
    expect(await fs.stat(path.join(reviewFailDir, "stdout.log"))).toBeDefined();
    expect(await fs.stat(path.join(reviewFailDir, "stderr.log"))).toBeDefined();

    // Report should include the failed agent
    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    expect(report.schemaVersion).toBe("execflow.report.v1");
    expect(Array.isArray(report.agents)).toBe(true);

    const failedAgent = report.agents.find((a: { id: string }) => a.id === "review-fail");
    expect(failedAgent).toBeDefined();
    expect(failedAgent.ok).toBe(false);

    // Events should include agent.failed
    const eventsContent = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
    const events = eventsContent
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const failedEvent = events.find((e: { type: string }) => e.type === "agent.failed");
    expect(failedEvent).toBeDefined();
  });
});
