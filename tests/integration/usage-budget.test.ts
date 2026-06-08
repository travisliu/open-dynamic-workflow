import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-usage-budget");

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

async function firstRunReport(runsDir: string): Promise<any> {
  const runs = await fs.readdir(runsDir);
  expect(runs).toHaveLength(1);
  return JSON.parse(await fs.readFile(path.join(runsDir, runs[0]!, "report.json"), "utf8"));
}

describe("usage and soft budget", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    process.env.OPENFLOW_FAKE_CODEX_THREAD_ID = "thread-budget";
    process.env.OPENFLOW_FAKE_CODEX_INPUT_TOKENS = "10";
    process.env.OPENFLOW_FAKE_CODEX_CACHED_INPUT_TOKENS = "8";
    process.env.OPENFLOW_FAKE_CODEX_OUTPUT_TOKENS = "3";
    process.env.OPENFLOW_FAKE_CODEX_REASONING_TOKENS = "2";
  });

  afterEach(async () => {
    delete process.env.OPENFLOW_FAKE_CODEX_COUNTER;
    delete process.env.OPENFLOW_FAKE_CODEX_DELAY_MS;
    delete process.env.OPENFLOW_FAKE_CODEX_THREAD_ID;
    delete process.env.OPENFLOW_FAKE_CODEX_INPUT_TOKENS;
    delete process.env.OPENFLOW_FAKE_CODEX_CACHED_INPUT_TOKENS;
    delete process.env.OPENFLOW_FAKE_CODEX_OUTPUT_TOKENS;
    delete process.env.OPENFLOW_FAKE_CODEX_REASONING_TOKENS;
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("persists Codex usage and thread id in agent result and report summary", async () => {
    const fakeCodexPath = path.resolve("tests/fixtures/fake-codex-jsonl.mjs");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");

    await fs.writeFile(workflowPath, `
export const meta = { name: "usage", description: "usage test" };
const result = await agent("hello usage", { id: "usage-agent" });
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
    - OPENFLOW_FAKE_CODEX_THREAD_ID
    - OPENFLOW_FAKE_CODEX_INPUT_TOKENS
    - OPENFLOW_FAKE_CODEX_CACHED_INPUT_TOKENS
    - OPENFLOW_FAKE_CODEX_OUTPUT_TOKENS
    - OPENFLOW_FAKE_CODEX_REASONING_TOKENS
`, "utf8");

    const result = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(result.error).toBeNull();
    const report = await firstRunReport(runsDir);
    expect(report.agents[0].threadId).toBe("thread-budget");
    expect(report.agents[0].usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 8,
      outputTokens: 3,
      reasoningOutputTokens: 2,
      totalTokens: 13
    });
    expect(report.usageSummary).toMatchObject({ agentCount: 1, totalTokens: 13 });
  });

  it("stops before starting more live agents when max-agent-calls is reached", async () => {
    const fakeCodexPath = path.resolve("tests/fixtures/fake-codex-jsonl.mjs");
    const workflowPath = path.join(TEMP_DIR, "agent-calls.workflow.js");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-calls");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    process.env.OPENFLOW_FAKE_CODEX_COUNTER = counterPath;

    await fs.writeFile(workflowPath, `
export const meta = { name: "budget-calls", description: "budget calls" };
await agent("one", { id: "one" });
await agent("two", { id: "two" });
export default "done";
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
    - OPENFLOW_FAKE_CODEX_COUNTER
`, "utf8");

    const result = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir, "--max-agent-calls", "1"]);
    expect(result.error).toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const report = await firstRunReport(runsDir);
    expect(report.status).toBe("failed");
    expect(report.agents).toHaveLength(1);
  });

  it("stops after observed tokens exceed max-observed-tokens", async () => {
    const fakeCodexPath = path.resolve("tests/fixtures/fake-codex-jsonl.mjs");
    const workflowPath = path.join(TEMP_DIR, "observed.workflow.js");
    const configPath = path.join(TEMP_DIR, "config-observed.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-observed");
    const counterPath = path.join(TEMP_DIR, "counter-observed.txt");
    process.env.OPENFLOW_FAKE_CODEX_COUNTER = counterPath;

    await fs.writeFile(workflowPath, `
export const meta = { name: "budget-observed", description: "budget observed" };
await agent("one", { id: "one" });
await agent("two", { id: "two" });
export default "done";
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
    - OPENFLOW_FAKE_CODEX_COUNTER
    - OPENFLOW_FAKE_CODEX_INPUT_TOKENS
    - OPENFLOW_FAKE_CODEX_OUTPUT_TOKENS
`, "utf8");

    const result = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir, "--max-observed-tokens", "1"]);
    expect(result.error).toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const report = await firstRunReport(runsDir);
    expect(report.status).toBe("failed");
    expect(report.usageSummary.totalTokens).toBe(13);
  });

  it("fails the workflow when max-run-ms is exceeded", async () => {
    const fakeCodexPath = path.resolve("tests/fixtures/fake-codex-jsonl.mjs");
    const workflowPath = path.join(TEMP_DIR, "run-ms.workflow.js");
    const configPath = path.join(TEMP_DIR, "config-run-ms.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-run-ms");
    process.env.OPENFLOW_FAKE_CODEX_DELAY_MS = "1000";

    await fs.writeFile(workflowPath, `
export const meta = { name: "budget-run-ms", description: "budget run ms" };
await agent("slow", { id: "slow" });
export default "done";
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
`, "utf8");

    const result = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir, "--max-run-ms", "100"]);
    expect(result.error).toMatchObject({ code: "BUDGET_EXCEEDED" });
    const report = await firstRunReport(runsDir);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("BUDGET_EXCEEDED");
  });
});
