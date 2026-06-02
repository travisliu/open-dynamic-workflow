import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-integration-success-runs");

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

describe("Integration - mock run success", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("completes happy path with mock-success workflow", async () => {
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

    console.log("Integration run result:", result);
    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify expected files exist
    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.status).toBe("succeeded");
    expect(manifest.schemaVersion).toBe("execflow.manifest.v1");

    expect(await fs.stat(path.join(runDir, "workflow.input.ts"))).toBeDefined();
    expect(await fs.stat(path.join(runDir, "config.resolved.json"))).toBeDefined();
    expect(await fs.stat(path.join(runDir, "events.jsonl"))).toBeDefined();
    expect(await fs.stat(path.join(runDir, "report.json"))).toBeDefined();

    // Verify agents log files
    const reviewAuthDir = path.join(runDir, "agents/review-auth");
    expect(await fs.readFile(path.join(reviewAuthDir, "prompt.txt"), "utf8")).toBe("Review src/auth.ts");
    expect(await fs.stat(path.join(reviewAuthDir, "stdout.log"))).toBeDefined();
    expect(await fs.stat(path.join(reviewAuthDir, "stderr.log"))).toBeDefined();

    // Verify pretty reporter output
    expect(result.stdout).toContain("◇ mock-success");
    expect(result.stdout).toContain("→ Phase: review");
    expect(result.stdout).toContain("→ Phase: summarize");
    expect(result.stdout).toContain("Artifacts:");
  });
});
