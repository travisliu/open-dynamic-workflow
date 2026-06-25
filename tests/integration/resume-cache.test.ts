import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-resume-cache");
const FAKE_PROVIDER = path.resolve("tests/fixtures/fake-counter-provider.mjs");

async function runCli(args: string[]) {
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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

  return { error };
}

async function listRunDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readCounter(counterPath: string): Promise<string> {
  return fs.readFile(counterPath, "utf8");
}

async function writeConfig(configPath: string, extraConfig: string = "") {
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
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_JSON
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_INVALID_JSON
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_FAIL_ON
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_EXIT_CODE
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
${extraConfig}
`, "utf8");
}

describe("resume/cache", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER;
    delete process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_JSON;
    delete process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_INVALID_JSON;
    delete process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_FAIL_ON;
    delete process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_EXIT_CODE;
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("resumes a sequential workflow through the friendly resume command without invoking the provider again", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/workflow.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    await writeConfig(configPath);
    const content = `export const meta = { name: "resume-cache", description: "resume cache test" };
export default async (ctx) => {
  const a = await ctx.agent({ id: "a", prompt: "first" });
  const b = await ctx.agent({ id: "b", prompt: "second" });
  return [a.text, b.text];
};`;
    await fs.writeFile(workflowPath, content, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");

    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((agent: any) => agent.cache?.hit)).toEqual([true, true]);
    expect(await fs.readFile(path.join(runsDir, secondRunId, "calls.jsonl"), "utf8")).toContain('"sequence":2');

    for (const agent of report.agents) {
      expect(agent.artifacts).toBeDefined();
      for (const value of Object.values(agent.artifacts)) {
        if (typeof value === "string") {
          expect(value).not.toContain(firstRunId);
        }
      }
      expect(agent.artifacts.permissionsPath).toBe(`agents/${agent.id}/permissions.json`);
    }
  });

  it("max-agent-calls prevents later live provider calls", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/max-agent-calls.workflow.ts");
    const configPath = path.join(TEMP_DIR, "max-agent-calls.config.yaml");
    const runsDir = path.join(TEMP_DIR, "max-agent-calls-runs");
    const counterPath = path.join(TEMP_DIR, "max-agent-calls-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "max-agent-calls", description: "max agent calls test" };
export default async (ctx) => {
  await ctx.agent({ id: "a", prompt: "first" });
  await ctx.agent({ id: "b", prompt: "second" });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      runsDir,
      "--max-agent-calls",
      "1"
    ]);

    expect(result.error?.code).toBe("RUN_LIMIT_EXCEEDED");
    expect(await readCounter(counterPath)).toBe("1");

    const [runId] = await listRunDirs(runsDir);
    const report = JSON.parse(await fs.readFile(path.join(runsDir, runId!, "report.json"), "utf8"));
    expect(report.status).toBe("failed");
    expect(report.agents.map((agent: any) => agent.id)).toEqual(["a"]);
    expect(report.limitSummary).toMatchObject({
      limits: { maxAgentCalls: 1 },
      agentCalls: 1,
      exceeded: true,
      exceededBy: "maxAgentCalls"
    });
  });

  it("does not count cache hits as live agent calls during resume", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/limited-resume.workflow.ts");
    const configPath = path.join(TEMP_DIR, "limited-resume.config.yaml");
    const runsDir = path.join(TEMP_DIR, "limited-resume-runs");
    const counterPath = path.join(TEMP_DIR, "limited-resume-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "limited-resume", description: "limited resume test" };
export default async (ctx) => {
  await ctx.agent({ id: "a", prompt: "first" });
  await ctx.agent({ id: "b", prompt: "second" });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      runsDir,
      "--max-agent-calls",
      "2"
    ])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli([
      "resume",
      firstRunId!,
      "--out",
      runsDir,
      "--max-agent-calls",
      "1"
    ])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");

    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((agent: any) => agent.cache?.hit)).toEqual([true, true]);
    expect(report.limitSummary).toMatchObject({
      limits: { maxAgentCalls: 1 },
      agentCalls: 0,
      exceeded: false
    });
  });

  it("uses longest unchanged prefix after the workflow script is edited", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/edited.workflow.ts");
    const configPath = path.join(TEMP_DIR, "edited.config.yaml");
    const runsDir = path.join(TEMP_DIR, "edited-runs");
    const counterPath = path.join(TEMP_DIR, "edited-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "edited-resume", description: "edited resume test" };
export default async (ctx) => {
  await ctx.agent({ id: "a", prompt: "unchanged a" });
  await ctx.agent({ id: "b", prompt: "old b" });
  await ctx.agent({ id: "c", prompt: "unchanged c" });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("3");
    const [firstRunId] = await listRunDirs(runsDir);

    await fs.writeFile(workflowPath, `export const meta = { name: "edited-resume", description: "edited resume test" };
export default async (ctx) => {
  await ctx.agent({ id: "a", prompt: "unchanged a" });
  await ctx.agent({ id: "b", prompt: "new b" });
  await ctx.agent({ id: "c", prompt: "unchanged c" });
  return "done";
};`, "utf8");

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("5");
    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((agent: any) => agent.cache?.hit || false)).toEqual([true, false, false]);
  });

  it("resumes parallel and fixed-loop workflows by invocation sequence", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/parallel-loop.workflow.ts");
    const configPath = path.join(TEMP_DIR, "parallel-loop.config.yaml");
    const runsDir = path.join(TEMP_DIR, "parallel-loop-runs");
    const counterPath = path.join(TEMP_DIR, "parallel-loop-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "parallel-loop", description: "parallel and loop resume test" };
export default async (ctx) => {
  await ctx.parallel({
    a: () => ctx.agent({ id: "parallel-a", prompt: "parallel a" }),
    b: () => ctx.agent({ id: "parallel-b", prompt: "parallel b" })
  });
  for (let i = 0; i < 3; i++) {
    await ctx.agent({ id: \`round-\${i}\`, prompt: \`round \${i}\` });
  }
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("5");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", path.join(runsDir, firstRunId!)])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("5");
  });

  it("does not cache schema validation failures", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/schema-invalid.workflow.ts");
    const configPath = path.join(TEMP_DIR, "schema-invalid.config.yaml");
    const runsDir = path.join(TEMP_DIR, "schema-invalid-runs");
    const counterPath = path.join(TEMP_DIR, "schema-invalid-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "schema-invalid", description: "schema invalid resume test" };
export default async (ctx) => {
  await ctx.agent({
    id: "schema-agent",
    prompt: "return schema",
    schema: { type: "object", properties: { status: { type: "string" } }, required: ["status"] },
    structuredOutput: { transport: "prompt" }
  });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_INVALID_JSON = "1";

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");
  });

  it("reuses only the successful prefix before a failed middle call", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/failed-middle.workflow.ts");
    const configPath = path.join(TEMP_DIR, "failed-middle.config.yaml");
    const runsDir = path.join(TEMP_DIR, "failed-middle-runs");
    const counterPath = path.join(TEMP_DIR, "failed-middle-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "failed-middle", description: "failed middle resume test" };
export default async (ctx) => {
  await ctx.agent({ id: "a", prompt: "ok a" });
  await ctx.agent({ id: "b", prompt: "fail b" });
  await ctx.agent({ id: "c", prompt: "ok c" });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_FAIL_ON = "fail b";

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("3");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("5");
  });

  it("--no-cache skips reads and cache-index writes but still writes calls.jsonl", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/no-cache.workflow.ts");
    const configPath = path.join(TEMP_DIR, "no-cache.config.yaml");
    const runsDir = path.join(TEMP_DIR, "no-cache-runs");
    const counterPath = path.join(TEMP_DIR, "no-cache-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "no-cache", description: "no cache resume test" };
export default async (ctx) => {
  await ctx.agent({ id: "a", prompt: "no cache" });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    const [firstRunId] = await listRunDirs(runsDir);
    expect((await runCli(["resume", firstRunId!, "--out", runsDir, "--no-cache"])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("2");

    const secondRunId = (await listRunDirs(runsDir)).find((id) => id !== firstRunId)!;
    const index = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "cache-index.json"), "utf8"));
    expect(index.entries).toEqual([]);
    expect(await fs.readFile(path.join(runsDir, secondRunId, "calls.jsonl"), "utf8")).toContain('"sequence":1');
  });

  it("falls back to calls.jsonl when cache-index.json is missing", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/journal.workflow.ts");
    const configPath = path.join(TEMP_DIR, "journal.config.yaml");
    const runsDir = path.join(TEMP_DIR, "journal-runs");
    const counterPath = path.join(TEMP_DIR, "journal-counter.txt");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "journal", description: "journal rebuild test" };
export default async (ctx) => {
  await ctx.agent({ id: "a", prompt: "journal a" });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    const [firstRunId] = await listRunDirs(runsDir);
    await fs.rm(path.join(runsDir, firstRunId!, "cache-index.json"), { force: true });

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("1");
  });

  it("resumes direct calls inside a shared agent wrapper", async () => {
    const agentsDir = path.join(TEMP_DIR, "agents");
    const workflowPath = path.join(TEMP_DIR, "workflows/shared-agent.workflow.ts");
    const configPath = path.join(TEMP_DIR, "shared-agent.config.yaml");
    const runsDir = path.join(TEMP_DIR, "shared-agent-runs");
    const counterPath = path.join(TEMP_DIR, "shared-agent-counter.txt");
    await fs.mkdir(agentsDir, { recursive: true });
    
    await writeConfig(configPath, `sharedAgents:\n  dir: ${JSON.stringify(agentsDir)}\n`);

    await fs.writeFile(path.join(agentsDir, "wrapper.ts"), `export default defineAgent({
  id: "wrapper",
  run: async (input, ctx) => {
    return await ctx.agent({ prompt: "inner" });
  }
});`, "utf8");

    await fs.writeFile(workflowPath, `export const meta = { name: "shared-agent-resume", description: "shared agent resume test" };
export default async (ctx) => {
  await ctx.agent({ definition: "wrapper" });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("1");
    
    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    // The inner agent call should be a cache hit
    expect(report.agents[0].cache?.hit).toBe(true);
  });

  it("resumes nested workflow calls with a global monotonic sequence", async () => {
    const workflowsDir = path.join(TEMP_DIR, "workflows");
    const parentPath = path.join(workflowsDir, "parent.ts");
    const childPath = path.join(workflowsDir, "child.ts");
    const configPath = path.join(TEMP_DIR, "nested.config.yaml");
    const runsDir = path.join(TEMP_DIR, "nested-runs");
    const counterPath = path.join(TEMP_DIR, "nested-counter.txt");
    // Dir already created in beforeEach
    
    await writeConfig(configPath);

    await fs.writeFile(childPath, `export const meta = { name: "child", description: "child" };
export default async (ctx) => {
  await ctx.agent({ prompt: "child agent" });
  return "done";
};`, "utf8");

    await fs.writeFile(parentPath, `export const meta = { name: "parent", description: "parent" };
export default async (ctx) => {
  await ctx.agent({ prompt: "parent agent 1" });
  await ctx.workflow({ name: "child" });
  await ctx.agent({ prompt: "parent agent 2" });
  return "done";
};`, "utf8");
    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

    expect((await runCli(["run", parentPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("3");
    const [firstRunId] = await listRunDirs(runsDir);

    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await readCounter(counterPath)).toBe("3");
    
    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents.map((a: any) => a.cache?.hit)).toEqual([true, true, true]);
  });

  it("resumes a cacheable tool on the next run without re-executing it", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/tool-cache.ts");
    const configPath = path.join(TEMP_DIR, "tool-cache.config.yaml");
    const runsDir = path.join(TEMP_DIR, "tool-cache-runs");
    const counterPath = path.join(TEMP_DIR, "tool-counter.txt");
    await writeConfig(configPath);
    
    // We'll use a tool that writes to a file to count executions
    const content = `
export const meta = { name: "tool-cache", description: "tool cache test" };
export default async (ctx) => {
  const res = await ctx.tool({
    definition: "count-tool",
    args: { foo: "bar" }
  });
  return res;
};`;
    await fs.writeFile(workflowPath, content, "utf8");

    // We need to register the tool. We can do this by creating a tool file and adding it to the config.
    const toolsDir = path.join(TEMP_DIR, "tools");
    await fs.mkdir(toolsDir, { recursive: true });
    await fs.writeFile(path.join(toolsDir, "count-tool.ts"), `
import * as fs from "node:fs";
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "count-tool",
  description: "counts executions",
  inputSchema: { type: "object" },
  cacheable: true,
  run: (args) => {
    const counterPath = ${JSON.stringify(counterPath)};
    let count = 0;
    try {
      count = parseInt(fs.readFileSync(counterPath, "utf8"));
    } catch {}
    count++;
    fs.writeFileSync(counterPath, count.toString());
    return { count, args };
  }
};`, "utf8");

    // Update config to include tools
    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
tools:
  dir: ${JSON.stringify(toolsDir)}
  maxDefinitions: 10
  concurrency: 1
`, "utf8");

    // First run
    expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    // Second run (Resume)
    expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1"); // Should NOT have incremented

    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    
    // Check report for cache hit
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.tools).toBeDefined();
    expect(report.tools[0].cache?.hit).toBe(true);
    expect(report.tools[0].status).toBe("succeeded");

    // Verify current-run artifacts
    const toolCallId = report.tools[0].toolCallId;
    const toolArtifactDir = path.join(runsDir, secondRunId, "tools", toolCallId);
    expect(await fs.stat(path.join(toolArtifactDir, "output.json"))).toBeDefined();
    expect(await fs.stat(path.join(toolArtifactDir, "cache-hit.json"))).toBeDefined();
    
    const output = JSON.parse(await fs.readFile(path.join(toolArtifactDir, "output.json"), "utf8"));
    expect(output).toEqual({ count: 1, args: { foo: "bar" } });
  });

  it("misses tool cache when arguments change", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/tool-miss.ts");
    const configPath = path.join(TEMP_DIR, "tool-miss.config.yaml");
    const runsDir = path.join(TEMP_DIR, "tool-miss-runs");
    const counterPath = path.join(TEMP_DIR, "tool-miss-counter.txt");
    const toolsDir = path.join(TEMP_DIR, "tools-miss");
    await fs.mkdir(toolsDir, { recursive: true });
    
    await fs.writeFile(path.join(toolsDir, "miss-tool.ts"), `
import * as fs from "node:fs";
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "miss-tool",
  description: "counts executions",
  inputSchema: { type: "object" },
  cacheable: true,
  run: (args) => {
    const counterPath = ${JSON.stringify(counterPath)};
    let count = 0;
    try {
      count = parseInt(fs.readFileSync(counterPath, "utf8"));
    } catch {}
    count++;
    fs.writeFileSync(counterPath, count.toString());
    return { count, args };
  }
};`, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
tools:
  dir: ${JSON.stringify(toolsDir)}
  maxDefinitions: 10
  concurrency: 1
`, "utf8");

    await fs.writeFile(workflowPath, `
export const meta = { name: "tool-miss", description: "tool miss test" };
export default async (ctx) => {
  await ctx.tool({ definition: "miss-tool", args: { val: 1 } });
  return "done";
};`, "utf8");

    // First run
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    // Edit workflow to change args
    await fs.writeFile(workflowPath, `
export const meta = { name: "tool-miss", description: "tool miss test" };
export default async (ctx) => {
  await ctx.tool({ definition: "miss-tool", args: { val: 2 } });
  return "done";
};`, "utf8");

    // Resume
    await runCli(["resume", firstRunId!, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("2"); // Should have incremented due to miss

    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.tools[0].cache?.hit || false).toBe(false);
  });

  it("misses tool cache when timeout or metadata change", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/tool-miss-meta.ts");
    const configPath = path.join(TEMP_DIR, "tool-miss-meta.config.yaml");
    const runsDir = path.join(TEMP_DIR, "tool-miss-meta-runs");
    const counterPath = path.join(TEMP_DIR, "tool-miss-meta-counter.txt");
    const toolsDir = path.join(TEMP_DIR, "tools-miss-meta");
    await fs.mkdir(toolsDir, { recursive: true });
    
    await fs.writeFile(path.join(toolsDir, "miss-tool.ts"), `
import * as fs from "node:fs";
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "miss-tool",
  description: "counts executions",
  inputSchema: { type: "object" },
  cacheable: true,
  run: (args) => {
    const counterPath = ${JSON.stringify(counterPath)};
    let count = 0;
    try {
      count = parseInt(fs.readFileSync(counterPath, "utf8"));
    } catch {}
    count++;
    fs.writeFileSync(counterPath, count.toString());
    return { count, args };
  }
};`, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
tools:
  dir: ${JSON.stringify(toolsDir)}
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
`, "utf8");

    await fs.writeFile(workflowPath, `
export const meta = { name: "tool-miss-meta", description: "test" };
export default async (ctx) => {
  await ctx.tool({ definition: "miss-tool", args: {}, timeoutMs: 1000 });
  return "done";
};`, "utf8");

    // First run
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    // Edit workflow to change timeout
    await fs.writeFile(workflowPath, `
export const meta = { name: "tool-miss-meta", description: "test" };
export default async (ctx) => {
  await ctx.tool({ definition: "miss-tool", args: {}, timeoutMs: 2000 });
  return "done";
};`, "utf8");

    // Resume
    await runCli(["resume", firstRunId!, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("2"); // Miss due to timeout change

    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== firstRunId)!;
    
    // Change metadata
    await fs.writeFile(workflowPath, `
export const meta = { name: "tool-miss-meta", description: "test" };
export default async (ctx) => {
  await ctx.tool({ definition: "miss-tool", args: {}, timeoutMs: 2000, metadata: { foo: "bar" } });
  return "done";
};`, "utf8");

    // Resume from second run
    await runCli(["resume", secondRunId!, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("3"); // Miss due to metadata change
  });

  it("misses tool cache when call ID changes", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/tool-miss-id.ts");
    const configPath = path.join(TEMP_DIR, "tool-miss-id.config.yaml");
    const runsDir = path.join(TEMP_DIR, "tool-miss-id-runs");
    const counterPath = path.join(TEMP_DIR, "tool-miss-id-counter.txt");
    const toolsDir = path.join(TEMP_DIR, "tools-miss-id");
    await fs.mkdir(toolsDir, { recursive: true });
    
    await fs.writeFile(path.join(toolsDir, "miss-tool.ts"), `
import * as fs from "node:fs";
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "miss-tool",
  description: "counts executions",
  inputSchema: { type: "object" },
  cacheable: true,
  run: (args) => {
    const counterPath = ${JSON.stringify(counterPath)};
    let count = 0;
    try {
      count = parseInt(fs.readFileSync(counterPath, "utf8"));
    } catch {}
    count++;
    fs.writeFileSync(counterPath, count.toString());
    return { count };
  }
};`, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
tools:
  dir: ${JSON.stringify(toolsDir)}
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
`, "utf8");

    await fs.writeFile(workflowPath, `
export const meta = { name: "tool-miss-id", description: "test" };
export default async (ctx) => {
  await ctx.tool({ id: "call-1", definition: "miss-tool", args: {} });
  return "done";
};`, "utf8");

    // First run
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    // Edit workflow to change call ID
    await fs.writeFile(workflowPath, `
export const meta = { name: "tool-miss-id", description: "test" };
export default async (ctx) => {
  await ctx.tool({ id: "call-2", definition: "miss-tool", args: {} });
  return "done";
};`, "utf8");

    // Resume
    await runCli(["resume", firstRunId!, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("2"); // Miss due to ID change
  });

  it("always executes non-cacheable tools live", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/tool-non-cacheable.ts");
    const configPath = path.join(TEMP_DIR, "tool-non-cacheable.config.yaml");
    const runsDir = path.join(TEMP_DIR, "tool-non-cacheable-runs");
    const counterPath = path.join(TEMP_DIR, "tool-non-cacheable-counter.txt");
    const toolsDir = path.join(TEMP_DIR, "tools-non-cacheable");
    await fs.mkdir(toolsDir, { recursive: true });
    
    await fs.writeFile(path.join(toolsDir, "live-tool.ts"), `
import * as fs from "node:fs";
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "live-tool",
  description: "counts executions",
  inputSchema: { type: "object" },
  cacheable: false,
  run: (args) => {
    const counterPath = ${JSON.stringify(counterPath)};
    let count = 0;
    try {
      count = parseInt(fs.readFileSync(counterPath, "utf8"));
    } catch {}
    count++;
    fs.writeFileSync(counterPath, count.toString());
    return { count };
  }
};`, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
tools:
  dir: ${JSON.stringify(toolsDir)}
  maxDefinitions: 10
  concurrency: 1
`, "utf8");

    await fs.writeFile(workflowPath, `
export const meta = { name: "non-cacheable", description: "test" };
export default async (ctx) => {
  await ctx.tool({ definition: "live-tool", args: {} });
  return "done";
};`, "utf8");

    // First run
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("1");
    const [firstRunId] = await listRunDirs(runsDir);

    // Resume
    await runCli(["resume", firstRunId!, "--out", runsDir]);
    expect(await fs.readFile(counterPath, "utf8")).toBe("2"); // Should have incremented again
  });

  it("does not cache failed tool calls", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/tool-fail.ts");
    const configPath = path.join(TEMP_DIR, "tool-fail.config.yaml");
    const runsDir = path.join(TEMP_DIR, "tool-fail-runs");
    const counterPath = path.join(TEMP_DIR, "tool-fail-counter.txt");
    const toolsDir = path.join(TEMP_DIR, "tools-fail");
    await fs.mkdir(toolsDir, { recursive: true });
    
    await fs.writeFile(path.join(toolsDir, "fail-tool.ts"), `
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "fail-tool",
  description: "fails on demand",
  inputSchema: { type: "object" },
  cacheable: true,
  run: (args) => {
    if (args.fail) throw new Error("intentional failure");
    return "ok";
  }
};`, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
tools:
  dir: ${JSON.stringify(toolsDir)}
  maxDefinitions: 10
  concurrency: 1
`, "utf8");

    await fs.writeFile(workflowPath, `
export const meta = { name: "tool-fail", description: "test" };
export default async (ctx) => {
  try {
    await ctx.tool({ definition: "fail-tool", args: { fail: true } });
  } catch (e) {}
  await ctx.agent({ prompt: "after fail" });
  return "done";
};`, "utf8");

    // First run
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [firstRunId] = await listRunDirs(runsDir);

    const index = JSON.parse(await fs.readFile(path.join(runsDir, firstRunId!, "cache-index.json"), "utf8"));
    // The failed tool should NOT be in the index. 
    // The agent call after it MIGHT be in the index if it succeeded, BUT 
    // according to the design, a non-success call disables further index growth.
    // So only entries BEFORE the fail should be there. Here nothing is before.
    expect(index.entries.filter((e: any) => e.kind === "tool")).toHaveLength(0);
  });

  it("loads legacy agent-only cache indexes", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/legacy.ts");
    const configPath = path.join(TEMP_DIR, "legacy.config.yaml");
    const runsDir = path.join(TEMP_DIR, "legacy-runs");
    await writeConfig(configPath);
    await fs.writeFile(workflowPath, `export const meta = { name: "legacy", description: "legacy" };
export default async (ctx) => {
  await ctx.agent({ id: "agent-1", prompt: "legacy" });
  return "done";
};`, "utf8");

    // First run to get a valid cache entry
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [runId] = await listRunDirs(runsDir);
    const runPath = path.join(runsDir, runId!);

    // Modify the cache index to remove "kind" field (simulating legacy)
    const indexPath = path.join(runPath, "cache-index.json");
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    for (const entry of index.entries) {
      delete entry.kind;
    }
    await fs.writeFile(indexPath, JSON.stringify(index), "utf8");

    // Resume should still work and hit the cache
    const { error } = await runCli(["resume", runId!, "--out", runsDir]);
    expect(error).toBeNull();

    const runIds = await listRunDirs(runsDir);
    const secondRunId = runIds.find((id) => id !== runId)!;
    const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
    expect(report.agents[0].cache?.hit).toBe(true);
  });

  it("rejects path traversal in tool cache entries", async () => {
    const workflowPath = path.join(TEMP_DIR, "workflows/traversal.ts");
    const configPath = path.join(TEMP_DIR, "traversal.config.yaml");
    const runsDir = path.join(TEMP_DIR, "traversal-runs");
    const toolsDir = path.join(TEMP_DIR, "tools-traversal");
    await fs.mkdir(toolsDir, { recursive: true });
    await fs.writeFile(path.join(toolsDir, "tool-1.ts"), `
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "tool-1",
  description: "test",
  inputSchema: { type: "object" },
  cacheable: true,
  run: () => "ok"
};`, "utf8");

    await fs.writeFile(configPath, `
tools:
  dir: ${JSON.stringify(toolsDir)}
  maxDefinitions: 10
  concurrency: 1
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
`, "utf8");

    await fs.writeFile(workflowPath, `export const meta = { name: "traversal", description: "traversal" };
export default async (ctx) => {
  await ctx.tool({ definition: "tool-1", args: {} });
  return "done";
};`, "utf8");

    // First run to get a valid cache entry
    await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    const [runId] = await listRunDirs(runsDir);
    const runPath = path.join(runsDir, runId!);

    // Modify the cache index to include a traversal path
    const indexPath = path.join(runPath, "cache-index.json");
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    index.entries[0].resultPath = "../../etc/passwd";
    await fs.writeFile(indexPath, JSON.stringify(index), "utf8");

    const { error } = await runCli(["resume", runId!, "--out", runsDir]);
    // It should fail with a usage error about path traversal
    expect(error).not.toBeNull();
    expect(error.message).toContain("escapes previous run directory");
  });

  it("reports a clear usage error for runs without run-input.json", async () => {
    const runsDir = path.join(TEMP_DIR, "bad-runs");
    await fs.mkdir(path.join(runsDir, "run-without-input"), { recursive: true });

    const result = await runCli(["resume", "run-without-input", "--out", runsDir]);
    expect(result.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(result.error.message).toContain("run-input.json");
  });

  describe("resume cache thinking effort behavior", () => {
    it("unchanged resolved effort yields an eligible cache hit", async () => {
      const workflowPath = path.join(TEMP_DIR, "workflows/thinking-hit.ts");
      const configPath = path.join(TEMP_DIR, "config.yaml");
      const runsDir = path.join(TEMP_DIR, "runs");
      const counterPath = path.join(TEMP_DIR, "counter.txt");
      await writeConfig(configPath);
      const content = `export const meta = { name: "thinking-hit", description: "thinking cache test" };
export default async (ctx) => {
  const a = await ctx.agent({ id: "a", prompt: "first", thinkingEffort: "medium" });
  return [a.text];
};`;
      await fs.writeFile(workflowPath, content, "utf8");
      process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

      expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("1");
      const [firstRunId] = await listRunDirs(runsDir);

      expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("1");

      const runIds = await listRunDirs(runsDir);
      const secondRunId = runIds.find((id) => id !== firstRunId)!;
      const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
      expect(report.agents[0].cache?.hit).toBe(true);
    });

    it("changing only per-agent effort yields a miss", async () => {
      const workflowPath = path.join(TEMP_DIR, "workflows/thinking-miss-agent.ts");
      const configPath = path.join(TEMP_DIR, "config.yaml");
      const runsDir = path.join(TEMP_DIR, "runs");
      const counterPath = path.join(TEMP_DIR, "counter.txt");
      await writeConfig(configPath);
      await fs.writeFile(workflowPath, `export const meta = { name: "thinking-miss-agent", description: "test" };
export default async (ctx) => {
  const a = await ctx.agent({ id: "a", prompt: "first", thinkingEffort: "medium" });
  return [a.text];
};`, "utf8");
      process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

      expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("1");
      const [firstRunId] = await listRunDirs(runsDir);

      // Change per-agent effort in the workflow file
      await fs.writeFile(workflowPath, `export const meta = { name: "thinking-miss-agent", description: "test" };
export default async (ctx) => {
  const a = await ctx.agent({ id: "a", prompt: "first", thinkingEffort: "high" });
  return [a.text];
};`, "utf8");

      expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("2"); // Incremented due to cache miss

      const runIds = await listRunDirs(runsDir);
      const secondRunId = runIds.find((id) => id !== firstRunId)!;
      const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
      expect(report.agents[0].cache?.hit || false).toBe(false);
    });

    it("run --resume with a new --thinking-effort value yields a miss", async () => {
      const workflowPath = path.join(TEMP_DIR, "workflows/thinking-miss-cli.ts");
      const configPath = path.join(TEMP_DIR, "config.yaml");
      const runsDir = path.join(TEMP_DIR, "runs");
      const counterPath = path.join(TEMP_DIR, "counter.txt");
      await writeConfig(configPath);
      await fs.writeFile(workflowPath, `export const meta = { name: "thinking-miss-cli", description: "test" };
export default async (ctx) => {
  const a = await ctx.agent({ id: "a", prompt: "first" });
  return [a.text];
};`, "utf8");
      process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

      expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("1");
      const [firstRunId] = await listRunDirs(runsDir);

      // Resume by running the workflow again with different CLI thinking effort
      expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir, "--resume", firstRunId!, "--thinking-effort", "low"])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("2"); // Incremented due to cache miss

      const runIds = await listRunDirs(runsDir);
      const secondRunId = runIds.find((id) => id !== firstRunId)!;
      const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
      expect(report.agents[0].cache?.hit || false).toBe(false);
    });

    it("changing only the selected provider's defaultThinkingEffort in the referenced config yields a miss", async () => {
      const workflowPath = path.join(TEMP_DIR, "workflows/thinking-miss-config.ts");
      const configPath = path.join(TEMP_DIR, "config.yaml");
      const runsDir = path.join(TEMP_DIR, "runs");
      const counterPath = path.join(TEMP_DIR, "counter.txt");
      // First run with no provider default thinking effort
      await writeConfig(configPath);
      await fs.writeFile(workflowPath, `export const meta = { name: "thinking-miss-config", description: "test" };
export default async (ctx) => {
  const a = await ctx.agent({ id: "a", prompt: "first" });
  return [a.text];
};`, "utf8");
      process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

      expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("1");
      const [firstRunId] = await listRunDirs(runsDir);

      // Change provider's defaultThinkingEffort in the config
      await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    defaultModel: null
    defaultThinkingEffort: medium
security:
  passEnv:
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_JSON
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_INVALID_JSON
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_FAIL_ON
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_EXIT_CODE
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.join(TEMP_DIR, "workflows/**/*.ts"))}
`, "utf8");

      expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("2"); // Incremented due to cache miss

      const runIds = await listRunDirs(runsDir);
      const secondRunId = runIds.find((id) => id !== firstRunId)!;
      const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
      expect(report.agents[0].cache?.hit || false).toBe(false);
    });

    it("for the standalone resume path, verify the stored CLI effort is replayed and can still hit", async () => {
      const workflowPath = path.join(TEMP_DIR, "workflows/thinking-replay.ts");
      const configPath = path.join(TEMP_DIR, "config.yaml");
      const runsDir = path.join(TEMP_DIR, "runs");
      const counterPath = path.join(TEMP_DIR, "counter.txt");
      await writeConfig(configPath);
      await fs.writeFile(workflowPath, `export const meta = { name: "thinking-replay", description: "test" };
export default async (ctx) => {
  const a = await ctx.agent({ id: "a", prompt: "first" });
  return [a.text];
};`, "utf8");
      process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;

      // Run with CLI thinking effort option
      expect((await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir, "--thinking-effort", "low"])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("1");
      const [firstRunId] = await listRunDirs(runsDir);

      // Replay standalone resume (which should read stored CLI effort: "low" and match the fingerprint)
      expect((await runCli(["resume", firstRunId!, "--out", runsDir])).error).toBeNull();
      expect(await readCounter(counterPath)).toBe("1"); // Cache hit, not incremented

      const runIds = await listRunDirs(runsDir);
      const secondRunId = runIds.find((id) => id !== firstRunId)!;
      const report = JSON.parse(await fs.readFile(path.join(runsDir, secondRunId, "report.json"), "utf8"));
      expect(report.agents[0].cache?.hit).toBe(true);
    });
  });
});
