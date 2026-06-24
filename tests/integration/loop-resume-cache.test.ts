import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-loop-resume-cache");

async function runCli(args: string[], cwd?: string) {
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

  const finalArgs = [...args];
  if (cwd) {
    finalArgs.push("--cwd", cwd);
  }

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...finalArgs]);
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

  it("resumes an unchanged non-tool loop from a prior-style cache index and confirms cache hits", async () => {
    const { stableHashJson } = await import("../../src/loop/replay.js");
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-resume-cache.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/mock.config.yaml");

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

    // 2. Read the cache index
    const cacheIndexPath = path.join(runDir1, "cache-index.json");
    const cacheIndex = JSON.parse(await fs.readFile(cacheIndexPath, "utf8"));

    // Find the loop-round entry
    const roundEntry = cacheIndex.entries.find((e: any) => e.sequence === 3);
    expect(roundEntry).toBeDefined();

    const expectedLegacyFingerprint = stableHashJson({
      kind: "loop-round",
      loopId: "resume-loop",
      label: "resume-loop",
      roundIndex: 0,
      roundNumber: 1,
      nestedCallSequence: ["resume-loop:round-1:resume"],
      stateBeforeHash: stableHashJson({ count: 0 }),
      stateAfterHash: stableHashJson({ count: 1 }),
      status: "completed"
    });

    expect(roundEntry.fingerprint).toBe(expectedLegacyFingerprint);

    // 3. Resume and assert cache hits
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
    expect(cacheHits.length).toBeGreaterThan(0);
  });

  it("resumes loop tool from cache, redacting secret-bearing tool metadata according to security.redactEnv", async () => {
    process.env.MY_TEST_TOKEN = "super-secret-arg-val";
    process.env.MY_TEST_SECRET = "my-secret-metadata-val";

    try {
      const tempProjDir = path.join(TEMP_DIR, "proj-redact");
      const toolsDir = path.join(tempProjDir, ".open-dynamic-workflow/tools");
      const workflowDir = path.join(tempProjDir, "workflows");
      const outDir = path.join(tempProjDir, "out");

      await fs.mkdir(toolsDir, { recursive: true });
      await fs.mkdir(workflowDir, { recursive: true });
      await fs.mkdir(outDir, { recursive: true });

      // 1. Create a cacheable tool
      const srcToolsPath = path.resolve(process.cwd(), "src/tools/index.ts");
      await fs.writeFile(path.join(toolsDir, "cache-tool.ts"), `
        import { defineTool } from "${srcToolsPath}";
        export default defineTool({
          id: "cache-tool",
          description: "cache-tool description",
          inputSchema: { type: "object", properties: { val: { type: "string" } } },
          cacheable: true,
          run: (input) => ({ reply: input.val })
        });
      `);

      // 2. Create the workflow calling this tool inside a loop
      const wfPath = path.join(workflowDir, "loop-tool.workflow.ts");
      await fs.writeFile(wfPath, `
        export const meta = { name: "loop-tool-wf", description: "desc" };
        export default async ({ loop }) => await loop({
          label: "loop-label",
          initialState: { count: 0 },
          options: { maxRounds: 1 },
          run: async (state, ctx) => {
            await ctx.tool({
              id: ctx.toolId("cache-tool"),
              definition: "cache-tool",
              args: { val: "super-secret-arg-val" },
              metadata: { customField: "my-secret-metadata-val" }
            });
            return { done: true, nextState: state };
          }
        });
      `);

      // 3. Create a config containing security.redactEnv for these secrets
      const configPath = path.join(tempProjDir, "config.yaml");
      await fs.writeFile(configPath, `
defaultProvider: mock
concurrency: 1
timeoutMs: 30000
security:
  passEnv: []
  redactEnv:
    - MY_TEST_TOKEN
    - MY_TEST_SECRET
`);

      // 4. First run (live execution)
      const result1 = await runCli([
        "run",
        wfPath,
        "--config", configPath,
        "--out", outDir,
        "--report", "json"
      ], tempProjDir);

      expect(result1.error).toBeNull();
      const parsed1 = JSON.parse(result1.stdout);
      const runId1 = parsed1.runId;
      expect(runId1).toBeDefined();

      const runDir1 = path.join(outDir, runId1);

      // Check first run artifacts for redaction
      const toolCallDir1 = path.join(runDir1, "tools/loop-label-round-1-tool-cache-tool");
      const input1 = JSON.parse(await fs.readFile(path.join(toolCallDir1, "input.json"), "utf8"));
      const meta1 = JSON.parse(await fs.readFile(path.join(toolCallDir1, "metadata.json"), "utf8"));

      expect(input1.val).toBe("[REDACTED]");
      expect(meta1.metadata.customField).toBe("[REDACTED]");

      // 5. Second run: resume from first run
      const result2 = await runCli([
        "run",
        wfPath,
        "--config", configPath,
        "--out", outDir,
        "--resume", runId1,
        "--report", "jsonl"
      ], tempProjDir);

      expect(result2.error).toBeNull();

      // Find the resumed run's output dir
      const runs = await fs.readdir(outDir);
      const runId2 = runs.find(r => r !== runId1);
      expect(runId2).toBeDefined();
      const runDir2 = path.join(outDir, runId2!);

      // Check resumed run artifacts for redaction
      const toolCallDir2 = path.join(runDir2, "tools/loop-label-round-1-tool-cache-tool");
      const input2 = JSON.parse(await fs.readFile(path.join(toolCallDir2, "input.json"), "utf8"));
      const meta2 = JSON.parse(await fs.readFile(path.join(toolCallDir2, "metadata.json"), "utf8"));

      expect(input2.val).toBe("[REDACTED]");
      expect(meta2.metadata.customField).toBe("[REDACTED]");
    } finally {
      delete process.env.MY_TEST_TOKEN;
      delete process.env.MY_TEST_SECRET;
    }
  });
});
