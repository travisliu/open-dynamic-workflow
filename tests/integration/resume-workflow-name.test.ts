import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-resume-by-name-integration");

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
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderrData.push(args.join(" ") + "\n");
  });

  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    error = err;
    if (err instanceof Error && stderrData.length === 0) {
      stderrData.push(err.message);
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Integration - resume workflow by name", () => {
  const WORKFLOWS_SRC = path.resolve("tests/fixtures/workflows/run-by-name");
  const WORKFLOWS_DEST = path.join(TEMP_DIR, "workflows");
  const CONFIG_DEST = path.join(TEMP_DIR, "config.yaml");

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(WORKFLOWS_DEST, { recursive: true });
    await fs.cp(WORKFLOWS_SRC, WORKFLOWS_DEST, { recursive: true });

    // Write a local config file pointing to the copied workflows
    await fs.writeFile(
      CONFIG_DEST,
      `defaultProvider: mock
concurrency: 1
timeoutMs: 10000

providers:
  mock:
    command: mock
    responses:
      default:
        text: "mock response"
      review-auth:
        json:
          findings: []
  opencode:
    command: node
    args:
      - tests/fixtures/providers/fake-provider-cli.mjs
    format: json

workflow:
  discovery:
    include:
      - workflows/**/*.js
  maxDepth: 5

reporting:
  mode: pretty

security:
  passEnv: []
  redactEnv: []
  allowWorkflowImports: false

sharedAgents:
  dir: agents
  maxDefinitions: 100
  allowDynamicIds: false
  strictPromptTemplateVariables: true

tools:
  dir: non-existent-tools
`
    );
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("resumes a name-based run successfully", async () => {
    // 1. Initial run by name
    const initialResult = await runCli([
      "run",
      "review",
      "--cwd",
      TEMP_DIR,
      "--config",
      CONFIG_DEST,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    expect(initialResult.error).toBeNull();
    const initialReport = JSON.parse(initialResult.stdout);
    const runId = initialReport.runId;

    // 2. Resume the run
    const resumeResult = await runCli([
      "resume",
      runId,
      "--cwd",
      TEMP_DIR,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    expect(resumeResult.error).toBeNull();
    const resumeReport = JSON.parse(resumeResult.stdout);
    
    // Verify metadata preservation
    expect(resumeReport.workflow.name).toBe("review");
    expect(resumeReport.workflow.requestedTarget).toBe("review");
    expect(resumeReport.workflow.targetKind).toBe("workflow-name");
    expect(resumeReport.workflow.file).toContain("review.workflow.js");

    // Verify run-input.json in the NEW run directory
    const newRunId = resumeReport.runId;
    const runInput = JSON.parse(await fs.readFile(path.join(TEMP_DIR, newRunId, "run-input.json"), "utf8"));
    expect(runInput.requestedTarget).toBe("review");
    expect(runInput.targetKind).toBe("workflow-name");
    expect(runInput.workflowName).toBe("review");
  });

  it("fails resume if recorded workflow file identity changed", async () => {
    // 1. Initial run by name
    const initialResult = await runCli([
      "run",
      "review",
      "--cwd",
      TEMP_DIR,
      "--config",
      CONFIG_DEST,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    const initialReport = JSON.parse(initialResult.stdout);
    const runId = initialReport.runId;
    const recordedFile = path.resolve(TEMP_DIR, initialReport.workflow.file);

    // 2. Modify the recorded workflow file's meta.name
    const originalContent = await fs.readFile(recordedFile, "utf8");
    await fs.writeFile(recordedFile, originalContent.replace('name: "review"', 'name: "review-v2"'));

    try {
      // 3. Attempt resume
      const resumeResult = await runCli([
        "resume",
        runId,
        "--cwd",
        TEMP_DIR,
        "--out",
        TEMP_DIR
      ]);

      expect(resumeResult.error).toBeDefined();
      expect(resumeResult.stderr).toContain("meta.name changed");
    } finally {
      // Restore file
      await fs.writeFile(recordedFile, originalContent);
    }
  });

  it("supports run --resume with name resolution", async () => {
    // 1. Initial run by name to create cache
    const initialResult = await runCli([
      "run",
      "review",
      "--cwd",
      TEMP_DIR,
      "--config",
      CONFIG_DEST,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);
    const runId = JSON.parse(initialResult.stdout).runId;

    // 2. Run again with --resume
    const resumeResult = await runCli([
      "run",
      "review",
      "--resume",
      runId,
      "--cwd",
      TEMP_DIR,
      "--config",
      CONFIG_DEST,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    expect(resumeResult.error).toBeNull();
    const resumeReport = JSON.parse(resumeResult.stdout);
    expect(resumeReport.workflow.name).toBe("review");
    // Cache hits should occur
    expect(resumeReport.agents[0].cache?.hit).toBe(true);
  });
});
