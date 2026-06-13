import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-verbose-logging");

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

describe("Integration - verbose agent logging", () => {
  const oldToken = process.env.OPENFLOW_VERBOSE_TEST_TOKEN;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    process.env.OPENFLOW_VERBOSE_TEST_TOKEN = "SECRET_FROM_ENV";
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    if (oldToken === undefined) {
      delete process.env.OPENFLOW_VERBOSE_TEST_TOKEN;
    } else {
      process.env.OPENFLOW_VERBOSE_TEST_TOKEN = oldToken;
    }
  });

  it("--report pretty -v prints command and result blocks to stdout", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty",
      "-v"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Agent command: verbose-review");
    expect(result.stdout).toMatch(/  Event: #\d+ \d{4}-\d{2}-\d{2}T/);
    expect(result.stdout).toContain("Agent result: verbose-review succeeded");
    expect(result.stdout).toMatch(/  Event: #\d+ \d{4}-\d{2}-\d{2}T/);
    expect(result.stdout).toContain("Prompt:");
    expect(result.stdout).toContain("stdout:");
    expect(result.stdout).toContain("stderr:");
    expect(result.stdout).toContain("Normalized response:");
    expect(result.stdout).toContain("Permissions: default");
    expect(result.stdout).toContain("Artifacts:");
    expect(result.stdout).toContain("    dir: agents/verbose-review");
    expect(result.stdout).toContain("    prompt: agents/verbose-review/prompt.txt");
    
    // Check redaction
    expect(result.stdout).not.toContain("SECRET_FROM_ENV");
    expect(result.stdout).toContain("[REDACTED]");
    
    // Stderr should be empty (no verbose blocks)
    expect(result.stderr).toBe("");
  });

  it("--report json -v writes verbose blocks to stderr and report to stdout", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "-v"
    ]);

    expect(result.error).toBeNull();
    
    // Stdout should be valid JSON
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    
    // Stderr should contain verbose blocks
    expect(result.stderr).toContain("Agent command: verbose-review");
    expect(result.stderr).toMatch(/  Event: #\d+ \d{4}-\d{2}-\d{2}T/);
    expect(result.stderr).toContain("Agent result: verbose-review succeeded");
    expect(result.stderr).toMatch(/  Event: #\d+ \d{4}-\d{2}-\d{2}T/);
    expect(result.stderr).toContain("Permissions: default");
    expect(result.stderr).toContain("Artifacts:");
    expect(result.stderr).toContain("    dir: agents/verbose-review");
    expect(result.stderr).toContain("    stdout: agents/verbose-review/stdout.log");
    
    // Check redaction in stderr
    expect(result.stderr).not.toContain("SECRET_FROM_ENV");
    expect(result.stderr).toContain("[REDACTED]");
  });

  it("--report jsonl -v writes events to stdout and verbose blocks to stderr", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl",
      "-v"
    ]);

    expect(result.error).toBeNull();
    
    // Stdout should be JSONL
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const event = JSON.parse(line);
      expect(event.schemaVersion).toBe("openflow.event.v1");
    }
    
    // Stderr should contain verbose blocks
    expect(result.stderr).toContain("Agent command: verbose-review");
    expect(result.stderr).toMatch(/  Event: #\d+ \d{4}-\d{2}-\d{2}T/);
    expect(result.stderr).toContain("Agent result: verbose-review succeeded");
    expect(result.stderr).toMatch(/  Event: #\d+ \d{4}-\d{2}-\d{2}T/);
    expect(result.stderr).toContain("Permissions: default");
    expect(result.stderr).toContain("Artifacts:");
    expect(result.stderr).toContain("    dir: agents/verbose-review");
    expect(result.stderr).toContain("    stdout: agents/verbose-review/stdout.log");
    
    // Check redaction in stderr
    expect(result.stderr).not.toContain("SECRET_FROM_ENV");
    expect(result.stderr).toContain("[REDACTED]");
  });

  it("running without verbose does not print verbose blocks", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).not.toContain("Agent command:");
    expect(result.stdout).not.toContain("Agent result:");
    expect(result.stderr).toBe("");
  });

  it("-v and --verbose produce equivalent verbose behavior", async () => {
    const result1 = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      path.join(TEMP_DIR, "v1"),
      "-v"
    ]);

    const result2 = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      path.join(TEMP_DIR, "v2"),
      "--verbose"
    ]);

    expect(result1.stdout).toContain("Agent command: verbose-review");
    expect(result2.stdout).toContain("Agent command: verbose-review");
    expect(result1.stdout).toContain("Agent result: verbose-review");
    expect(result2.stdout).toContain("Agent result: verbose-review");
  });

  it("failed mock agent still produces verbose command and result", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "-v",
      "-a", "subcase=fail"
    ]);

    expect(result.error).toBeDefined();
    expect(result.stdout).toContain("Agent command: review-fail");
    expect(result.stdout).toContain("Agent result: review-fail failed");
    expect(result.stdout).toContain("mock agent failure");
  });

  it("timed-out mock agent produces useful partial verbose logs", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "-v",
      "-a", "subcase=timeout"
    ]);

    expect(result.error).toBeDefined();
    expect(result.stdout).toContain("Agent command: verbose-timeout");
    expect(result.stdout).toContain("Agent result: verbose-timeout timed_out");
    expect(result.stdout).toContain("partial stdout");
    expect(result.stdout).toContain("partial stderr");
  });

  it("parallel agents produce grouped non-interleaved result blocks", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/parallel-concurrency.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "-v",
      "-a", "subcase=04.01"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Agent result: agent1");
    expect(result.stdout).toContain("Agent result: agent2");
    expect(result.stdout).toContain("Agent result: agent3");
    
    // Verify non-interleaving roughly by checking that "Agent result:" is followed by its own content
    // before another "Agent result:" appears.
    const parts = result.stdout.split("Agent result:");
    // parts[0] is everything before first result
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        // Each part should contain exactly one status and one set of logs
        expect(part).toContain("succeeded");
    }
  });

  it("existing agent artifacts remain persisted and untruncated", async () => {
    const runDir = path.join(TEMP_DIR, "artifact-test");
    await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      runDir,
      "-v"
    ]);

    // Find the run directory (it's a UUID)
    const entries = await fs.readdir(runDir);
    const uuidDir = entries.find(e => e.length === 36);
    expect(uuidDir).toBeDefined();
    const agentDir = path.join(runDir, uuidDir!, "agents/verbose-review");

    expect(await fs.stat(path.join(agentDir, "prompt.txt"))).toBeDefined();
    expect(await fs.stat(path.join(agentDir, "stdout.log"))).toBeDefined();
    expect(await fs.stat(path.join(agentDir, "stderr.log"))).toBeDefined();
    
    const stdoutContent = await fs.readFile(path.join(agentDir, "stdout.log"), "utf-8");
    expect(stdoutContent).toBe("mock stdout [REDACTED]");
  });

  it("pipeline ctx.agent() emits verbose logs with context", async () => {
    // Create a temporary pipeline workflow
    const pipelineWf = path.join(TEMP_DIR, "pipeline.workflow.js");
    await fs.writeFile(pipelineWf, `
      export const meta = { name: "pipeline-wf", description: "test pipeline" };
      export default async function workflow() {
        return await pipeline(["item1"], [
          {
            name: "stage1",
            run: async (item, ctx) => {
              return await ctx.agent({
                id: "pipeline-agent",
                provider: "mock",
                prompt: "Process " + item
              });
            }
          }
        ]);
      }
    `);

    const result = await runCli([
      "run",
      pipelineWf,
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "-v"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Agent command: pipeline-agent");
    expect(result.stdout).toContain("Prompt:");
    expect(result.stdout).toContain("  Process item1");
  });

  it("child workflow agents emit verbose logs", async () => {
    const childWf = path.join(TEMP_DIR, "child.workflow.js");
    const targetWf = path.join(TEMP_DIR, "verbose-agent-logging.workflow.js");
    
    // Copy the original workflow to the temp dir so it can be discovered
    const originalContent = await fs.readFile("tests/fixtures/workflows/verbose-agent-logging.workflow.js", "utf-8");
    await fs.writeFile(targetWf, originalContent);

    await fs.writeFile(childWf, `
      export const meta = { name: "child-wf", description: "test child" };
      export default async function workflow({ workflow }) {
        return await workflow({ name: "verbose-agent-logging" });
      }
    `);

    const configPath = path.join(TEMP_DIR, "discovery-config.json");
    await fs.writeFile(configPath, JSON.stringify({
      defaultProvider: "mock",
      workflow: {
        discovery: {
          include: ["*.workflow.js"]
        }
      },
      providers: {
        mock: {
          command: "mock",
          responses: {
            "verbose-review": {
              json: { summary: "done" }
            }
          }
        }
      }
    }));

    const result = await runCli([
      "run",
      childWf,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--cwd", TEMP_DIR,
      "-v"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Agent command: verbose-review");
  });

  it("JSONL verbose events are safe for consumers to ignore", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl",
      "-v"
    ]);

    const lines = result.stdout.trim().split("\n");
    const events = lines.map(l => JSON.parse(l));
    
    // Filter out verbose events
    const lifecycleEvents = events.filter(e => !e.type.startsWith("agent.verbose."));
    
    // Should still have start/complete events
    expect(lifecycleEvents.some(e => e.type === "workflow.started")).toBe(true);
    expect(lifecycleEvents.some(e => e.type === "workflow.completed")).toBe(true);
    expect(lifecycleEvents.some(e => e.type === "agent.started")).toBe(true);
    expect(lifecycleEvents.some(e => e.type === "agent.completed")).toBe(true);
  });

  it("dry-run verbose shows best-effort command preview (unavailable notice)", async () => {
    const result = await runCli([
      "run",
      "tests/fixtures/workflows/verbose-agent-logging.workflow.js",
      "--config",
      "tests/fixtures/config/mock.config.yaml",
      "--dry-run",
      "-v"
    ]);

    expect(result.stdout).toContain("Dry run: verbose-agent-logging");
    expect(result.stdout).toContain("Verbose logging: enabled");
    expect(result.stdout).toContain("Agent Command Previews:");
    expect(result.stdout).toContain("(Command previews are unavailable in dry-run mode)");
    expect(result.stdout).toContain("No providers were invoked.");
  });

  it("verbose command block shows injected schema for structured output", async () => {
    const configPath = path.join(TEMP_DIR, "structured.config.json");
    await fs.writeFile(configPath, JSON.stringify({
      defaultProvider: "mock",
      providers: {
        mock: {
          command: "mock",
          responses: {
            "structured-agent": {
              json: { foo: "bar" }
            }
          }
        }
      }
    }));

    const wfPath = path.join(TEMP_DIR, "structured.workflow.js");
    await fs.writeFile(wfPath, `
      export const meta = { name: "structured-wf", description: "test structured" };
      export default async function workflow(ctx) {
        return await ctx.agent({
          id: "structured-agent",
          prompt: "Extract something",
          schema: { type: "object", properties: { foo: { type: "string" } } },
          structuredOutput: { transport: "prompt" }
        });
      }
    `);

    const result = await runCli([
      "run",
      wfPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "-v"
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Agent command: structured-agent");
    expect(result.stdout).toContain("Extract something");
    expect(result.stdout).toContain("JSON Schema:");
    expect(result.stdout).toContain('"foo":');
  });
});
