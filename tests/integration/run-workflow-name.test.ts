import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";
import { renderCliError } from "../../src/cli/error-output.js";

const TEMP_DIR = path.resolve("tests/temp-run-by-name-integration");

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

  // Mock process.exit to prevent the test runner from exiting
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

describe("Integration - run workflow by name", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("runs a workflow by name successfully", async () => {
    const result = await runCli([
      "run",
      "review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();
    
    // Assert pretty output ordering: header first, then workflow path
    const stdoutLines = result.stdout.trim().split("\n");
    expect(stdoutLines[0]).toBe("◇ review");
    expect(stdoutLines[1]).toContain("  file: tests/fixtures/workflows/run-by-name/review.workflow.js");

    expect(result.stdout).toContain("◇ review");
    expect(result.stdout).toContain("tests/fixtures/workflows/run-by-name/review.workflow.js");

    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify run-input.json
    const runInputPath = path.join(runDir, "run-input.json");
    const runInput = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    expect(runInput.requestedTarget).toBe("review");
    expect(runInput.targetKind).toBe("workflow-name");
    expect(runInput.workflowName).toBe("review");
    expect(runInput.workflowFile).toContain("tests/fixtures/workflows/run-by-name/review.workflow.js");

    // Verify manifest.json
    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.workflow.name).toBe("review");
    expect(manifest.workflow.requestedTarget).toBe("review");
    expect(manifest.workflow.targetKind).toBe("workflow-name");

    // Verify report.json
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(report.workflow.name).toBe("review");
    expect(report.workflow.requestedTarget).toBe("review");
  });

  it("runs a workflow by path successfully (backward compatibility)", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/run-by-name/explicit-path.workflow.js",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeNull();
    
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const runInput = JSON.parse(await fs.readFile(path.join(runDir, "run-input.json"), "utf8"));
    expect(runInput.targetKind).toBe("workflow-file");
    expect(runInput.workflowName).toBe("explicit-path-test");
  });

  it("fails when duplicate workflow names exist", async () => {
    const result = await runCli([
      "run",
      "duplicate-review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("Multiple workflows found");
    expect(result.stderr).toContain("duplicate-a.workflow.js");
    expect(result.stderr).toContain("duplicate-b.workflow.js");
  });

  it("fails clearly when name discovery fails due to non-existent directory during run", async () => {
    const result = await runCli([
      "run",
      "review",
      "--config",
      "tests/fixtures/config/bad-discovery.config.yaml",
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe("WORKFLOW_DISCOVERY_FAILED");
    expect(result.stderr).toContain("non-existent-directory-random");
  });

  it("runs by explicit path even if duplicate names exist elsewhere", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/run-by-name/duplicate-a.workflow.js",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeNull();
    
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);
    const manifest = JSON.parse(await fs.readFile(path.join(runDir, "manifest.json"), "utf8"));
    expect(manifest.workflow.file).toContain("duplicate-a.workflow.js");
  });

  it("succeeds even when unrelated invalid workflows are in scope", async () => {
    const result = await runCli([
      "run",
      "review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("◇ review");
  });

  it("fails when running the executable-invalid workflow itself by name", async () => {
    const result = await runCli([
      "run",
      "executable-invalid-unrelated",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("Workflow validation failed");
  });

  it("verifies JSON output mode", async () => {
    const result = await runCli([
      "run",
      "review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    expect(result.error).toBeNull();
    
    // Stdout should be a single valid JSON document without event lines
    expect(result.stdout.trim().startsWith("{")).toBe(true);
    expect(result.stdout.trim().endsWith("}")).toBe(true);
    expect(result.stdout).not.toContain("open-dynamic-workflow.event.v1");
    
    const report = JSON.parse(result.stdout);
    expect(report.workflow.name).toBe("review");
    expect(report.workflow.targetKind).toBe("workflow-name");
    
    // No pretty glyphs
    expect(result.stdout).not.toContain("◇");
    expect(result.stdout).not.toContain("→");
  });

  it("verifies JSONL output mode and events.jsonl", async () => {
    const result = await runCli([
      "run",
      "review",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl"
    ]);

    expect(result.error).toBeNull();

    const lines = result.stdout.trim().split("\n");
    const events = lines.map(l => JSON.parse(l));

    const resolvedEvent = events.find(e => e.type === "workflow.resolved");
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload.requestedTarget).toBe("review");
    expect(resolvedEvent.payload.workflowName).toBe("review");

    // Verify workflow.resolved is first and appears before execution events
    const resolvedEventIndex = events.findIndex(e => e.type === "workflow.resolved");
    const startedEventIndex = events.findIndex(e => e.type === "workflow.started");
    expect(resolvedEventIndex).toBe(0);
    expect(startedEventIndex).toBe(1);

    for (let i = 0; i < events.length; i++) {
      if (events[i].type.startsWith("agent.") || events[i].type.startsWith("tool.") || events[i].type.startsWith("pipeline.")) {
        expect(i).toBeGreaterThan(resolvedEventIndex);
      }
    }

    // Check sequence numbers
    for (let i = 1; i < events.length; i++) {
      expect(events[i].sequence).toBeGreaterThan(events[i-1].sequence);
    }

    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs[0]!;
    const eventsFile = path.join(TEMP_DIR, runId, "events.jsonl");
    const fileContent = await fs.readFile(eventsFile, "utf8");
    const fileEvents = fileContent.trim().split("\n").map(l => JSON.parse(l));
    
    expect(fileEvents.length).toBe(events.length);
    expect(fileEvents[0].type).toBe(events[0].type);
  });

  describe("initialization hints integration", () => {
    it("runs pretty preflight failure and shows hint on stderr", async () => {
      const workflowPath = path.join(TEMP_DIR, "missing-agent.workflow.js");
      await fs.writeFile(
        workflowPath,
        `export const meta = {
          name: "missing-agent",
          description: "References a missing shared agent"
        };
        phase("init");
        const result = await agent({ definition: "non-existent-agent" });
        export default { result };`
      );

      const result = await runCli(["run", workflowPath, "--cwd", TEMP_DIR, "--out", TEMP_DIR]);

      expect(result.error).toBeDefined();
      expect(result.stderr).toContain("Shared agent 'non-existent-agent' was not found");
      expect(result.stderr).toContain("Hint: This project may not be initialized yet");
      expect(result.stdout).toBe("");
    });

    it("runs json report preflight failure and writes exactly one JSON envelope to stdout", async () => {
      const workflowPath = path.join(TEMP_DIR, "missing-agent.workflow.js");
      await fs.writeFile(
        workflowPath,
        `export const meta = {
          name: "missing-agent",
          description: "References a missing shared agent"
        };
        phase("init");
        const result = await agent({ definition: "non-existent-agent" });
        export default { result };`
      );

      const result = await runCli(["run", workflowPath, "--cwd", TEMP_DIR, "--out", TEMP_DIR, "--report", "json"]);

      expect(result.error).toBeDefined();
      expect(result.stderr).toBe("");
      
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.schemaVersion).toBe("open-dynamic-workflow.error.v1");
      expect(parsed.status).toBe("failed");
      expect(parsed.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
      expect(parsed.error.hint).toBeDefined();
      expect(parsed.error.hint.code).toBe("PROJECT_INIT_MISSING");
    });

    it("runs jsonl report preflight failure and writes exactly one JSONL record to stdout", async () => {
      const workflowPath = path.join(TEMP_DIR, "missing-agent.workflow.js");
      await fs.writeFile(
        workflowPath,
        `export const meta = {
          name: "missing-agent",
          description: "References a missing shared agent"
        };
        phase("init");
        const result = await agent({ definition: "non-existent-agent" });
        export default { result };`
      );

      const result = await runCli(["run", workflowPath, "--cwd", TEMP_DIR, "--out", TEMP_DIR, "--report", "jsonl"]);

      expect(result.error).toBeDefined();
      expect(result.stderr).toBe("");

      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.schemaVersion).toBe("open-dynamic-workflow.error.v1");
      expect(parsed.type).toBe("cli.error");
      expect(parsed.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
      expect(parsed.error.hint).toBeDefined();
      expect(parsed.error.hint.code).toBe("PROJECT_INIT_MISSING");
    });
  });

  it("runs a workflow using a supported provider and propagates CLI thinking-effort option to run-input.json", async () => {
    const result = await runCli([
      "run",
      "opencode-test",
      "--config",
      "tests/fixtures/config/run-by-name.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty",
      "--thinking-effort",
      "high"
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    // Verify run-input.json contains thinkingEffort in rawOptions
    const runInputPath = path.join(runDir, "run-input.json");
    const runInput = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    expect(runInput.rawOptions.thinkingEffort).toBe("high");
  });
});
