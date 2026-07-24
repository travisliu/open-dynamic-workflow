import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { renderCliError } from "../../src/cli/error-output.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-profile-reporting-int");

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

  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  let error: any = null;

  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    error = err;
    if (stderrData.length === 0) {
      renderCliError(err, { argv: ["node", "open-dynamic-workflow", ...args] });
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Integration - Profile Reporting and Resume", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });

    // Create default discovery directories to satisfy validation
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/agents"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/tools"), { recursive: true });

    // Write a dummy workflow file
    const wfContent = `
export const meta = {
  name: "test-profile-reporting-workflow",
  description: "workflow to test profile reporting and resume"
};
phase("run");
log("Running test workflow");
const res = await agent({ prompt: "hello" });
export default { res };
`;
    await fs.writeFile(path.join(TEMP_DIR, "workflows/test.workflow.js"), wfContent);

    // Write a config yaml with a profile that contains a secret sentinel in args
    const configContent = `
defaultProvider: mock
concurrency: 2
timeoutMs: 30000

providers:
  mock:
    command: mock
    responses:
      default:
        text: "mock response"

profiles:
  fast:
    args: { iterations: 1, secret_arg: "SECRET_SENTINEL_123" }
    context: { mode: fast, secret_ctx: "CONTEXT_SECRET_SENTINEL_456" }
    run: { provider: mock }
`;
    await fs.writeFile(path.join(TEMP_DIR, "config.yaml"), configContent);
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("handles profile selection in pretty report mode and redacts secret sentinel", async () => {
    // We first run in json mode to find out where the run output directory was created
    const jsonRun = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/test.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--out",
      path.join(TEMP_DIR, "run-pretty-out"),
      "--profile",
      "fast",
      "--report",
      "json"
    ]);
    expect(jsonRun.error).toBeNull();
    const runId = JSON.parse(jsonRun.stdout).runId;

    // Run again in pretty mode
    const result = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/test.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--out",
      path.join(TEMP_DIR, "run-pretty-out"),
      "--profile",
      "fast",
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();
    const output = result.stdout;
    expect(output).toContain("Summary");
    expect(output).toContain("profile:   fast (config)");
    expect(output).not.toContain("SECRET_SENTINEL_123");
    expect(output).not.toContain("CONTEXT_SECRET_SENTINEL_456");
    expect(output).not.toContain("resolved");

    // Check saved report.json and events.jsonl
    const runDir = path.join(TEMP_DIR, "run-pretty-out", runId);
    const reportPath = path.join(runDir, "report.json");
    const eventsPath = path.join(runDir, "events.jsonl");

    const reportContent = await fs.readFile(reportPath, "utf8");
    const reportJson = JSON.parse(reportContent);
    expect(reportJson.profile).toBeDefined();
    expect(reportJson.profile.selected).toBe("fast");
    expect(reportJson.profile.resolved).toBeUndefined();
    expect(reportContent).not.toContain("SECRET_SENTINEL_123");
    expect(reportContent).not.toContain("CONTEXT_SECRET_SENTINEL_456");

    const eventsContent = await fs.readFile(eventsPath, "utf8");
    expect(eventsContent).not.toContain("SECRET_SENTINEL_123");
    expect(eventsContent).not.toContain("CONTEXT_SECRET_SENTINEL_456");
  });

  it("handles profile selection in json report mode and formats profile metadata compactly", async () => {
    const result = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/test.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--out",
      TEMP_DIR,
      "--profile",
      "fast",
      "--report",
      "json"
    ]);

    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.profile).toBeDefined();
    expect(parsed.profile.selected).toBe("fast");
    expect(parsed.profile.source).toBe("config");
    expect(parsed.profile.hash).toBeDefined();
    expect(parsed.profile.resolved).toBeUndefined();
    expect(result.stdout).not.toContain("SECRET_SENTINEL_123");
    expect(result.stdout).not.toContain("CONTEXT_SECRET_SENTINEL_456");
  });

  it("handles profile selection in jsonl report mode and ensures profile.resolved precedes execution", async () => {
    const result = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/test.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--out",
      TEMP_DIR,
      "--profile",
      "fast",
      "--report",
      "jsonl"
    ]);

    expect(result.error).toBeNull();
    const lines = result.stdout.trim().split("\n");
    const events = lines.map(line => JSON.parse(line));

    // Ensure monotonically increasing sequence
    for (let i = 0; i < events.length; i++) {
      expect(events[i].schemaVersion).toBe("open-dynamic-workflow.event.v1");
      if (i > 0) {
        expect(events[i].sequence).toBe(events[i - 1].sequence + 1);
      }
    }

    // Find the profile.resolved event
    const profileEventIndex = events.findIndex(e => e.type === "profile.resolved");
    expect(profileEventIndex).toBeGreaterThanOrEqual(0);
    const profileEvent = events[profileEventIndex];
    expect(profileEvent.payload.profile).toBeDefined();
    expect(profileEvent.payload.profile.selected).toBe("fast");
    expect(profileEvent.payload.profile.resolved).toBeUndefined();

    // The profile.resolved event must occur before workflow evaluation/start and agent/tool events
    const firstWorkflowOrAgentEventIndex = events.findIndex(e =>
      e.type === "workflow.started" ||
      e.type === "workflow.resolved" ||
      e.type.startsWith("agent.") ||
      e.type.startsWith("tool.")
    );

    expect(firstWorkflowOrAgentEventIndex).toBeGreaterThan(profileEventIndex);
    expect(result.stdout).not.toContain("SECRET_SENTINEL_123");
    expect(result.stdout).not.toContain("CONTEXT_SECRET_SENTINEL_456");
  });

  it("covers no-profile run in pretty, JSON, and JSONL modes", async () => {
    // 1. Pretty Mode
    const prettyResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/test.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--out",
      path.join(TEMP_DIR, "out-pretty"),
      "--report",
      "pretty"
    ]);
    expect(prettyResult.stdout).not.toContain("profile:");

    // 2. JSON Mode
    const jsonResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/test.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--out",
      path.join(TEMP_DIR, "out-json"),
      "--report",
      "json"
    ]);
    const parsedJson = JSON.parse(jsonResult.stdout);
    expect(parsedJson.profile).toBeUndefined();

    // 3. JSONL Mode
    const jsonlResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/test.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--out",
      path.join(TEMP_DIR, "out-jsonl"),
      "--report",
      "jsonl"
    ]);
    const lines = jsonlResult.stdout.trim().split("\n");
    const eventTypes = lines.map(line => JSON.parse(line).type);
    expect(eventTypes).not.toContain("profile.resolved");
  });

  it("reuses the recorded profile settings on resume and prints it properly", async () => {
    // Run initially to produce the run artifacts
    const runResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/test.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--out",
      path.join(TEMP_DIR, "initial-run"),
      "--profile",
      "fast",
      "--report",
      "json"
    ]);

    expect(runResult.error).toBeNull();
    const parsedInit = JSON.parse(runResult.stdout);
    const runId = parsedInit.runId;

    // Verify run-input.json exists and contains resolved profile details
    const runDir = path.join(TEMP_DIR, "initial-run", runId);
    const runInputPath = path.join(runDir, "run-input.json");
    const runInputContent = await fs.readFile(runInputPath, "utf8");
    const runInput = JSON.parse(runInputContent);
    expect(runInput.profile).toBeDefined();
    expect(runInput.profile.selected).toBe("fast");
    expect(runInput.profile.resolved).toBeDefined();

    // Now resume the workflow in pretty mode
    const resumeResult = await runCli([
      "resume",
      runId,
      "--out",
      path.join(TEMP_DIR, "initial-run"), // out must match where we store runs so resume can locate it
      "--report",
      "pretty"
    ]);

    expect(resumeResult.error).toBeNull();
    expect(resumeResult.stdout).toContain("profile:   fast");

    // Check JSON output of resumed run
    const resumeJsonResult = await runCli([
      "resume",
      runId,
      "--out",
      path.join(TEMP_DIR, "initial-run"),
      "--report",
      "json"
    ]);

    expect(resumeJsonResult.error).toBeNull();
    const parsedResume = JSON.parse(resumeJsonResult.stdout);
    expect(parsedResume.profile).toBeDefined();
    expect(parsedResume.profile.selected).toBe("fast");
    expect(parsedResume.profile.source).toBe("config");
    expect(parsedResume.profile.resumedFromRecordedProfile).toBeUndefined();
  });
});
