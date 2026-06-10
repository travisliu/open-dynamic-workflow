import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-pause-resume");

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
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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

  return { stdout: stdoutData.join(""), stderr: stderrData.join(""), error };
}

async function listRunDirs(runsDir: string): Promise<string[]> {
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readReport(runsDir: string, runId: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(runsDir, runId, "report.json"), "utf8"));
}

async function writeFakeCodexConfig(configPath: string, counterPath: string): Promise<void> {
  const fakeCodexPath = path.resolve("tests/fixtures/fake-codex-jsonl.mjs");
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
    - OPENFLOW_FAKE_CODEX_COUNTER
`, "utf8");
  process.env.OPENFLOW_FAKE_CODEX_COUNTER = counterPath;
}

describe("pause/resume", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.OPENFLOW_FAKE_CODEX_COUNTER;
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("pauses after planning, then resumes with cached prior work and new input", async () => {
    const workflowPath = path.join(TEMP_DIR, "plan-pause.workflow.js");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    await writeFakeCodexConfig(configPath, counterPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "plan-pause", description: "pause after plan" };
const plan = await agent("make a short plan", { id: "plan" });
const instruction = await pause("approve-plan", {
  message: "Review the plan.",
  data: { plan }
});
const result = await agent("implement with instruction: " + instruction, { id: "implement" });
export default result;
`, "utf8");

    const first = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(first.error).toMatchObject({ code: "WORKFLOW_PENDING" });
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);
    const firstReport = await readReport(runsDir, firstRunId!);
    expect(firstReport.status).toBe("pending");
    expect(firstReport.pendingPause.id).toBe("approve-plan");
    const inspected = await runCli(["inspect", firstRunId!, "--out", runsDir, "--json"]);
    expect(inspected.error).toBeNull();
    expect(JSON.parse(inspected.stdout).status).toBe("pending");
    const watched = await runCli(["watch", firstRunId!, "--out", runsDir, "--jsonl"]);
    expect(watched.error).toBeNull();
    expect(watched.stdout).toContain("workflow.pending");

    const second = await runCli(["resume", firstRunId!, "continue carefully", "--out", runsDir]);
    expect(second.error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("2");
    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const secondReport = await readReport(runsDir, secondRunId);
    expect(secondReport.status).toBe("succeeded");
    expect(secondReport.agents[0].id).toBe("plan");
    expect(secondReport.agents[0].cache.hit).toBe(true);
    expect(secondReport.agents[1].id).toBe("implement");
    const resumeInput = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "pauses/approve-plan/resume-input.json"), "utf8"));
    expect(resumeInput.value).toBe("continue carefully");
  });

  it("validates schema pause input and returns the parsed object", async () => {
    const workflowPath = path.join(TEMP_DIR, "schema-pause.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-schema");
    await fs.writeFile(workflowPath, `
export const meta = { name: "schema-pause", description: "schema pause" };
const decision = await pause("decision", {
  message: "Choose next action.",
  schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["continue", "stop"] },
      instruction: { type: "string" }
    },
    required: ["action"]
  }
});
export default decision.action + ":" + (decision.instruction || "");
`, "utf8");

    const first = await runCli(["run", workflowPath, "--provider", "mock", "--out", runsDir]);
    expect(first.error).toMatchObject({ code: "WORKFLOW_PENDING" });
    const [firstRunId] = await listRunDirs(runsDir);

    const bad = await runCli(["resume", firstRunId!, '{"action":"bogus"}', "--out", runsDir]);
    expect(bad.error).toMatchObject({ code: "CLI_USAGE_ERROR" });

    const good = await runCli(["resume", firstRunId!, '{"action":"continue","instruction":"ship"}', "--out", runsDir]);
    expect(good.error).toBeNull();
    const runIds = await listRunDirs(runsDir);
    const finalRunId = runIds.find((id) => id !== firstRunId)!;
    const report = await readReport(runsDir, finalRunId);
    expect(report.result).toBe("continue:ship");
  });

  it("supports multiple pending pauses across chained resume runs", async () => {
    const workflowPath = path.join(TEMP_DIR, "multi-pause.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-multi");
    await fs.writeFile(workflowPath, `
export const meta = { name: "multi-pause", description: "multiple pauses" };
const first = await pause("first", { message: "First decision." });
const second = await pause("second", { message: "Second decision.", data: { first } });
export default first + "/" + second;
`, "utf8");

    const firstRun = await runCli(["run", workflowPath, "--provider", "mock", "--out", runsDir]);
    expect(firstRun.error).toMatchObject({ code: "WORKFLOW_PENDING" });
    const [firstRunId] = await listRunDirs(runsDir);

    const secondRun = await runCli(["resume", firstRunId!, "alpha", "--out", runsDir]);
    expect(secondRun.error).toMatchObject({ code: "WORKFLOW_PENDING" });
    const secondRunId = (await listRunDirs(runsDir)).find((id) => id !== firstRunId)!;
    const secondReport = await readReport(runsDir, secondRunId);
    expect(secondReport.pendingPause.id).toBe("second");

    const finalRun = await runCli(["resume", secondRunId, "beta", "--out", runsDir]);
    expect(finalRun.error).toBeNull();
    const finalRunId = (await listRunDirs(runsDir)).find((id) => id !== firstRunId && id !== secondRunId)!;
    const finalReport = await readReport(runsDir, finalRunId);
    expect(finalReport.status).toBe("succeeded");
    expect(finalReport.result).toBe("alpha/beta");
  });

  it("fails clearly when pause is called inside parallel", async () => {
    const workflowPath = path.join(TEMP_DIR, "parallel-pause.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-parallel");
    await fs.writeFile(workflowPath, `
export const meta = { name: "parallel-pause", description: "invalid pause" };
await parallel({
  bad: () => pause("bad", { message: "Cannot pause here." })
});
export default "done";
`, "utf8");

    const result = await runCli(["run", workflowPath, "--provider", "mock", "--out", runsDir]);
    expect(result.error).toMatchObject({ code: "PROVIDER_PROCESS_FAILED" });
    const [runId] = await listRunDirs(runsDir);
    const report = await readReport(runsDir, runId!);
    expect(report.status).toBe("failed");
    expect(report.error.message).toContain("pause() is not supported inside parallel()");
  });

  it("fails clearly when pause is called inside a pipeline stage", async () => {
    const workflowPath = path.join(TEMP_DIR, "pipeline-pause.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-pipeline");
    await fs.writeFile(workflowPath, `
export const meta = { name: "pipeline-pause", description: "invalid pipeline pause" };
await pipeline(["one"], [
  {
    name: "bad",
    run: () => pause("bad-pipeline", { message: "Cannot pause here." })
  }
]);
export default "done";
`, "utf8");

    const result = await runCli(["run", workflowPath, "--provider", "mock", "--out", runsDir]);
    expect(result.error).toMatchObject({ code: "PROVIDER_PROCESS_FAILED" });
    const [runId] = await listRunDirs(runsDir);
    const report = await readReport(runsDir, runId!);
    expect(report.status).toBe("failed");
    expect(report.error.message).toContain("pause() is not supported inside pipeline stages");
  });

  it("replays a fixed loop through resume/cache when each round uses stable ids", async () => {
    const workflowPath = path.join(TEMP_DIR, "loop-cache.workflow.js");
    const configPath = path.join(TEMP_DIR, "loop-cache.config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-loop-cache");
    const counterPath = path.join(TEMP_DIR, "loop-counter.txt");
    await writeFakeCodexConfig(configPath, counterPath);
    await fs.writeFile(workflowPath, `
export const meta = { name: "loop-cache", description: "fixed loop cache" };
const results = [];
for (let round = 1; round <= 3; round++) {
  const fix = await agent("fix round " + round, { id: "fix-" + round });
  const review = await agent("review round " + round + ": " + fix, { id: "review-" + round });
  results.push(review);
}
export default results.length;
`, "utf8");

    const first = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(first.error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("6");
    const [firstRunId] = await listRunDirs(runsDir);

    const second = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir, "--resume", firstRunId!]);
    expect(second.error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("6");
    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const secondReport = await readReport(runsDir, secondRunId);
    expect(secondReport.status).toBe("succeeded");
    expect(secondReport.agents).toHaveLength(6);
    expect(secondReport.agents.every((agent: any) => agent.cache?.hit === true)).toBe(true);
  });
});
