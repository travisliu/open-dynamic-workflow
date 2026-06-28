import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-resumable-tools-aaa");
const FAKE_PROVIDER = path.resolve("tests/fixtures/fake-counter-provider.mjs");

async function runCli(args: string[]) {
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  let stdout = "";
  stdoutSpy.mockImplementation((chunk: any) => {
    stdout += chunk.toString();
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
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }

  return { error, stdout };
}

async function listRunDirs(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

describe("Resumable Tools AAA Acceptance Tests", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, "tools"), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER;
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Comprehensive Resume Lifecycle (RT-10)", async () => {
    // --- ARRANGE ---
    const workflowPath = path.join(TEMP_DIR, "workflows/main.ts");
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const runsDir = path.join(TEMP_DIR, "runs");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    const t1CounterPath = path.join(TEMP_DIR, "t1-counter.txt");
    const t2CounterPath = path.join(TEMP_DIR, "t2-counter.txt");
    const toolsDir = path.join(TEMP_DIR, "tools");

    // 1. Tool Definitions (Cacheable and Non-Cacheable)
    await fs.writeFile(path.join(toolsDir, "cacheable-tool.ts"), `
import * as fs from "node:fs";
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "cacheable-tool",
  description: "cacheable",
  inputSchema: { type: "object" },
  cacheable: true,
  run: (args) => {
    const counterPath = ${JSON.stringify(t1CounterPath)};
    let count = 0;
    try { count = parseInt(fs.readFileSync(counterPath, "utf8")); } catch {}
    fs.writeFileSync(counterPath, (count + 1).toString());
    return { result: "cacheable-ok", args };
  }
};`);

    await fs.writeFile(path.join(toolsDir, "live-tool.ts"), `
import * as fs from "node:fs";
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "live-tool",
  description: "non-cacheable",
  inputSchema: { type: "object" },
  cacheable: false,
  run: (args) => {
    const counterPath = ${JSON.stringify(t2CounterPath)};
    let count = 0;
    try { count = parseInt(fs.readFileSync(counterPath, "utf8")); } catch {}
    fs.writeFileSync(counterPath, (count + 1).toString());
    return { result: "live-ok", args };
  }
};`);

    // 2. Config
    await fs.writeFile(configPath, `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
security:
  passEnv:
    - OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER
tools:
  dir: ${JSON.stringify(path.relative(process.cwd(), toolsDir))}
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.relative(process.cwd(), path.join(TEMP_DIR, "workflows/**/*.ts")))}
`, "utf8");

    // 3. Initial Workflow
    const writeWorkflow = async (args: any = {}) => {
      await fs.writeFile(workflowPath, `
export const meta = { name: "test-workflow", description: "test" };
export default async (ctx) => {
  await ctx.agent({ id: "agent-1", prompt: "hello" });
  const t1 = await ctx.tool({ id: "t1", label: "t1", definition: "cacheable-tool", args: ${JSON.stringify(args.t1 || {})} });
  const t2 = await ctx.tool({ id: "t2", definition: "live-tool", args: {} });
  return { t1, t2 };
};`);
    };
    await writeWorkflow();

    // 4. Legacy Fixture: Create a run dir with legacy (agent-only, no kind) cache index
    const legacyRunId = "legacy-run-123";
    const legacyRunPath = path.join(runsDir, legacyRunId);
    await fs.mkdir(legacyRunPath, { recursive: true });
    await fs.writeFile(path.join(legacyRunPath, "run-input.json"), JSON.stringify({
      schemaVersion: "open-dynamic-workflow.run-input.v1",
      runId: legacyRunId,
      workflowFile: workflowPath,
      rawOptions: { config: configPath }
    }));
    await fs.writeFile(path.join(legacyRunPath, "manifest.json"), JSON.stringify({
      runId: legacyRunId,
      workflowPath: workflowPath
    }));
    await fs.writeFile(path.join(legacyRunPath, "cache-index.json"), JSON.stringify({
      entries: [
        {
          // kind: "agent" is MISSING
          agentId: "agent-1",
          fingerprint: "agent-1-fp", // won't match exactly but tests compatibility
          status: "succeeded",
          resultPath: "agents/agent-1/output.json"
        }
      ]
    }));

    process.env.OPEN_DYNAMIC_WORKFLOW_FAKE_PROVIDER_COUNTER = counterPath;
    await fs.writeFile(counterPath, "0");
    await fs.writeFile(t1CounterPath, "0");
    await fs.writeFile(t2CounterPath, "0");

    // --- ACT & ASSERT ---

    // A. Initial Run
    const { error: err1, stdout: stdout1 } = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    if (err1) {
      console.log("Initial Run Error:", err1);
      console.log("Initial Run Stdout:", stdout1);
    }
    expect(err1).toBeNull();
    
    expect(await fs.readFile(counterPath, "utf8")).toBe("1"); // agent-1
    expect(await fs.readFile(t1CounterPath, "utf8")).toBe("1"); // t1
    expect(await fs.readFile(t2CounterPath, "utf8")).toBe("1"); // t2

    const runDirsAfterInitial = await listRunDirs(runsDir);
    const initialRunId = runDirsAfterInitial.find(id => id !== legacyRunId)!;

    // B. Resume Run 1: Exact Match (Expect Hits)
    const { error: err2, stdout: stdout2 } = await runCli(["resume", initialRunId, "--out", runsDir, "--report", "pretty"]);
    expect(err2).toBeNull();
    
    expect(await fs.readFile(counterPath, "utf8")).toBe("1"); // agent-1 (cached)
    expect(await fs.readFile(t1CounterPath, "utf8")).toBe("1"); // t1 (cached)
    expect(await fs.readFile(t2CounterPath, "utf8")).toBe("2"); // t2 (live)
    
    const runDirsAfterResume1 = await listRunDirs(runsDir);
    const resume1RunId = runDirsAfterResume1.find(id => id !== legacyRunId && id !== initialRunId)!;
    
    // Assert Artifact Materialization
    const t1ArtifactDir = path.join(runsDir, resume1RunId, "tools/t1");
    expect(await fs.stat(path.join(t1ArtifactDir, "output.json"))).toBeDefined();
    expect(await fs.stat(path.join(t1ArtifactDir, "cache-hit.json"))).toBeDefined();

    // C. Resume Run 2: Changed Tool Arguments (Expect Miss for t1)
    await writeWorkflow({ t1: { changed: true } });
    const { error: err3, stdout: stdout3 } = await runCli(["resume", resume1RunId, "--out", runsDir, "--report", "pretty"]);
    expect(err3).toBeNull();
    
    expect(await fs.readFile(counterPath, "utf8")).toBe("1"); // agent-1 (cached)
    expect(await fs.readFile(t1CounterPath, "utf8")).toBe("2"); // t1 re-executed
    expect(await fs.readFile(t2CounterPath, "utf8")).toBe("3"); // t2 re-executed
    
    expect(stdout3).not.toContain("t1 tool cache hit");

    // D. Resume Run 3: Changed Tool Identity (Expect Miss)
    await fs.writeFile(workflowPath, `
export const meta = { name: "test-workflow", description: "test" };
export default async (ctx) => {
  await ctx.agent({ id: "agent-1", prompt: "hello" });
  const t1 = await ctx.tool({ id: "t1-new-id", label: "t1-new", definition: "cacheable-tool", args: {} });
  const t2 = await ctx.tool({ id: "t2", definition: "live-tool", args: {} });
  return { t1, t2 };
};`);
    // Resume from initialRunId which had t1-id
    const { error: err4, stdout: stdout4 } = await runCli(["resume", initialRunId, "--out", runsDir, "--report", "pretty"]);
    expect(err4).toBeNull();
    expect(await fs.readFile(t1CounterPath, "utf8")).toBe("3"); // t1-new-id (live)
    expect(await fs.readFile(t2CounterPath, "utf8")).toBe("4"); // t2 (live)
    expect(stdout4).not.toContain("t1 tool cache hit");

    // E. Legacy Support Verification
    const { error: err5 } = await runCli(["resume", legacyRunId, "--out", runsDir]);
    expect(err5).toBeNull(); 
  });

  it("Path Traversal Rejection (AC11)", async () => {
    // --- ARRANGE ---
    const runsDir = path.join(TEMP_DIR, "traversal-runs");
    await fs.mkdir(runsDir, { recursive: true });
    
    const configPath = path.join(TEMP_DIR, "config-traversal.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflows/traversal.ts");
    const toolsDir = path.join(TEMP_DIR, "tools-traversal");
    await fs.mkdir(toolsDir, { recursive: true });

    await fs.writeFile(path.join(toolsDir, "tool.ts"), `
export default {
  [Symbol.for("open-dynamic-workflow.toolDefinition")]: true,
  id: "tool",
  description: "test",
  inputSchema: { type: "object" },
  cacheable: true,
  run: () => "ok"
};`);

    await fs.writeFile(configPath, `
tools:
  dir: ${JSON.stringify(path.relative(process.cwd(), toolsDir))}
workflow:
  discovery:
    include:
      - ${JSON.stringify(path.relative(process.cwd(), path.join(TEMP_DIR, "workflows/**/*.ts")))}
`, "utf8");

    await fs.writeFile(workflowPath, `
export const meta = { name: 'traversal', description: 'test' };
export default async (ctx) => {
  await ctx.tool({ definition: 'tool', args: {} });
};`);

    // 1. Valid Initial Run
    const { error: runErr } = await runCli(["run", workflowPath, "--config", configPath, "--out", runsDir]);
    expect(runErr).toBeNull();
    
    const runDirs = await listRunDirs(runsDir);
    const runId = runDirs[0];
    const runPath = path.join(runsDir, runId);

    // 2. Corrupt cache-index.json with traversal
    const indexPath = path.join(runPath, "cache-index.json");
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    index.entries[0].resultPath = "../../../etc/passwd";
    await fs.writeFile(indexPath, JSON.stringify(index), "utf8");

    // --- ACT & ASSERT ---
    const { error } = await runCli(["resume", runId, "--out", runsDir]);
    expect(error).not.toBeNull();
    expect(error.message).toContain("escapes previous run directory");
  });
});
