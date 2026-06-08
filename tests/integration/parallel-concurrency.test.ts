import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-tc-04");

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

describe("Parallel execution and global concurrency limit", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("parallel() runs multiple agents", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/parallel-concurrency.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/parallel-concurrency.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "--concurrency",
      "3",
      "--arg",
      "subcase=04.01"
    ]);

    if (result.error) {
      console.error(result.stderr);
    }
    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    expect(report.status).toBe("succeeded");
    expect(report.agents.length).toBe(3);

    // Verify all agents succeeded
    for (const agentResult of report.agents) {
      expect(agentResult.ok).toBe(true);
      expect(agentResult.status).toBe("succeeded");
    }

    // Verify result object preserves branch names
    expect(report.result).toBeDefined();
    expect(report.result.results).toBeDefined();
    expect(report.result.results.agent1).toBeDefined();
    expect(report.result.results.agent2).toBeDefined();
    expect(report.result.results.agent3).toBeDefined();

    expect(report.result.results.agent1.id).toBe("agent1");
    expect(report.result.results.agent2.id).toBe("agent2");
    expect(report.result.results.agent3.id).toBe("agent3");
  });

  it("Global concurrency limit is enforced", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/parallel-concurrency.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/parallel-concurrency.config.yaml");

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl",
      "--concurrency",
      "2",
      "--arg",
      "subcase=04.02"
    ]);

    if (result.error) {
      console.error(result.stderr);
    }
    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const eventsPath = path.join(runDir, "events.jsonl");
    const eventsContent = await fs.readFile(eventsPath, "utf8");
    const events = eventsContent
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    // Assert: No more than two agents are in running state at the same time
    let activeAgents = 0;
    let maxActiveAgents = 0;
    let completedCount = 0;
    let queuedCount = 0;

    for (const event of events) {
      if (event.type === "agent.queued") {
        queuedCount++;
      } else if (event.type === "agent.started") {
        activeAgents++;
        maxActiveAgents = Math.max(maxActiveAgents, activeAgents);
      } else if (
        event.type === "agent.completed" ||
        event.type === "agent.failed" ||
        event.type === "agent.timed_out" ||
        event.type === "agent.cancelled"
      ) {
        activeAgents--;
        completedCount++;
      }
    }

    expect(maxActiveAgents).toBeLessThanOrEqual(2);
    expect(maxActiveAgents).toBeGreaterThan(0);
    expect(completedCount).toBe(5);
    expect(queuedCount).toBe(5);

    // Verify final report
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(report.status).toBe("succeeded");
    expect(report.agents.length).toBe(5);
    for (const agentResult of report.agents) {
      expect(agentResult.ok).toBe(true);
    }

    // Verify queuing before later starts
    const firstTwoStarted = events.filter(e => e.type === "agent.started").slice(0, 2);
    const thirdStarted = events.filter(e => e.type === "agent.started")[2];
    const firstCompleted = events.find(e => e.type === "agent.completed");
    
    // The third agent should only start AFTER at least one agent has completed
    const thirdStartedIndex = events.indexOf(thirdStarted);
    const firstCompletedIndex = events.indexOf(firstCompleted);
    
    expect(thirdStartedIndex).toBeGreaterThan(firstCompletedIndex);
  });

  it("parallel() waits for all branches to settle by default", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/parallel-concurrency.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/parallel-concurrency.config.yaml");

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
      "subcase=04.03"
    ]);

    if (result.error) {
      console.error(result.stderr);
    }
    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    // Workflow completes successfully because it handles the results (returns them)
    expect(report.status).toBe("succeeded");
    expect(report.agents.length).toBe(3);

    const results = report.result;
    expect(results["success-quick"]).toBeDefined();
    expect(results["fail-quick"]).toBeDefined();
    expect(results["success-slow"]).toBeDefined();

    // success-quick: one succeeds
    expect(results["success-quick"].ok).toBe(true);
    expect(results["success-quick"].status).toBe("succeeded");

    // fail-quick: one fails
    expect(results["fail-quick"].ok).toBe(false);
    expect(results["fail-quick"].status).toBe("failed");
    expect(results["fail-quick"].error.message).toContain("Quick failure error");

    // success-slow: one succeeds after a delay
    expect(results["success-slow"].ok).toBe(true);
    expect(results["success-slow"].status).toBe("succeeded");
    expect(results["success-slow"].durationMs).toBeGreaterThanOrEqual(190); // 200ms delay; allow 10ms timer jitter
  });

  it("Mixed parallel workflows keep per-agent permission state (AC-13)", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/parallel-concurrency.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/parallel-concurrency.config.yaml");

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
      "subcase=04.04"
    ]);

    if (result.error) {
      console.error(result.stderr);
    }
    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    expect(report.status).toBe("succeeded");
    expect(report.agents.length).toBe(2);

    const agentDefault = report.agents.find((a: any) => a.id === "agent-default");
    const agentFullAccess = report.agents.find((a: any) => a.id === "agent-full-access");

    expect(agentDefault).toBeDefined();
    expect(agentDefault.permissions).toEqual({ mode: "default" });

    expect(agentFullAccess).toBeDefined();
    expect(agentFullAccess.permissions).toEqual({ mode: "dangerously-full-access" });
  });
});
