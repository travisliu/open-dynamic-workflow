import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-workflow-context-cache");
const WORKFLOWS_DIR = path.join(TEMP_DIR, "workflows");
const BASE_RUNS_DIR = path.join(TEMP_DIR, "base-runs");
const CONTEXT_RUNS_DIR = path.join(TEMP_DIR, "context-runs");
const CONFIG_PATH = path.join(TEMP_DIR, "open-dynamic-workflow.config.yaml");

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
    await main(["node", "open-dynamic-workflow", ...args]);
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
    error,
  };
}

async function writeWorkflow(fileName: string, source: string): Promise<string> {
  const workflowPath = path.join(WORKFLOWS_DIR, fileName);
  await fs.writeFile(workflowPath, source, "utf8");
  return workflowPath;
}

async function writeConfig(): Promise<void> {
  const workflowGlob = path.join(WORKFLOWS_DIR, "**/*.workflow.js");
  await fs.writeFile(
    CONFIG_PATH,
    `
defaultProvider: mock
providers:
  mock:
    command: mock
workflow:
  discovery:
    include:
      - ${JSON.stringify(workflowGlob)}
`,
    "utf8"
  );
}

async function listRunDirs(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readAgentFingerprint(runDir: string): Promise<string> {
  const calls = await fs.readFile(path.join(runDir, "calls.jsonl"), "utf8");
  const agentEntry = calls
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((entry) => entry.kind === "agent");

  if (!agentEntry) {
    throw new Error("Expected at least one cached agent entry");
  }

  return agentEntry.fingerprint;
}

describe("Workflow Context Cache Determinism", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
    await fs.mkdir(BASE_RUNS_DIR, { recursive: true });
    await fs.mkdir(CONTEXT_RUNS_DIR, { recursive: true });
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("keeps agent fingerprints stable when only context writes change, including resume runs", async () => {
    // Arrange
    const basePath = await writeWorkflow(
      "base.workflow.js",
      `
export const meta = { name: "context-cache-base", description: "base cache workflow" };

export default async () => {
  const result = await agent({
    id: "probe",
    provider: "mock",
    prompt: "cache probe"
  });

  return {
    text: result.text
  };
};
`
    );

    const contextPath = await writeWorkflow(
      "context.workflow.js",
      `
export const meta = { name: "context-cache-context", description: "context cache workflow" };

export default async () => {
  context.set("audit.before", "before");
  const result = await agent({
    id: "probe",
    provider: "mock",
    prompt: "cache probe"
  });
  context.set("audit.after", "after");

  return {
    text: result.text,
    audit: context.snapshot({ metadata: true })
  };
};
`
    );

    // Act
    const baseRun = await runCli([
      "run",
      basePath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      BASE_RUNS_DIR,
      "--report",
      "json",
    ]);

    const contextRun = await runCli([
      "run",
      contextPath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      CONTEXT_RUNS_DIR,
      "--report",
      "json",
    ]);

    // Assert
    expect(baseRun.error).toBeNull();
    expect(contextRun.error).toBeNull();

    const baseRunDirs = await listRunDirs(BASE_RUNS_DIR);
    const contextRunDirs = await listRunDirs(CONTEXT_RUNS_DIR);
    const baseRunDir = path.join(BASE_RUNS_DIR, baseRunDirs[0]!);
    const contextRunDir = path.join(CONTEXT_RUNS_DIR, contextRunDirs[0]!);

    const baseReport = await readJson(path.join(baseRunDir, "report.json"));
    const contextReport = await readJson(path.join(contextRunDir, "report.json"));

    const baseFingerprint = await readAgentFingerprint(baseRunDir);
    const contextFingerprint = await readAgentFingerprint(contextRunDir);

    expect(baseReport.status).toBe("succeeded");
    expect(contextReport.status).toBe("succeeded");
    expect(baseFingerprint).toBe(contextFingerprint);

    // Act
    const resume = await runCli([
      "resume",
      contextRunDirs[0]!,
      "--out",
      CONTEXT_RUNS_DIR,
      "--report",
      "json",
    ]);

    // Assert
    expect(resume.error).toBeNull();

    const resumedRunDirs = await listRunDirs(CONTEXT_RUNS_DIR);
    const resumedRunDir = path.join(
      CONTEXT_RUNS_DIR,
      resumedRunDirs.find((dir) => dir !== contextRunDirs[0])!
    );
    const resumedReport = await readJson(path.join(resumedRunDir, "report.json"));
    const resumedFingerprint = await readAgentFingerprint(resumedRunDir);

    expect(resumedReport.status).toBe("succeeded");
    expect(resumedReport.agents[0].cache?.hit).toBe(true);
    expect(resumedFingerprint).toBe(contextFingerprint);
  });
});
