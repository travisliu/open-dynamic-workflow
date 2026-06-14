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
    await main(["node", "openflow", ...args]);
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
    - OPENFLOW_FAKE_PROVIDER_COUNTER
    - OPENFLOW_FAKE_PROVIDER_JSON
    - OPENFLOW_FAKE_PROVIDER_INVALID_JSON
    - OPENFLOW_FAKE_PROVIDER_FAIL_ON
    - OPENFLOW_FAKE_PROVIDER_EXIT_CODE
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
    delete process.env.OPENFLOW_FAKE_PROVIDER_COUNTER;
    delete process.env.OPENFLOW_FAKE_PROVIDER_JSON;
    delete process.env.OPENFLOW_FAKE_PROVIDER_INVALID_JSON;
    delete process.env.OPENFLOW_FAKE_PROVIDER_FAIL_ON;
    delete process.env.OPENFLOW_FAKE_PROVIDER_EXIT_CODE;
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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;
    process.env.OPENFLOW_FAKE_PROVIDER_INVALID_JSON = "1";

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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;
    process.env.OPENFLOW_FAKE_PROVIDER_FAIL_ON = "fail b";

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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

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
    process.env.OPENFLOW_FAKE_PROVIDER_COUNTER = counterPath;

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

  it("reports a clear usage error for runs without run-input.json", async () => {
    const runsDir = path.join(TEMP_DIR, "bad-runs");
    await fs.mkdir(path.join(runsDir, "run-without-input"), { recursive: true });

    const result = await runCli(["resume", "run-without-input", "--out", runsDir]);
    expect(result.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(result.error.message).toContain("run-input.json");
  });
});
