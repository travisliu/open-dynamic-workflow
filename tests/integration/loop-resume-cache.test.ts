import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-loop-resume-cache");

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

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    error = err;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Loop Resume/Cache Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("resumes loop with cache hits on unchanged replay", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-resume-cache.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    // 1. First run to generate the cache index
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result1.error).toBeNull();
    const parsed1 = JSON.parse(result1.stdout);
    const runId1 = parsed1.runId;
    expect(runId1).toBeDefined();

    const runDir1 = path.join(TEMP_DIR, runId1);

    // 2. Assert loop marker behavior in cache index of first run
    const cacheIndexPath = path.join(runDir1, "cache-index.json");
    const cacheIndex = JSON.parse(await fs.readFile(cacheIndexPath, "utf8"));
    const loopEntries = cacheIndex.entries.filter((e: any) => e.kind === "loop");
    expect(loopEntries.length).toBeGreaterThan(0);
    for (const entry of loopEntries) {
      expect(entry.fingerprint).toBeDefined();
      expect(typeof entry.fingerprint).toBe("string");
      expect(entry.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.state).toBeUndefined();
      expect(entry.result).toBeUndefined();
    }

    // 3. Second run: resume from first
    const result2 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--resume", runId1,
      "--report", "jsonl"
    ]);

    expect(result2.error).toBeNull();

    // 4. Assert cache hits in second run
    const lines = result2.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    const cacheHits = events.filter(e => e.type === "agent.cache_hit");
    expect(cacheHits.length).toBeGreaterThan(0);

    // 5. Assert cache-hit.json exists in second run's agent directory
    const runs = await fs.readdir(TEMP_DIR);
    const runDir2Name = runs.find(r => r !== runId1);
    expect(runDir2Name).toBeDefined();
    const runDir2 = path.join(TEMP_DIR, runDir2Name!);
    
    const cacheHitJsonPath = path.join(runDir2, "agents/resume-loop:round-1:resume/cache-hit.json");
    const cacheHitStat = await fs.stat(cacheHitJsonPath);
    expect(cacheHitStat).toBeDefined();
  });

  it("stops prefix cache reuse at the first mismatch", async () => {
    const workflowPath1 = path.resolve("tests/fixtures/workflows/loop-resume-cache.workflow.js");
    const workflowPath2 = path.resolve("tests/fixtures/workflows/loop-resume-mismatch.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    // 1. Run first workflow to populate cache
    const result1 = await runCli([
      "run",
      workflowPath1,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);
    expect(result1.error).toBeNull();
    const parsed1 = JSON.parse(result1.stdout);
    const runId1 = parsed1.runId;

    // 2. Resume using the second workflow (which has a mismatch initial state)
    const result2 = await runCli([
      "run",
      workflowPath2,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--resume", runId1,
      "--report", "jsonl"
    ]);
    expect(result2.error).toBeNull();

    // 3. Assert that no cache hit events occurred because prefix cache reuse stopped at mismatch
    const lines = result2.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    const cacheHits = events.filter(e => e.type === "agent.cache_hit");
    expect(cacheHits).toHaveLength(0);
  });

  it("resumes loop with cache hits when nested result is stored in loop state", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-resume-cache-nested-result.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    // 1. First run
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result1.error).toBeNull();
    const parsed1 = JSON.parse(result1.stdout);
    const runId1 = parsed1.runId;
    expect(runId1).toBeDefined();

    // 2. Second run: resume
    const result2 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--resume", runId1,
      "--report", "jsonl"
    ]);

    expect(result2.error).toBeNull();

    // 3. Assert that cache hits continue through all rounds (both round 1 and round 2)
    const lines = result2.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    const cacheHits = events.filter(e => e.type === "agent.cache_hit");
    expect(cacheHits.length).toBe(2);
  });

  it("resumes nested workflow loop without disabling cache immediately", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-resume-nested-parent.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/loop-integration.config.yaml");

    // 1. First run
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result1.error).toBeNull();
    const parsed1 = JSON.parse(result1.stdout);
    const runId1 = parsed1.runId;

    // First-run assertions
    const runDir1 = path.join(TEMP_DIR, runId1);
    const agentDir1 = path.join(runDir1, "agents/resume-nested-parent-loop:round-1:nested-child-agent");
    const agentDir2 = path.join(runDir1, "agents/resume-nested-parent-loop:round-2:nested-child-agent");
    const unscopedDir = path.join(runDir1, "agents/nested-child-agent");

    expect(await fs.stat(agentDir1).then(() => true, () => false)).toBe(true);
    expect(await fs.stat(agentDir2).then(() => true, () => false)).toBe(true);
    expect(await fs.stat(unscopedDir).then(() => true, () => false)).toBe(false);

    // Check calls.jsonl
    const callsJsonlPath = path.join(runDir1, "calls.jsonl");
    const callsContent = await fs.readFile(callsJsonlPath, "utf8");
    const calls = callsContent.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
    const agentCalls = calls.filter(c => c.kind === "agent");

    expect(agentCalls).toHaveLength(2);
    expect(agentCalls[0].callId).toBe("resume-nested-parent-loop:round-1:nested-child-agent");
    expect(agentCalls[1].callId).toBe("resume-nested-parent-loop:round-2:nested-child-agent");

    // 2. Second run: resume
    const result2 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--resume", runId1,
      "--report", "jsonl"
    ]);

    expect(result2.error).toBeNull();

    // 3. Assert cache hits for nested workflow agent calls
    const lines = result2.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    const cacheHits = events.filter(e => e.type === "agent.cache_hit");
    expect(cacheHits.length).toBe(2);
  });

  it("scopes child workflow agent IDs inside loop rounds, generating correct artifact paths and distinct cache call IDs", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-nested-repeated-parent.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/loop-integration.config.yaml");

    // 1. Run once
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result1.error).toBeNull();
    const parsed1 = JSON.parse(result1.stdout);
    const runId1 = parsed1.runId;
    const runDir1 = path.join(TEMP_DIR, runId1);

    // 2. Assert both round-scoped agent artifact directories exist
    const agentDir1 = path.join(runDir1, "agents/repeated-parent-loop:round-1:test-permissions-agent");
    const agentDir2 = path.join(runDir1, "agents/repeated-parent-loop:round-2:test-permissions-agent");
    const unscopedDir = path.join(runDir1, "agents/test-permissions-agent");

    expect(await fs.stat(agentDir1).then(() => true, () => false)).toBe(true);
    expect(await fs.stat(agentDir2).then(() => true, () => false)).toBe(true);
    expect(await fs.stat(unscopedDir).then(() => true, () => false)).toBe(false);

    // 3. Inspect calls.jsonl and assert distinct round-scoped call IDs
    const callsJsonlPath = path.join(runDir1, "calls.jsonl");
    const callsContent = await fs.readFile(callsJsonlPath, "utf8");
    const calls = callsContent.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
    const agentCalls = calls.filter(c => c.kind === "agent");

    expect(agentCalls).toHaveLength(2);
    expect(agentCalls[0].callId).toBe("repeated-parent-loop:round-1:test-permissions-agent");
    expect(agentCalls[1].callId).toBe("repeated-parent-loop:round-2:test-permissions-agent");

    // 4. Assert loop nested-calls.json contains correct round-scoped child agent IDs
    const nestedCalls1 = JSON.parse(await fs.readFile(path.join(runDir1, "loops/repeated-parent-loop/rounds/0001/nested-calls.json"), "utf8"));
    const nestedCalls2 = JSON.parse(await fs.readFile(path.join(runDir1, "loops/repeated-parent-loop/rounds/0002/nested-calls.json"), "utf8"));
    expect(nestedCalls1.agents).toContain("repeated-parent-loop:round-1:test-permissions-agent");
    expect(nestedCalls2.agents).toContain("repeated-parent-loop:round-2:test-permissions-agent");

    // 5. Resume and assert cache hits happen for both scoped child agents
    const result2 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--resume", runId1,
      "--report", "jsonl"
    ]);

    expect(result2.error).toBeNull();
    const lines = result2.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    const cacheHits = events.filter(e => e.type === "agent.cache_hit");
    expect(cacheHits.length).toBe(2);
  });

  it("keeps existing agent ID behavior for non-loop child workflows", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-nested-repeated-child.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/loop-integration.config.yaml");

    // Run child workflow directly (outside loop context)
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result1.error).toBeNull();
    const parsed1 = JSON.parse(result1.stdout);
    const runId1 = parsed1.runId;
    const runDir1 = path.join(TEMP_DIR, runId1);

    // Assert that the agent directory is NOT loop-scoped, but stays unscoped: agents/test-permissions-agent
    const unscopedDir = path.join(runDir1, "agents/test-permissions-agent");
    expect(await fs.stat(unscopedDir).then(() => true, () => false)).toBe(true);
  });

  it("detects cache mismatch and disables cache hits when loop initial state changes but first prompt/ID remains unchanged", async () => {
    const workflowPath1 = path.resolve("tests/fixtures/workflows/loop-resume-cache.workflow.js");
    const workflowPath2 = path.resolve("tests/fixtures/workflows/loop-resume-state-mismatch.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

    // 1. Run first workflow to populate cache
    const result1 = await runCli([
      "run",
      workflowPath1,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);
    expect(result1.error).toBeNull();
    const parsed1 = JSON.parse(result1.stdout);
    const runId1 = parsed1.runId;

    // 2. Resume using the second workflow (which has a mismatch initial state, but same first agent prompt)
    const result2 = await runCli([
      "run",
      workflowPath2,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--resume", runId1,
      "--report", "jsonl"
    ]);
    expect(result2.error).toBeNull();

    // 3. Assert that no cache hit events occurred because the loop-start marker mismatched
    const lines = result2.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    const cacheHits = events.filter(e => e.type === "agent.cache_hit");
    expect(cacheHits).toHaveLength(0);
  });
});

