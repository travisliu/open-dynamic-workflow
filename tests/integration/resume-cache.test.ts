import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-resume-cache");

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

async function listRunDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("resume/cache", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.OPENFLOW_FAKE_CODEX_COUNTER;
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("reuses a successful agent result from a previous run with the same workflow hash", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    const fakeCodexPath = path.resolve("tests/fixtures/fake-codex-plain.mjs");

    await fs.writeFile(workflowPath, `
export const meta = { name: "resume-cache", description: "resume cache test" };

const result = await agent({ id: "stable-agent", provider: "codex", prompt: "hello cache" });
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
    - OPENFLOW_FAKE_CODEX_COUNTER
`, "utf8");

    process.env.OPENFLOW_FAKE_CODEX_COUNTER = counterPath;

    const first = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(first.error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");

    const [firstRunId] = await listRunDirs(runsDir);
    expect(firstRunId).toBeDefined();

    const second = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir, "--resume", firstRunId!]);
    expect(second.error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");

    const runIds = await listRunDirs(runsDir);
    expect(runIds).toHaveLength(2);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const cacheHit = JSON.parse(
      await fs.readFile(path.join(runsDir, secondRunId, "agents/stable-agent/cache-hit.json"), "utf8")
    );

    expect(cacheHit.callId).toBe("stable-agent");
    expect(cacheHit.previousAgentId).toBe("stable-agent");
  });
});
