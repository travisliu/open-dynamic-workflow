import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { renderCliError } from "../../src/cli/error-output.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-profile-run-precedence-int");

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

  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  let error: any = null;

  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    error = err;
    if (stderrData.length === 0) {
      renderCliError(err, { argv: ["node", "open-dynamic-workflow", ...args] });
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Integration - Profile Run Precedence", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });

    // Create default discovery directories to satisfy policy validation
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/agents"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/tools"), { recursive: true });

    // Write a dummy workflow file
    const wfContent = `
export const meta = {
  name: "test-run-workflow",
  description: "workflow to test profile precedence"
};
phase("run");
log("Running workflow");
const res = await agent({ prompt: "hello" });
export default { res };
`;
    await fs.writeFile(path.join(TEMP_DIR, "workflows/test.workflow.js"), wfContent);

    // Write config.yaml
    const configContent = `
defaultProvider: mock
concurrency: 2
timeoutMs: 30000

providers:
  mock:
    command: mock
    responses:
      default:
        text: "mock response"

profiles:
  base:
    args: { goal: default, iterations: 3 }
    context: { mode: normal, quality: { level: standard } }
    run: { provider: mock, concurrency: 1, retry: { maxAttempts: 2 } }
  fast:
    extends: base
    args: { iterations: 1 }
    context: { mode: fast }
    run: { concurrency: 4, retry: false }
`;
    await fs.writeFile(path.join(TEMP_DIR, "config.yaml"), configContent);

    // Write external profiles file
    const profilesContent = `
version: "1"
profiles:
  ci:
    args: { goal: ci }
    context: { mode: ci, quality: { level: strict } }
    run: { provider: mock, report: json }
  fast:
    args: { iterations: 2 }
    run: { provider: mock }
`;
    await fs.writeFile(path.join(TEMP_DIR, ".profiles.yml"), profilesContent);
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("covers inline profile selection and run-input.json shape", async () => {
    const res = await runCli([
      "run",
      "workflows/test.workflow.js",
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--out",
      TEMP_DIR,
      "--profile",
      "fast",
      "--report",
      "json"
    ]);

    expect(res.error).toBeNull();

    // Verify run output directory
    const runs = await fs.readdir(TEMP_DIR);
    // Find the subdirectory that looks like a UUID
    const runDirName = runs.find(r => r.length === 36);
    expect(runDirName).toBeDefined();
    const runDir = path.join(TEMP_DIR, runDirName!);

    // Verify run-input.json.profile does NOT exist
    const profileJsonPath = path.join(runDir, "run-input.json.profile");
    await expect(fs.access(profileJsonPath)).rejects.toThrow();

    // Verify run-input.json has embedded profile and args
    const runInputPath = path.join(runDir, "run-input.json");
    const runInputData = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    expect(runInputData.args.iterations).toBe(1);
    expect(runInputData.args.goal).toBe("default");

    // Recorded profile must have compact identity fields plus resolved body and inheritance chain
    expect(runInputData.profile).toBeDefined();
    expect(runInputData.profile.selected).toBe("fast");
    expect(runInputData.profile.source).toBe("config");
    expect(runInputData.profile.profilesPath).toBeUndefined();
    expect(runInputData.profile.hash).toBeTypeOf("string");
    expect(runInputData.profile.resolved).toBeDefined();
    expect(runInputData.profile.resolved.args.iterations).toBe(1);
    expect(runInputData.profile.inheritanceChain).toEqual(["base", "fast"]);

    // report.json.profile remains compact (no resolved args/context)
    const reportPath = path.join(runDir, "report.json");
    const reportData = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(reportData.profile).toBeDefined();
    expect(reportData.profile.selected).toBe("fast");
    expect(reportData.profile.source).toBe("config");
    expect(reportData.profile.hash).toBeTypeOf("string");
    expect(reportData.profile.resolved).toBeUndefined();
    expect(reportData.profile.inheritanceChain).toBeUndefined();
  });

  it("covers external profile selection and run-input.json shape", async () => {
    const res = await runCli([
      "run",
      "workflows/test.workflow.js",
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--out",
      TEMP_DIR,
      "--profiles",
      ".profiles.yml",
      "--profile",
      "ci",
      "--report",
      "json"
    ]);

    expect(res.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runDirName = runs.find(r => r.length === 36);
    expect(runDirName).toBeDefined();
    const runDir = path.join(TEMP_DIR, runDirName!);

    // Verify run-input.json.profile does NOT exist
    const profileJsonPath = path.join(runDir, "run-input.json.profile");
    await expect(fs.access(profileJsonPath)).rejects.toThrow();

    // Verify run-input.json contains embedded profile and args
    const runInputPath = path.join(runDir, "run-input.json");
    const runInputData = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    expect(runInputData.args.goal).toBe("ci");

    expect(runInputData.profile).toBeDefined();
    expect(runInputData.profile.selected).toBe("ci");
    expect(runInputData.profile.source).toBe("external");
    expect(runInputData.profile.profilesPath).toContain(".profiles.yml");
    expect(runInputData.profile.hash).toBeTypeOf("string");
    expect(runInputData.profile.resolved).toBeDefined();
    expect(runInputData.profile.inheritanceChain).toBeDefined();
  });

  it("covers external catalog overrides an inline profile name", async () => {
    // Select "fast" with --profiles .profiles.yml. The external "fast" should override config "fast".
    // Config "fast" has iterations: 1, external "fast" has iterations: 2.
    const res = await runCli([
      "run",
      "workflows/test.workflow.js",
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--out",
      TEMP_DIR,
      "--profiles",
      ".profiles.yml",
      "--profile",
      "fast",
      "--report",
      "json"
    ]);

    expect(res.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runDirName = runs.find(r => r.length === 36);
    expect(runDirName).toBeDefined();
    const runDir = path.join(TEMP_DIR, runDirName!);

    const runInputPath = path.join(runDir, "run-input.json");
    const runInputData = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    // Since external fast overrides config fast, iterations should be 2.
    expect(runInputData.args.iterations).toBe(2);
  });

  it("ensures CLI provider and arg override win over profile values", async () => {
    // Select profile fast (iterations: 1, concurrency: 4) but override iterations via CLI arg
    // and concurrency/provider via CLI flags.
    const res = await runCli([
      "run",
      "workflows/test.workflow.js",
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--out",
      TEMP_DIR,
      "--profile",
      "fast",
      "--arg",
      "iterations=5",
      "--arg",
      "goal=cli-goal",
      "--concurrency",
      "9",
      "--report",
      "json"
    ]);

    expect(res.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runDirName = runs.find(r => r.length === 36);
    expect(runDirName).toBeDefined();
    const runDir = path.join(TEMP_DIR, runDirName!);

    const runInputPath = path.join(runDir, "run-input.json");
    const runInputData = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    expect(runInputData.args.iterations).toBe(5);
    expect(runInputData.args.goal).toBe("cli-goal");

    const reportPath = path.join(runDir, "report.json");
    const reportData = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(reportData.concurrency).toBe(9);
  });

  it("failed selection aborts before provider execution", async () => {
    // Using a non-existent profile should throw and prevent execution
    const res = await runCli([
      "run",
      "workflows/test.workflow.js",
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--out",
      TEMP_DIR,
      "--profile",
      "non-existent-profile",
      "--report",
      "json"
    ]);

    expect(res.error).toBeDefined();
    expect(res.error.code).toBe("PROFILE_NOT_FOUND");

    // No run directory (UUID subdirectory) should exist in TEMP_DIR since it aborts early
    const runs = await fs.readdir(TEMP_DIR);
    const uuidDirs = runs.filter(r => r.length === 36);
    expect(uuidDirs.length).toBe(0);
  });

  it("covers no-profile run shape (run-input.json.profile does not exist)", async () => {
    const res = await runCli([
      "run",
      "workflows/test.workflow.js",
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    expect(res.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runDirName = runs.find(r => r.length === 36);
    expect(runDirName).toBeDefined();
    const runDir = path.join(TEMP_DIR, runDirName!);

    const profileJsonPath = path.join(runDir, "run-input.json.profile");
    // Should NOT exist
    await expect(fs.access(profileJsonPath)).rejects.toThrow();

    // Verify run-input.json does NOT contain a profile property
    const runInputPath = path.join(runDir, "run-input.json");
    const runInputData = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    expect(runInputData.profile).toBeUndefined();
  });
});
