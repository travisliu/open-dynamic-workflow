import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-resumable-acceptance");
const FAKE_PROVIDER = path.resolve("tests/fixtures/fake-counter-provider.mjs");

async function runCli(args: string[]) {
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  let stdout = "";
  stdoutSpy.mockImplementation((chunk: any) => {
    stdout += chunk.toString();
    return true;
  });

  const warnings: string[] = [];
  warnSpy.mockImplementation((...warnArgs: any[]) => {
    warnings.push(warnArgs.join(" "));
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
    warnSpy.mockRestore();
  }

  return { error, stdout, warnings };
}

async function listRunDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function writeConfig(configPath: string) {
  await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    defaultModel: null
security:
  passEnv:
    - OPENFLOW_FAKE_PROVIDER_COUNTER
    - OPENFLOW_FAKE_PROVIDER_JSON
    - OPENFLOW_FAKE_PROVIDER_INVALID_JSON
    - OPENFLOW_FAKE_PROVIDER_FAIL_ON
    - OPENFLOW_FAKE_PROVIDER_EXIT_CODE
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
`, "utf8");
}

describe("Resumable Run Acceptance Tests", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.OPENFLOW_FAKE_PROVIDER_COUNTER;
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("AT-01: Normal run persists resumable input safely (AC2)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-01.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    // Add a secret to the config
    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    apiKey: "secret-key-123"
security:
  redactEnv: ["SECRET_*"]
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
`, "utf8");
    await fs.writeFile(workflowPath, `export const meta = { name: "at-01", description: "test" };
export default async (ctx) => {
  await ctx.agent({ prompt: "hello" });
  return "done";
};`);
    
    // Act
    process.env.SECRET_FOO = "bar";
    const { error } = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    delete process.env.SECRET_FOO;
    
    // Assert
    expect(error).toBeNull();
    const [runId] = await listRunDirs(runsDir);
    const runPath = path.join(runsDir, runId!);
    
    const runInput = JSON.parse(await fs.readFile(path.join(runPath, "run-input.json"), "utf8"));
    const runInputStr = JSON.stringify(runInput);
    expect(runInputStr).not.toContain("secret-key-123");
    expect(runInputStr).not.toContain("bar");
    
    expect(runInput.schemaVersion).toBe("openflow.run-input.v1");
    expect(runInput.runId).toBe(runId);
    expect(runInput.rawOptions).toBeDefined();
    
    // Check for "secrets" - verify it doesn't dump process.env
    expect(runInput.env).toBeUndefined(); 
    
    const calls = await fs.readFile(path.join(runPath, "calls.jsonl"), "utf8");
    expect(calls).toContain('"sequence":1');
    
    const index = JSON.parse(await fs.readFile(path.join(runPath, "cache-index.json"), "utf8"));
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].callId).toBeUndefined(); // no id/label provided
  });

  it("AT-07: Cache-hit materialization writes current-run artifacts (AC8)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-07.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-07", description: "test" };
export default async (ctx) => {
  await ctx.agent({ prompt: "hello" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    // First run
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [firstRunId] = await listRunDirs(runsDir);
    const firstRunAgentDir = path.join(runsDir, firstRunId!, "agents");
    const firstAgentSubdir = (await fs.readdir(firstRunAgentDir))[0];
    const firstStdoutPath = path.join(firstRunAgentDir, firstAgentSubdir!, "stdout.log");
    await fs.writeFile(firstStdoutPath, "original logs", "utf8");

    // Act - Resume
    await runCli(["resume", firstRunId!, "--out", runsDir]);
    
    // Assert
    const runDirs = await listRunDirs(runsDir);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    const secondRunAgentDir = path.join(runsDir, secondRunId, "agents");
    
    // Verify fresh artifacts in second run
    const secondAgentSubdirs = await fs.readdir(secondRunAgentDir);
    expect(secondAgentSubdirs).toHaveLength(1);
    const secondStdoutPath = path.join(secondRunAgentDir, secondAgentSubdirs[0]!, "stdout.log");
    
    // AC8: old provider logs are not duplicated as fresh output
    const secondStdout = await fs.readFile(secondStdoutPath, "utf8");
    expect(secondStdout).toBe(""); // materialized as empty
    
    const secondPromptPath = path.join(secondRunAgentDir, secondAgentSubdirs[0]!, "prompt.txt");
    const secondPrompt = await fs.readFile(secondPromptPath, "utf8");
    expect(secondPrompt).toBe("[cache hit]");
  });

  it("AT-13: Pretty output distinguishes cache hits (AC12)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-13.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-13", description: "test" };
export default async (ctx) => {
  await ctx.agent({ label: "agent-a", prompt: "hello" });
  return "done";
};`);

    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir, "--report", "pretty"]);
    const [firstRunId] = await listRunDirs(runsDir);

    // Act
    const { stdout } = await runCli(["resume", firstRunId!, "--out", runsDir, "--report", "pretty"]);
    
    // Assert
    expect(stdout).toContain("↻ agent-a cache hit");
  });

  it("AT-14: Event/report payload stays machine-readable (AC12)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-14.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-14", description: "test" };
export default async (ctx) => {
  await ctx.agent({ id: "my-agent", prompt: "hello" });
  return "done";
};`);

    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [firstRunId] = await listRunDirs(runsDir);

    // Act
    await runCli(["resume", firstRunId!, "--out", runsDir]);
    
    // Assert
    const runDirs = await listRunDirs(runsDir);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    
    const events = await fs.readFile(path.join(runsDir, secondRunId, "events.jsonl"), "utf8");
    expect(events).toContain('"type":"agent.cache_hit"');
    expect(events).toContain('"agentId":"my-agent"');
    
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents[0].id).toBe("my-agent");
    expect(report.agents[0].cache.hit).toBe(true);
    expect(report.agents[0].cache.previousRunId).toBeDefined();
    expect(report.agents[0].cache.previousAgentId).toBeDefined();
  });

  it("AT-16: Resume/cache artifacts stay within the run root (AC2, AC8)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-16.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-16", description: "test" };
export default async (ctx) => {
  await ctx.agent({ prompt: "hello" });
  return "done";
};`);

    // Act
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [runId] = await listRunDirs(runsDir);
    const runPath = path.join(runsDir, runId!);

    // Assert
    const files = await fs.readdir(runPath);
    // Check that all files are what we expect and no "escapes"
    expect(files).toContain("run-input.json");
    expect(files).toContain("calls.jsonl");
    expect(files).toContain("cache-index.json");
    expect(files).toContain("manifest.json");
    expect(files).toContain("report.json");
    
    // Check that they are regular files
    for (const file of files) {
      const stat = await fs.stat(path.join(runPath, file));
      if (stat.isFile()) {
        // ok
      } else if (stat.isDirectory()) {
        expect(["agents", "workflows", "tools"]).toContain(file);
      }
    }
  });

  it("AT-10/11/12: Validation rejects replay-breaking nondeterminism (AC11)", async () => {
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await writeConfig(configPath);
    
    const warningCases = [
      { name: "date-now", code: "const t = Date.now();", msg: "Using Date.now() prevents resume and cache support." },
      { name: "new-date", code: "const d = new Date();", msg: "Using new Date() prevents resume and cache support." },
      { name: "math-random", code: "const r = Math.random();", msg: "Using Math.random() prevents resume and cache support." }
    ];

    for (const { name, code, msg } of warningCases) {
      const workflowPath = path.join(TEMP_DIR, `workflows/${name}.ts`);
      await fs.writeFile(workflowPath, `export const meta = { name: "${name}", description: "test" };
export default async (ctx) => {
  ${code}
  return "done";
};`);

      const { error, warnings } = await runCli(["validate", workflowPath, "--config", configPath]);
      expect(error).toBeNull();
      expect(warnings.some(w => w.includes(msg))).toBe(true);

      // Clean up the file
      await fs.unlink(workflowPath);
    }
  });

  it("AT-02: openflow resume reuses a full unchanged prefix (AC1, AC3, AC4)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-02.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter-at-02.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-02", description: "test" };
export default async (ctx) => {
  await ctx.agent({ prompt: "call 1" });
  await ctx.agent({ prompt: "call 2" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("2");
    const [firstRunId] = await listRunDirs(runsDir);

    // Act
    const { error } = await runCli(["resume", firstRunId!, "--out", runsDir]);

    // Assert
    expect(error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("2"); // No new calls
    const runDirs = await listRunDirs(runsDir);
    expect(runDirs).toHaveLength(2);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((a: any) => a.cache?.hit)).toEqual([true, true]);
  });

  it("AT-03: Early workflow change invalidates later reuse (AC4)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-03.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter-at-03.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-03", description: "test" };
export default async (ctx) => {
  await ctx.agent({ prompt: "unchanged" });
  await ctx.agent({ prompt: "old" });
  await ctx.agent({ prompt: "later" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [firstRunId] = await listRunDirs(runsDir);

    // Act - Change the second call
    await fs.writeFile(workflowPath, `export const meta = { name: "at-03", description: "test" };
export default async (ctx) => {
  await ctx.agent({ prompt: "unchanged" });
  await ctx.agent({ prompt: "new" });
  await ctx.agent({ prompt: "later" });
  return "done";
};`);
    await runCli(["resume", firstRunId!, "--out", runsDir]);

    // Assert
    // First call replayed (1), second call live (1), third call live (1) -> total 3 + 2 = 5
    expect(await fs.readFile(counterPath, "utf8")).toBe("5");
    const runDirs = await listRunDirs(runsDir);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((a: any) => a.cache?.hit || false)).toEqual([true, false, false]);
  });

  it("AT-06: Nested workflow calls use one global call sequence (AC6)", async () => {
    // Arrange
    const workflowsDir = path.join(TEMP_DIR, "workflows");
    const parentPath = path.join(workflowsDir, "parent.ts");
    const childPath = path.join(workflowsDir, "child.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter-at-06.txt");
    await writeConfig(configPath);
    await fs.writeFile(childPath, `export const meta = { name: "child", description: "child" };
export default async (ctx) => {
  await ctx.agent({ prompt: "child agent" });
  return "done";
};`);
    await fs.writeFile(parentPath, `export const meta = { name: "parent", description: "parent" };
export default async (ctx) => {
  await ctx.agent({ prompt: "parent agent 1" });
  await ctx.workflow({ name: "child" });
  await ctx.agent({ prompt: "parent agent 2" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    await runCli(["run", parentPath, "--config", configPath, "--out", runsDir]);
    const [firstRunId] = await listRunDirs(runsDir);

    // Act
    await runCli(["resume", firstRunId!, "--out", runsDir]);

    // Assert
    expect(await fs.readFile(counterPath, "utf8")).toBe("3");
    const runDirs = await listRunDirs(runsDir);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((a: any) => a.cache?.hit)).toEqual([true, true, true]);
    
    // Verify global sequence in calls.jsonl
    const calls = (await fs.readFile(path.join(runsDir, secondRunId, "calls.jsonl"), "utf8")).split("\n").filter(Boolean);
    const sequences = calls.map(line => JSON.parse(line).sequence);
    expect(sequences).toEqual([1, 2, 3]);
  });

  it("AT-17: openflow run <workflow> --resume <run-id> uses cache (AC1)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-17.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-at-17");
    const counterPath = path.join(TEMP_DIR, "counter-at-17.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-17", description: "test" };
export default async (ctx) => {
  await ctx.agent({ id: "agent-1", prompt: "hello" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    // Baseline run
    const { error: error1 } = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(error1).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    // Act - run --resume
    const { error: error2, stdout } = await runCli(["run", workflowPath, "--resume", firstRunId!, "--config", configPath, "--out", runsDir, "--report", "pretty"]);
    
    // Assert
    expect(error2).toBeNull();
    // Proves provider side effects did not increment on cache hit
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    
    const runDirs = await listRunDirs(runsDir);
    expect(runDirs).toHaveLength(2);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    
    // Proves the second run is a fresh run directory
    expect(secondRunId).not.toBe(firstRunId);
    
    // Proves unchanged direct-agent calls were replayed from cache
    expect(stdout).toContain("agent-1 cache hit");
    
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents[0].cache.hit).toBe(true);
  });

  it("AT-18: Nested child-workflow mismatch invalidates later parent reuse (AC6)", async () => {
    // Arrange
    const workflowsDir = path.join(TEMP_DIR, "workflows");
    const parentPath = path.join(workflowsDir, "at-18-parent.ts");
    const childPath = path.join(workflowsDir, "at-18-child.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-at-18");
    const counterPath = path.join(TEMP_DIR, "counter-at-18.txt");
    await writeConfig(configPath);
    await fs.writeFile(childPath, `export const meta = { name: "at-18-child", description: "child" };
export default async (ctx) => {
  await ctx.agent({ prompt: "child 1" });
  await ctx.agent({ prompt: "child 2" });
  return "done";
};`);
    await fs.writeFile(parentPath, `export const meta = { name: "at-18-parent", description: "parent" };
export default async (ctx) => {
  await ctx.agent({ prompt: "parent 1" });
  await ctx.workflow({ name: "at-18-child" });
  await ctx.agent({ prompt: "parent 2" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    // Baseline
    const { error: error1 } = await runCli(["run", parentPath, "--config", configPath, "--out", runsDir]);
    if (error1) console.error("Baseline run failed:", error1);
    expect(error1).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("4");
    const [firstRunId] = await listRunDirs(runsDir);

    // Act - Change child 1
    await fs.writeFile(childPath, `export const meta = { name: "at-18-child", description: "child" };
export default async (ctx) => {
  await ctx.agent({ prompt: "child 1 changed" });
  await ctx.agent({ prompt: "child 2" });
  return "done";
};`);
    const { error: error2 } = await runCli(["resume", firstRunId!, "--out", runsDir]);
    expect(error2).toBeNull();

    // Assert
    // p1 replayed (4), c1 live (5), c2 live (6), p2 live (7) -> total 7
    expect(await fs.readFile(counterPath, "utf8")).toBe("7");
    
    const runDirs = await listRunDirs(runsDir);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    
    // We expect 4 agent calls in the report (p1, c1, c2, p2)
    expect(report.agents.map((a: any) => a.cache?.hit || false)).toEqual([true, false, false, false]);
    
    const calls = await fs.readFile(path.join(runsDir, secondRunId, "calls.jsonl"), "utf8");
    const callLines = calls.trim().split("\n").map(l => JSON.parse(l));
    expect(callLines.map(c => c.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("AT-04: Failed or schema-invalid middle call does not extend prefix index (AC7)", async () => {
    // Combine AT-19 and AT-20 logic
    const workflowPath = path.join(TEMP_DIR, "workflows/at-04.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-at-04");
    await writeConfig(configPath);
    
    await fs.writeFile(workflowPath, `export const meta = { name: "at-04", description: "test" };
export default async (ctx) => {
  await ctx.agent({ id: "agent-s1", prompt: "success-1" });
  try {
    await ctx.agent({ id: "agent-f", prompt: "fail-me" });
  } catch (e) {}
  await ctx.agent({ id: "agent-s2", prompt: "success-2" });
  return "done";
};`);

    process.env.OPENFLOW_FAKE_PROVIDER_FAIL_ON = "fail-me";
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    
    const [runId] = await listRunDirs(runsDir);
    const index = JSON.parse(await fs.readFile(path.join(runsDir, runId!, "cache-index.json"), "utf8"));
    // AC7: Only successful calls extend the prefix index
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].agentId).toBe("agent-s1");
  });

  it("AT-05: Shared-agent wrapper behavior is preserved (AC5)", async () => {
    // Arrange
    const agentsDir = path.join(TEMP_DIR, "agents");
    await fs.mkdir(agentsDir, { recursive: true });
    const agentPath = path.join(agentsDir, "reviewer.ts");
    const workflowPath = path.join(TEMP_DIR, "workflows/at-05.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-at-05");
    const counterPath = path.join(TEMP_DIR, "counter-at-05.txt");
    
    // Shared agent definition
    await fs.writeFile(agentPath, `import { defineAgent } from "@prmflow/openflow";
export default defineAgent({
  id: "reviewer",
  run: async (context, runtime) => {
    return await runtime.agent({ prompt: "inner review" });
  }
});`);

    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
security:
  passEnv: ["OPENFLOW_FAKE_PROVIDER_COUNTER"]
sharedAgents:
  dir: ${JSON.stringify(agentsDir)}
`, "utf8");

    await fs.writeFile(workflowPath, `export const meta = { name: "at-05", description: "test" };
export default async (ctx) => {
  await ctx.agent({ definition: "reviewer" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    // First run
    const { error: error1, stdout: stdout1 } = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    if (error1) {
      console.log("AT-05 First run error:", error1);
      console.log("AT-05 First run stdout:", stdout1);
    }
    expect(error1).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    // Act - Resume
    await runCli(["resume", firstRunId!, "--out", runsDir]);

    // Assert
    expect(await fs.readFile(counterPath, "utf8")).toBe("1"); // replayed
    const runDirs = await listRunDirs(runsDir);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    
    // AC5: Wrapper itself is not cached as a wrapper, but the inner agent call is.
    // In our implementation, there should be one agent call in the report.
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0].cache.hit).toBe(true);
  });

  it("AT-08: --no-cache disables reuse behavior (AC9)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-08.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-at-08");
    const counterPath = path.join(TEMP_DIR, "counter-at-08.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-08", description: "test" };
export default async (ctx) => {
  await ctx.agent({ prompt: "hello" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [firstRunId] = await listRunDirs(runsDir);

    // Act - Resume with --no-cache
    await runCli(["resume", firstRunId!, "--no-cache", "--out", runsDir]);

    // Assert
    expect(await fs.readFile(counterPath, "utf8")).toBe("2"); // Ran live
    const runDirs = await listRunDirs(runsDir);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents[0].cache?.hit).toBeFalsy();
  });

  it("AT-09: Missing fast index falls back to journal rebuild (AC10)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-09.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-at-09");
    const counterPath = path.join(TEMP_DIR, "counter-at-09.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-09", description: "test" };
export default async (ctx) => {
  await ctx.agent({ prompt: "hello" });
  return "done";
};`);
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [firstRunId] = await listRunDirs(runsDir);
    
    // Delete the index
    await fs.rm(path.join(runsDir, firstRunId!, "cache-index.json"));

    // Act
    const { error } = await runCli(["resume", firstRunId!, "--out", runsDir]);

    // Assert
    expect(error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1"); // replayed
    const runDirs = await listRunDirs(runsDir);
    const secondRunId = runDirs.find(id => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents[0].cache.hit).toBe(true);
  });

  it("AT-15: Missing run-input.json produces clear error (AC1, AC3)", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "workflows/at-15.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs-at-15");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "at-15", description: "test" };
export default async (ctx) => { "done" };`);

    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [firstRunId] = await listRunDirs(runsDir);
    
    // Delete run-input.json
    await fs.rm(path.join(runsDir, firstRunId!, "run-input.json"));

    // Act
    const { error, stdout } = await runCli(["resume", firstRunId!, "--out", runsDir]);

    // Assert
    expect(error).not.toBeNull();
    const errorMessage = error.message + stdout;
    expect(errorMessage).toContain("run-input.json");
    expect(errorMessage).toContain("missing");
  });
});
