import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { exitCodeForError } from "../../src/errors/exit-codes.js";

const TEMP_DIR = path.resolve("tests/temp-tc-03");

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
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderrData.push(args.join(" ") + "\n");
  });

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

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

async function listRunDirs(): Promise<string[]> {
  const entries = await fs.readdir(TEMP_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

describe("Provider adapter execution", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Mock provider adapter succeeds", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "--arg",
      "subcase=03.01"
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify manifest
    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.status).toBe("succeeded");

    // Verify agent artifacts
    const agentDir = path.join(runDir, "agents/review-1");
    
    // 1. stdout.log
    const stdoutLog = await fs.readFile(path.join(agentDir, "stdout.log"), "utf8");
    expect(stdoutLog).toBe("Mock stdout for review-1");

    // 2. stderr.log
    const stderrLog = await fs.readFile(path.join(agentDir, "stderr.log"), "utf8");
    expect(stderrLog).toBe("Mock stderr for review-1");

    // 3. raw-result.json
    const rawResult = JSON.parse(await fs.readFile(path.join(agentDir, "raw-result.json"), "utf8"));
    expect(rawResult.text).toBe("Deterministic response for review-1");
    expect(rawResult.json).toEqual({ "status": "ok", "score": 10 });

    // 4. normalized-result.json
    const normalizedResult = JSON.parse(await fs.readFile(path.join(agentDir, "normalized-result.json"), "utf8"));
    expect(normalizedResult).toEqual({ "status": "ok", "score": 10 });

    // Verify report.json contains full agent details
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    const agentResult = report.agents.find((a: any) => a.id === "review-1");

    expect(agentResult).toBeDefined();
    expect(agentResult.ok).toBe(true);
    expect(agentResult.provider).toBe("mock");
    expect(agentResult.stdout).toBe("Mock stdout for review-1");
    expect(agentResult.stderr).toBe("Mock stderr for review-1");
    expect(agentResult.text).toBe("Deterministic response for review-1");
    expect(agentResult.json).toEqual({ "status": "ok", "score": 10 });
    expect(agentResult.exitCode).toBe(0);
    expect(typeof agentResult.durationMs).toBe("number");
    expect(agentResult.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("Mock provider-reported failure fails clearly even with zero exit code", async () => {
    const workflowPath = path.join(TEMP_DIR, "mock-provider-failure.workflow.js");
    const configPath = path.join(TEMP_DIR, "mock-provider-failure.config.yaml");
    await fs.writeFile(workflowPath, `
export const meta = { name: "mock-provider-failure", description: "provider failure metadata" };
const result = await agent({ id: "reported-failure", provider: "mock", prompt: "fail from provider" });
export default { result };
`, "utf8");
    await fs.writeFile(configPath, `
defaultProvider: mock
concurrency: 1
timeoutMs: 30000
providers:
  mock:
    command: mock
    responses:
      reported-failure:
        text: partial output
        exitCode: 0
        usage:
          inputTokens: 7
          outputTokens: 2
          totalTokens: 9
        providerThreadId: mock-thread-integration
        providerMetadata:
          source: integration-test
        failure:
          name: MockTerminalFailure
          message: provider reported failure
          code: PROVIDER_REPORTED_FAILURE
  codex:
    command: codex
  gemini:
    command: gemini
security:
  allowShell: false
  allowWorkflowImports: false
  passEnv: []
  redactEnv: []
reporting:
  mode: json
  verbose: false
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    expect(result.error).toBeNull();
    const [runId] = await listRunDirs();
    const report = JSON.parse(await fs.readFile(path.join(TEMP_DIR, runId!, "report.json"), "utf8"));
    const agentResult = report.agents.find((a: any) => a.id === "reported-failure");
    expect(agentResult.ok).toBe(false);
    expect(agentResult.error).toEqual({
      name: "MockTerminalFailure",
      message: "provider reported failure",
      code: "PROVIDER_REPORTED_FAILURE"
    });
    expect(agentResult.exitCode).toBe(0);
    expect(agentResult.usage).toEqual({ inputTokens: 7, outputTokens: 2, totalTokens: 9 });
    expect(agentResult.threadId).toBe("mock-thread-integration");
    expect(agentResult.providerMetadata).toEqual({ source: "integration-test" });
  });

  it("Fake Codex JSONL workflow persists usage and thread metadata", async () => {
    const fakeCodexPath = path.join(TEMP_DIR, "fake-codex-jsonl.mjs");
    const workflowPath = path.join(TEMP_DIR, "fake-codex-jsonl.workflow.js");
    const configPath = path.join(TEMP_DIR, "fake-codex-jsonl.config.yaml");
    await fs.writeFile(fakeCodexPath, `
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "codex-thread-integration" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "codex jsonl ok" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 11, cached_input_tokens: 5, output_tokens: 4, reasoning_output_tokens: 2 } }) + "\\n");
`, "utf8");
    await fs.writeFile(workflowPath, `
export const meta = { name: "fake-codex-jsonl", description: "fake Codex JSONL metadata" };
const result = await agent({ id: "codex-jsonl", provider: "codex", prompt: "emit metadata" });
export default { result };
`, "utf8");
    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
timeoutMs: 30000
providers:
  mock:
    command: mock
  codex:
    command: node
    args:
      - ${JSON.stringify(fakeCodexPath)}
    modelArg: false
  gemini:
    command: gemini
security:
  allowShell: false
  allowWorkflowImports: false
  passEnv: []
  redactEnv: []
reporting:
  mode: json
  verbose: false
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    expect(result.error).toBeNull();
    const [runId] = await listRunDirs();
    const runDir = path.join(TEMP_DIR, runId!);
    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    const agentResult = report.agents.find((a: any) => a.id === "codex-jsonl");
    expect(agentResult.ok).toBe(true);
    expect(agentResult.text).toBe("codex jsonl ok");
    expect(agentResult.threadId).toBe("codex-thread-integration");
    expect(agentResult.usage).toEqual({
      inputTokens: 11,
      cachedInputTokens: 5,
      outputTokens: 4,
      reasoningOutputTokens: 2,
      totalTokens: 15
    });
    expect(agentResult.providerMetadata).toEqual({
      usage: {
        input_tokens: 11,
        cached_input_tokens: 5,
        output_tokens: 4,
        reasoning_output_tokens: 2
      }
    });

    const rawResult = JSON.parse(await fs.readFile(path.join(runDir, "agents/codex-jsonl/raw-result.json"), "utf8"));
    expect(rawResult.format).toBe("codex-jsonl");
    expect(rawResult.events).toHaveLength(3);
  });

  it("Unknown provider returns clear error", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");

    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "--arg",
      "subcase=03.04"
    ]);

    // CLI exits with code 4.
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(4);

    // Error code is PROVIDER_UNAVAILABLE.
    expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");

    // Message includes the unknown provider name.
    expect(result.error.message).toContain("unknown-provider");

    // No run proceeds beyond provider resolution.
    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    
    expect(manifest.status).toBe("failed");
    expect(manifest.error.code).toBe("PROVIDER_UNAVAILABLE");
    
    // Ensure no agent output directory was created for the unknown provider
    const agentsDir = path.join(runDir, "agents");
    const agentsDirExists = await fs.access(agentsDir).then(() => true).catch(() => false);
    if (agentsDirExists) {
        const agentFolders = await fs.readdir(agentsDir);
        expect(agentFolders.length).toBe(0);
    }
  });
});
