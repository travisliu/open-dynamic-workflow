import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { exitCodeForError } from "../../src/errors/exit-codes.js";

const TEMP_DIR = path.resolve("tests/temp-provider-adapters-integration");

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
    await main(["node", "open-dynamic-workflow", ...args]);
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

describe("Provider adapter execution", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("67. unknown provider behavior remains unchanged", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json",
      "--arg",
      "subcase=03.04" // Requests 'unknown-provider'
    ]);

    // Assert
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(4);
    expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");

    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const manifest = JSON.parse(await fs.readFile(path.join(runDir, "manifest.json"), "utf8"));
    expect(manifest.status).toBe("failed");
    expect(manifest.error.code).toBe("PROVIDER_UNAVAILABLE");

    const agentsDir = path.join(runDir, "agents");
    const agentsDirExists = await fs.access(agentsDir).then(() => true).catch(() => false);
    if (agentsDirExists) {
        const agentFolders = await fs.readdir(agentsDir);
        expect(agentFolders.length).toBe(0);
    }
  });

  it("68. new providers remain behind scheduler/process-runner boundaries", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    const providers = [
      { id: "opencode-test", provider: "opencode", subcase: "03.05" },
      { id: "antigravity-test", provider: "antigravity", subcase: "03.06" },
      { id: "pi-test", provider: "pi", subcase: "03.07" },
      { id: "copilot-test", provider: "copilot", subcase: "03.11" }
    ];

    for (const p of providers) {
      // Act
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(TEMP_DIR, { recursive: true });

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
        `subcase=${p.subcase}`
      ]);

      // Assert
      expect(result.error).toBeNull();

      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!); // Only one run now
      const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
      
      const agent = report.agents.find((a: any) => a.id === p.id);
      expect(agent).toBeDefined();
      expect(agent.ok).toBe(true);
      expect(agent.provider).toBe(p.provider);
      
      if (p.provider === "copilot") {
        expect(agent.text).toBe("Fake Copilot provider response");
      }
      
      const agentDir = path.join(runDir, `agents/${agent.id}`);
      expect(await fs.access(path.join(agentDir, "stdout.log")).then(() => true)).toBe(true);
      expect(await fs.access(path.join(agentDir, "stderr.log")).then(() => true)).toBe(true);
      
      const stderr = JSON.parse(await fs.readFile(path.join(agentDir, "stderr.log"), "utf8"));
      expect(stderr.argv).toBeDefined();
    }
  });

  it("70. Copilot structured output validates through existing local schema path", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--arg", "subcase=03.13"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    const agent = report.agents.find((a: any) => a.id === "copilot-json");
    expect(agent.ok).toBe(true);
    expect(agent.json).toEqual({ ok: true, files: ["src/agents/github-copilot-cli.ts"] });
  });

  it("71. Invalid Copilot structured output produces failed agent result", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    // Act (invalid JSON)
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--arg", "subcase=03.14"
    ]);

    // Assert 1
    const runs1 = await fs.readdir(TEMP_DIR);
    const runDir1 = path.join(TEMP_DIR, runs1[0]!);
    const report1 = JSON.parse(await fs.readFile(path.join(runDir1, "report.json"), "utf8"));
    const agent1 = report1.agents.find((a: any) => a.id === "copilot-invalid-json");
    expect(agent1.ok).toBe(false);
    expect(agent1.error.code).toBe("SCHEMA_VALIDATION_FAILED");

    // Act (schema-invalid JSON)
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const result2 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--arg", "subcase=03.15"
    ]);

    // Assert 2
    const runs2 = await fs.readdir(TEMP_DIR);
    const runDir2 = path.join(TEMP_DIR, runs2[0]!);
    const report2 = JSON.parse(await fs.readFile(path.join(runDir2, "report.json"), "utf8"));
    const agent2 = report2.agents.find((a: any) => a.id === "copilot-schema-invalid");
    expect(agent2.ok).toBe(false);
    expect(agent2.error.code).toBe("SCHEMA_VALIDATION_FAILED");
  });

  it("72. Secrets are not passed to Copilot command environment", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    // Act
    process.env.GITHUB_TOKEN = "secret-token";
    process.env.MY_APP_SECRET = "secret-value";
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--arg", "subcase=03.11"
    ]);
    delete process.env.GITHUB_TOKEN;
    delete process.env.MY_APP_SECRET;

    // Assert
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const agentDir = path.join(runDir, "agents/copilot-test");
    const stderr = JSON.parse(await fs.readFile(path.join(agentDir, "stderr.log"), "utf8"));
    
    expect(stderr.env.GITHUB_TOKEN).toBeUndefined();
    expect(stderr.env.GH_TOKEN).toBeUndefined();
    expect(stderr.env.MY_APP_SECRET).toBeUndefined();
  });

  it("69. dangerous permission artifacts remain explicit for new providers", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    const agents = [
      { id: "opencode-full-access", subcase: "03.08", expectedArgv: ["--dangerously-skip-permissions"] },
      { id: "antigravity-full-access", subcase: "03.09", expectedArgv: ["--dangerously-skip-permissions"] },
      {
        id: "pi-full-access",
        subcase: "03.10",
        expectedArgv: ["--tools", "read,bash,edit,write,grep,find,ls"],
        forbiddenArgv: ["--approve"]
      },
      { id: "copilot-full-access", subcase: "03.12", expectedArgv: ["--yolo"] }
    ];

    for (const a of agents) {
      // Act
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(TEMP_DIR, { recursive: true });

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
        `subcase=${a.subcase}`
      ]);

      // Assert
      expect(result.error).toBeNull();

      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      
      const agentDir = path.join(runDir, `agents/${a.id}`);
      
      const permissions = JSON.parse(await fs.readFile(path.join(agentDir, "permissions.json"), "utf8"));
      expect(permissions.mode).toBe("dangerously-full-access");
      
      const metadata = JSON.parse(await fs.readFile(path.join(agentDir, "metadata.json"), "utf8"));
      expect(metadata.permissions.mode).toBe("dangerously-full-access");
      
      const stderrLog = await fs.readFile(path.join(agentDir, "stderr.log"), "utf8");
      const stderr = JSON.parse(stderrLog);

      for (const arg of a.expectedArgv) {
        expect(stderr.argv).toContain(arg);
      }

      if (a.forbiddenArgv) {
        for (const arg of a.forbiddenArgv) {
          expect(stderr.argv).not.toContain(arg);
        }
      }
    }
  });

  it("73. executes thinkingEffort mapped commands for Codex, Pi, and OpenCode", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    // 1. Codex thinking effort (high -> -c model_reasoning_effort="high")
    {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(TEMP_DIR, { recursive: true });
      const result = await runCli(["run", workflowPath, "--config", configPath, "--out", TEMP_DIR, "--report", "json", "--arg", "subcase=03.16"]);
      expect(result.error).toBeNull();
      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
      const agent = report.agents.find((a: any) => a.id === "codex-thinking");
      expect(agent.ok).toBe(true);

      const agentDir = path.join(runDir, `agents/codex-thinking`);
      const stderr = JSON.parse(await fs.readFile(path.join(agentDir, "stderr.log"), "utf8"));
      expect(stderr.argv).toContain("-c");
      expect(stderr.argv).toContain('model_reasoning_effort="high"');
    }

    // 2. Pi thinking effort (medium -> --thinking medium)
    {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(TEMP_DIR, { recursive: true });
      const result = await runCli(["run", workflowPath, "--config", configPath, "--out", TEMP_DIR, "--report", "json", "--arg", "subcase=03.17"]);
      expect(result.error).toBeNull();
      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
      const agent = report.agents.find((a: any) => a.id === "pi-thinking");
      expect(agent.ok).toBe(true);

      const agentDir = path.join(runDir, `agents/pi-thinking`);
      const stderr = JSON.parse(await fs.readFile(path.join(agentDir, "stderr.log"), "utf8"));
      expect(stderr.argv).toContain("--thinking");
      expect(stderr.argv[stderr.argv.indexOf("--thinking") + 1]).toBe("medium");
    }

    // 3. OpenCode thinking effort (low -> --variant low)
    {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(TEMP_DIR, { recursive: true });
      const result = await runCli(["run", workflowPath, "--config", configPath, "--out", TEMP_DIR, "--report", "json", "--arg", "subcase=03.18"]);
      expect(result.error).toBeNull();
      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
      const agent = report.agents.find((a: any) => a.id === "opencode-thinking");
      expect(agent.ok).toBe(true);

      const agentDir = path.join(runDir, `agents/opencode-thinking`);
      const stderr = JSON.parse(await fs.readFile(path.join(agentDir, "stderr.log"), "utf8"));
      expect(stderr.argv).toContain("--variant");
      expect(stderr.argv[stderr.argv.indexOf("--variant") + 1]).toBe("low");
    }

    // 4. OpenCode thinking effort off (off -> --variant none)
    {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(TEMP_DIR, { recursive: true });
      const result = await runCli(["run", workflowPath, "--config", configPath, "--out", TEMP_DIR, "--report", "json", "--arg", "subcase=03.19"]);
      expect(result.error).toBeNull();
      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
      const agent = report.agents.find((a: any) => a.id === "opencode-thinking-off");
      expect(agent.ok).toBe(true);

      const agentDir = path.join(runDir, `agents/opencode-thinking-off`);
      const stderr = JSON.parse(await fs.readFile(path.join(agentDir, "stderr.log"), "utf8"));
      expect(stderr.argv).toContain("--variant");
      expect(stderr.argv[stderr.argv.indexOf("--variant") + 1]).toBe("none");
    }
  });

  it("74. fails fast for unsupported provider thinkingEffort and unsupported value", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    // 1. Gemini thinking effort unsupported
    {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(TEMP_DIR, { recursive: true });
      const result = await runCli(["run", workflowPath, "--config", configPath, "--out", TEMP_DIR, "--report", "json", "--arg", "subcase=03.20"]);
      expect(result.error).toBeNull();

      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
      const agent = report.agents.find((a: any) => a.id === "gemini-thinking-unsupported");
      expect(agent.ok).toBe(false);
      expect(agent.error.code).toBe("THINKING_EFFORT_NOT_SUPPORTED");
    }

    // 2. Codex thinking effort off unsupported
    {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(TEMP_DIR, { recursive: true });
      const result = await runCli(["run", workflowPath, "--config", configPath, "--out", TEMP_DIR, "--report", "json", "--arg", "subcase=03.21"]);
      expect(result.error).toBeNull();

      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
      const agent = report.agents.find((a: any) => a.id === "codex-thinking-unsupported");
      expect(agent.ok).toBe(false);
      expect(agent.error.code).toBe("THINKING_EFFORT_VALUE_UNSUPPORTED");
    }
  });

  it("75. fails fast on OpenCode thinkingEffort and opencodeVariant conflict", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/provider-adapters.workflow.js");
    const configPath = path.resolve("tests/fixtures/config/provider-adapters.config.yaml");

    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const result = await runCli(["run", workflowPath, "--config", configPath, "--out", TEMP_DIR, "--report", "json", "--arg", "subcase=03.22"]);
    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    const agent = report.agents.find((a: any) => a.id === "opencode-thinking-conflict");
    expect(agent.ok).toBe(false);
    expect(agent.error.code).toBe("THINKING_EFFORT_CONFLICT");
  });
});
