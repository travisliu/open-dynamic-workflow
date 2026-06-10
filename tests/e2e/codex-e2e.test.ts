import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-codex-e2e");
const runIfEnabled = process.env.OPENFLOW_CODEX_E2E === "1" ? it : it.skip;
const execFileAsync = promisify(execFile);

async function runCli(args: string[]) {
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
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

  return { error };
}

async function readOnlyRunReport(runRoot: string): Promise<any> {
  const runs = await fs.readdir(runRoot);
  expect(runs).toHaveLength(1);
  const reportPath = path.join(runRoot, runs[0]!, "report.json");
  return JSON.parse(await fs.readFile(reportPath, "utf8"));
}

async function readRunReport(runRoot: string, runId: string): Promise<any> {
  const reportPath = path.join(runRoot, runId, "report.json");
  return JSON.parse(await fs.readFile(reportPath, "utf8"));
}

async function listRunDirs(runRoot: string): Promise<string[]> {
  const entries = await fs.readdir(runRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

describe("Codex E2E smoke", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  runIfEnabled("runs a minimal real Codex plain-text workflow", async () => {
    const workflowPath = path.join(TEMP_DIR, "plain.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-plain");
    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-plain", description: "Minimal real Codex smoke test" };
const result = await agent("Reply with exactly: openflow-codex-ok", { id: "codex-plain" });
export default result;
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000"
    ]);

    expect(result.error).toBeNull();
    const report = await readOnlyRunReport(runsDir);
    expect(report.status).toBe("succeeded");
    expect(String(report.result).toLowerCase()).toContain("openflow-codex-ok");
    expect(report.agents[0].threadId).toBeTruthy();
    expect(report.agents[0].usage.totalTokens).toBeGreaterThan(0);
    expect(report.usageSummary.totalTokens).toBeGreaterThan(0);
  }, 180000);

  runIfEnabled("runs a real Codex schema workflow", async () => {
    const workflowPath = path.join(TEMP_DIR, "schema.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-schema");
    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-schema", description: "Real Codex schema smoke test" };
const result = await agent("Return exactly one JSON object with status ok and exactly two items: alpha and beta.", {
  id: "codex-schema",
  schema: {
    type: "object",
    properties: {
      status: { type: "string" },
      items: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2
      }
    },
    required: ["status", "items"]
  },
  structuredOutput: { transport: "auto" }
});
export default result;
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000"
    ]);

    expect(result.error).toBeNull();
    const report = await readOnlyRunReport(runsDir);
    expect(report.status).toBe("succeeded");
    expect(report.result).toEqual({ status: "ok", items: ["alpha", "beta"] });
  }, 240000);

  runIfEnabled("runs a real Codex review workflow", async () => {
    const reviewRepo = path.join(TEMP_DIR, "review-repo");
    await fs.mkdir(reviewRepo, { recursive: true });
    await git(reviewRepo, ["init"]);
    await fs.writeFile(path.join(reviewRepo, "math.js"), "export function add(a, b) { return a + b; }\n", "utf8");
    await git(reviewRepo, ["add", "math.js"]);
    await git(reviewRepo, ["-c", "user.name=OpenFlow Test", "-c", "user.email=openflow@example.test", "commit", "-m", "initial"]);
    await fs.writeFile(path.join(reviewRepo, "math.js"), "export function add(a, b) { return a - b; }\n", "utf8");

    const workflowPath = path.join(TEMP_DIR, "review.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-review");
    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-review", description: "Real Codex review smoke test" };
const review = await agent.review("Review the tiny uncommitted diff. Limit to three bullets.", {
  id: "codex-review",
  cwd: ${JSON.stringify(reviewRepo)},
  uncommitted: true
});
export default review;
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000"
    ]);

    expect(result.error).toBeNull();
    const report = await readOnlyRunReport(runsDir);
    expect(report.status).toBe("succeeded");
    expect(report.agents[0].id).toBe("codex-review");
    expect(typeof report.result).toBe("string");
    expect(report.result.length).toBeGreaterThan(0);
  }, 240000);

  runIfEnabled("stops a real Codex workflow after observed token budget is exceeded", async () => {
    const workflowPath = path.join(TEMP_DIR, "budget.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-budget");
    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-budget", description: "Real Codex budget smoke test" };
await agent("Reply with exactly: first-budget-step", { id: "budget-first" });
await agent("Reply with exactly: second-budget-step", { id: "budget-second" });
export default "done";
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000",
      "--max-observed-tokens",
      "1"
    ]);

    expect(result.error).toMatchObject({ code: "BUDGET_EXCEEDED" });
    const report = await readOnlyRunReport(runsDir);
    expect(report.status).toBe("failed");
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0].id).toBe("budget-first");
    expect(report.usageSummary.totalTokens).toBeGreaterThan(1);
  }, 240000);

  runIfEnabled("reuses a real Codex result through resume/cache without launching the provider again", async () => {
    const workflowPath = path.join(TEMP_DIR, "resume.workflow.js");
    const brokenConfigPath = path.join(TEMP_DIR, "broken-codex.config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-resume");

    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-resume-cache", description: "Real Codex resume/cache smoke test" };
const result = await agent("Reply with exactly: openflow-real-cache-ok", { id: "real-cache-agent" });
export default result;
`, "utf8");

    await fs.writeFile(brokenConfigPath, `
defaultProvider: codex
providers:
  codex:
    command: openflow-nonexistent-codex-provider-for-cache
    defaultModel: null
security:
  allowShell: false
  allowWorkflowImports: false
  passEnv: []
  redactEnv: []
reporting:
  mode: json
  verbose: false
`, "utf8");

    const first = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000"
    ]);
    expect(first.error).toBeNull();
    const [firstRunId] = await listRunDirs(runsDir);
    expect(firstRunId).toBeDefined();
    const firstReport = await readRunReport(runsDir, firstRunId!);
    expect(firstReport.status).toBe("succeeded");
    expect(String(firstReport.result).toLowerCase()).toContain("openflow-real-cache-ok");

    const second = await runCli([
      "run",
      workflowPath,
      "--config",
      brokenConfigPath,
      "--out",
      runsDir,
      "--resume",
      firstRunId!
    ]);
    expect(second.error).toBeNull();

    const runIds = await listRunDirs(runsDir);
    expect(runIds).toHaveLength(2);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const secondReport = await readRunReport(runsDir, secondRunId);
    expect(secondReport.status).toBe("succeeded");
    expect(String(secondReport.result).toLowerCase()).toContain("openflow-real-cache-ok");
    expect(secondReport.agents[0].cache).toMatchObject({
      hit: true,
      callId: "real-cache-agent",
      previousAgentId: "real-cache-agent"
    });

    const cacheHit = JSON.parse(
      await fs.readFile(path.join(runsDir, secondRunId, "agents/real-cache-agent/cache-hit.json"), "utf8")
    );
    expect(cacheHit.previousRunId).toBe(firstRunId);
  }, 300000);

  runIfEnabled("pauses a real Codex workflow and resumes with cached pre-pause work", async () => {
    const workflowPath = path.join(TEMP_DIR, "pause.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-pause");

    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-pause", description: "Real Codex pause/resume smoke test" };
const plan = await agent("Reply with exactly: openflow-pause-plan", { id: "pause-plan" });
const instruction = await pause("approve-plan", {
  message: "Approve or redirect the plan.",
  data: { plan }
});
let result;
if (instruction === "skip-final") {
  result = "skipped:" + plan;
} else {
  result = await agent("Reply with exactly: openflow-pause-final", { id: "pause-final" });
}
export default result;
`, "utf8");

    const first = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000"
    ]);
    expect(first.error).toMatchObject({ code: "WORKFLOW_PENDING" });
    const [firstRunId] = await listRunDirs(runsDir);
    expect(firstRunId).toBeDefined();
    const firstReport = await readRunReport(runsDir, firstRunId!);
    expect(firstReport.status).toBe("pending");
    expect(firstReport.pendingPause.id).toBe("approve-plan");
    expect(firstReport.agents[0].id).toBe("pause-plan");
    expect(firstReport.agents[0].usage.totalTokens).toBeGreaterThan(0);

    const second = await runCli([
      "resume",
      firstRunId!,
      "continue",
      "--out",
      runsDir
    ]);
    expect(second.error).toBeNull();
    const secondRunId = (await listRunDirs(runsDir)).find((id) => id !== firstRunId)!;
    const secondReport = await readRunReport(runsDir, secondRunId);
    expect(secondReport.status).toBe("succeeded");
    expect(String(secondReport.result).toLowerCase()).toContain("openflow-pause-final");
    expect(secondReport.agents[0].cache).toMatchObject({
      hit: true,
      callId: "pause-plan"
    });
    expect(secondReport.agents[1].id).toBe("pause-final");

    const resolvedConfigPath = path.join(runsDir, firstRunId!, "config.resolved.json");
    const resolvedConfig = JSON.parse(await fs.readFile(resolvedConfigPath, "utf8"));
    resolvedConfig.providers.codex.command = "openflow-nonexistent-codex-provider-for-pause-cache";
    await fs.writeFile(resolvedConfigPath, JSON.stringify(resolvedConfig, null, 2), "utf8");

    const third = await runCli([
      "resume",
      firstRunId!,
      "skip-final",
      "--out",
      runsDir
    ]);
    expect(third.error).toBeNull();
    const runIds = await listRunDirs(runsDir);
    const thirdRunId = runIds.find((id) => id !== firstRunId && id !== secondRunId)!;
    const thirdReport = await readRunReport(runsDir, thirdRunId);
    expect(thirdReport.status).toBe("succeeded");
    expect(String(thirdReport.result).toLowerCase()).toContain("openflow-pause-plan");
    expect(thirdReport.agents).toHaveLength(1);
    expect(thirdReport.agents[0].cache).toMatchObject({
      hit: true,
      callId: "pause-plan"
    });
  }, 420000);
});
