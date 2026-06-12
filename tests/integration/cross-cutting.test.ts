import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-tc-x");

async function runCli(args: string[], env: Record<string, string> = {}) {
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

  // Temporarily set env
  const originalEnv = { ...process.env };
  Object.assign(process.env, env);

  let error: any = null;
  try {
    await main(["node", "openflow", ...args]);
  } catch (err) {
    error = err;
  } finally {
    process.env = originalEnv;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Cross-Cutting Requirements", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Secrets are redacted from output and artifacts", async () => {
    const workflowPath = path.join(TEMP_DIR, "tc-x.01.workflow.js");
    await fs.writeFile(workflowPath, `
      export const meta = { name: "secret-redaction", description: "Secret test" };
      await agent({ id: "secret-agent", provider: "mock", prompt: "tell me your secrets" });
    `, "utf8");

    const configPath = path.join(TEMP_DIR, "tc-x.01.config.yaml");
    await fs.writeFile(configPath, `
      defaultProvider: mock
      providers:
        mock:
          responses:
            secret-agent:
              text: "My secret is MY_SUPER_SECRET_VALUE and another one is OTHER_SECRET."
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl"
    ], {
      OPENAI_API_KEY: "MY_SUPER_SECRET_VALUE",
      MY_CUSTOM_SECRET: "OTHER_SECRET"
    });

    expect(result.error).toBeNull();
    
    // Assert stdout is redacted
    expect(result.stdout).not.toContain("MY_SUPER_SECRET_VALUE");
    expect(result.stdout).not.toContain("OTHER_SECRET");
    expect(result.stdout).toContain("[REDACTED]");

    // Assert artifacts are redacted
    const runs = (await fs.readdir(TEMP_DIR)).filter(d => d !== "tc-x.01.workflow.js" && d !== "tc-x.01.config.yaml");
    const runDir = path.join(TEMP_DIR, runs[0]!);
    
    const reportStr = await fs.readFile(path.join(runDir, "report.json"), "utf8");
    expect(reportStr).not.toContain("MY_SUPER_SECRET_VALUE");
    expect(reportStr).not.toContain("OTHER_SECRET");
    expect(reportStr).toContain("[REDACTED]");

    const agentStdout = await fs.readFile(path.join(runDir, "agents/secret-agent/stdout.log"), "utf8");
    expect(agentStdout).not.toContain("MY_SUPER_SECRET_VALUE");
    expect(agentStdout).not.toContain("OTHER_SECRET");
    expect(agentStdout).toContain("[REDACTED]");
  });

  it("Config precedence is respected", async () => {
    const workflowPath = path.join(TEMP_DIR, "tc-x.02.workflow.js");
    await fs.writeFile(workflowPath, `
      export const meta = { name: "config-precedence", description: "Config precedence" };
      await agent({ id: "delay-agent", provider: "mock", prompt: "delay" });
    `, "utf8");

    const configPath = path.join(TEMP_DIR, "tc-x.02.config.yaml");
    await fs.writeFile(configPath, `
      defaultProvider: mock
      timeoutMs: 5000
      providers:
        mock:
          responses:
            delay-agent:
              delayMs: 300
              text: "Too late"
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--timeout-ms", "100", // This should override the 5000 in config and cause timeout before 300ms delay finishes
      "--fail-fast"
    ]);

    expect(result.error).toBeDefined();
    
    // We expect the workflow to fail due to timeout
    const runs = (await fs.readdir(TEMP_DIR)).filter(d => !d.includes("."));
    expect(runs.length).toBe(1);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    
    const reportStr = await fs.readFile(path.join(runDir, "report.json"), "utf8");
    const report = JSON.parse(reportStr);
    
    expect(report.status).toBe("failed");
    const agent = report.agents.find((a: any) => a.id === "delay-agent");
    expect(agent.status).toBe("timed_out");
  });
});
