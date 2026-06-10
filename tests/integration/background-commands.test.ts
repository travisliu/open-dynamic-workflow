import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEMP_DIR = path.resolve("tests/temp-background-commands");
const CLI_DIST_DIR = path.join(TEMP_DIR, "cli-dist");

async function runDist(args: string[], options: { timeout?: number } = {}) {
  return execFileAsync(process.execPath, [path.join(CLI_DIST_DIR, "index.js"), ...args], {
    timeout: options.timeout ?? 10000
  });
}

async function waitForStatus(runsDir: string, runId: string, expected: string, timeoutMs = 8000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { stdout } = await runDist(["inspect", runId, "--out", runsDir, "--json"]);
    const inspection = JSON.parse(stdout);
    if (inspection.status === expected) {
      return inspection;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const { stdout } = await runDist(["inspect", runId, "--out", runsDir, "--json"]);
  return JSON.parse(stdout);
}

describe("background commands", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await execFileAsync(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "--outDir", CLI_DIST_DIR], {
      timeout: 30000
    });
  });

  afterEach(async () => {
    delete process.env.OPENFLOW_FAKE_CODEX_DELAY_MS;
    delete process.env.OPENFLOW_FAKE_CODEX_COUNTER;
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("runs in the background and supports list, inspect, watch, and kill", async () => {
    const workflowPath = path.join(TEMP_DIR, "background.workflow.js");
    const configPath = path.join(TEMP_DIR, "background.config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    const fakeCodexPath = path.resolve("tests/fixtures/fake-codex-jsonl.mjs");

    await fs.writeFile(workflowPath, `
export const meta = { name: "background", description: "background command test" };
const result = await agent("slow", { id: "slow-agent" });
export default result;
`, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: codex
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(fakeCodexPath)}
    defaultModel: null
security:
  passEnv:
    - OPENFLOW_FAKE_CODEX_DELAY_MS
    - OPENFLOW_FAKE_CODEX_COUNTER
`, "utf8");

    process.env.OPENFLOW_FAKE_CODEX_DELAY_MS = "5000";
    process.env.OPENFLOW_FAKE_CODEX_COUNTER = counterPath;

    const started = await runDist([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      runsDir,
      "--report",
      "json",
      "--background"
    ]);
    const payload = JSON.parse(started.stdout);
    expect(payload.runId).toBeTruthy();
    expect(payload.pid).toBeGreaterThan(0);

    const listed = JSON.parse((await runDist(["list", "--out", runsDir, "--json"])).stdout);
    expect(listed.runs.some((run: any) => run.runId === payload.runId)).toBe(true);

    const inspected = JSON.parse((await runDist(["inspect", payload.runId, "--out", runsDir, "--json"])).stdout);
    expect(["starting", "running"]).toContain(inspected.status);

    await new Promise((resolve) => setTimeout(resolve, 500));
    await runDist(["kill", payload.runId, "--out", runsDir]);
    const finalInspection = await waitForStatus(runsDir, payload.runId, "cancelled");
    expect(finalInspection.status).toBe("cancelled");

    delete process.env.OPENFLOW_FAKE_CODEX_DELAY_MS;
    const completed = await runDist([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      runsDir,
      "--report",
      "json",
      "--background"
    ]);
    const completedPayload = JSON.parse(completed.stdout);
    await waitForStatus(runsDir, completedPayload.runId, "succeeded");
    const watchResult = await runDist(["watch", completedPayload.runId, "--out", runsDir, "--jsonl"], { timeout: 5000 });
    expect(watchResult.stdout).toContain("workflow.started");

    const secondWatch = await runDist(["watch", completedPayload.runId, "--out", runsDir, "--jsonl"], { timeout: 1000 });
    expect(secondWatch.stdout).toContain("workflow.started");
  }, 45000);
});
