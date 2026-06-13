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
      { id: "pi-test", provider: "pi", subcase: "03.07" }
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
      
      const agentDir = path.join(runDir, `agents/${agent.id}`);
      expect(await fs.access(path.join(agentDir, "stdout.log")).then(() => true)).toBe(true);
      expect(await fs.access(path.join(agentDir, "stderr.log")).then(() => true)).toBe(true);
      
      const stderr = JSON.parse(await fs.readFile(path.join(agentDir, "stderr.log"), "utf8"));
      expect(stderr.argv).toBeDefined();
    }
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
      }
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
});
