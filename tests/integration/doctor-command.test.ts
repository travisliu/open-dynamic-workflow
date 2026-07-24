import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-doctor-integration");

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

describe("open-dynamic-workflow doctor", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("64. Doctor succeeds when optional built-in provider CLIs are missing and default provider is mock", async () => {
    // Arrange
    const configPath = path.join(TEMP_DIR, "case-64.config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  codex: { command: /bogus/codex }
  gemini: { command: /bogus/gemini }
  opencode: { command: /bogus/opencode }
  antigravity: { command: /bogus/agy }
  pi: { command: /bogus/pi }
  copilot: { command: /bogus/copilot }
`);

    // Act
    const result = await runCli(["doctor", "--config", configPath]);

    // Assert
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("available"); // mock
    expect(result.stdout).toContain("✕ opencode");
    expect(result.stdout).toContain("✕ antigravity");
    expect(result.stdout).toContain("✕ pi");
    expect(result.stdout).toContain("✕ copilot");
  });

  it("65. Doctor fails when configured default provider is unavailable", async () => {
    // Arrange
    const providers = ["codex", "gemini", "opencode", "antigravity", "pi", "copilot"];

    for (const provider of providers) {
      const configPath = path.join(TEMP_DIR, `case-65-${provider}.config.yaml`);
      await fs.writeFile(configPath, `
defaultProvider: ${provider}
providers:
  codex: { command: /bogus/codex }
  gemini: { command: /bogus/gemini }
  opencode: { command: /bogus/opencode }
  antigravity: { command: /bogus/agy }
  pi: { command: /bogus/pi }
  copilot: { command: /bogus/copilot }
`);

      // Act
      const result = await runCli(["doctor", "--config", configPath]);

      // Assert
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.stdout).toContain(`✕ ${provider}`);
    }
  }, 15000);

  it("66. Doctor still succeeds when all required providers are available", async () => {
    // Arrange
    const configPath = path.join(TEMP_DIR, "case-66.config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  opencode: { command: "true" }
  antigravity: { command: "true" }
  pi: { command: "true" }
  codex: { command: /bogus/codex }
  gemini: { command: /bogus/gemini }
  copilot: { command: /bogus/copilot }
`);

    // Act
    const result = await runCli(["doctor", "--config", configPath]);

    // Assert
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("mock");
  });

  it("Concise doctor discovery summary (non-verbose)", async () => {
    // Arrange
    const projectDir = path.join(TEMP_DIR, "concise-proj");
    await fs.mkdir(projectDir, { recursive: true });
    
    const configPath = path.join(projectDir, "config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
workflow:
  include:
    - "workflows/**/*.ts"
sharedAgents:
  include:
    - "agents/**/*.ts"
tools:
  include:
    - "tools/**/*.ts"
`);

    await fs.mkdir(path.join(projectDir, "workflows"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "agents"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "tools"), { recursive: true });

    await fs.writeFile(path.join(projectDir, "workflows/test.workflow.ts"), "export default {}");
    await fs.writeFile(path.join(projectDir, "agents/test.agent.ts"), "export default {}");
    await fs.writeFile(path.join(projectDir, "tools/test.tool.ts"), "export default {}");

    // Act
    const result = await runCli(["doctor", "--config", configPath, "--cwd", projectDir]);

    // Assert
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Discovery: workflows 1, shared agents 1, tools 1");
  });

  it("Verbose doctor metrics and diagnostics", async () => {
    // Arrange
    const projectDir = path.join(TEMP_DIR, "verbose-proj");
    await fs.mkdir(projectDir, { recursive: true });
    
    const configPath = path.join(projectDir, "config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
workflow:
  include:
    - "workflows/**/*.ts"
    - "workflows/**/*.js"
sharedAgents:
  include:
    - "agents/**/*.ts"
tools:
  include:
    - "tools/**/*.ts"
`);

    await fs.mkdir(path.join(projectDir, "workflows"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "agents"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "tools"), { recursive: true });

    await fs.writeFile(path.join(projectDir, "workflows/test.workflow.ts"), "export default {}");
    await fs.writeFile(path.join(projectDir, "agents/test.agent.ts"), "export default {}");
    await fs.writeFile(path.join(projectDir, "tools/test.tool.ts"), "export default {}");

    // Act
    const result = await runCli(["doctor", "--config", configPath, "--cwd", projectDir, "--verbose"]);

    // Assert
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Discovery: workflows 1, shared agents 1, tools 1");
    expect(result.stdout).toContain("Discovery Metrics:");
    expect(result.stdout).toContain("Workflows:");
    expect(result.stdout).toContain("Shared Agents:");
    expect(result.stdout).toContain("Tools:");
    expect(result.stdout).toContain("Pattern: workflows/**/*.ts");
    expect(result.stdout).toContain("Pattern: workflows/**/*.js");
    expect(result.stdout).not.toContain("CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
  });

  it("checks and creates a missing relative configured runs root without leaving a probe", async () => {
    const projectDir = path.join(TEMP_DIR, "relative-root");
    const configPath = path.join(projectDir, "config.yaml");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(configPath, "defaultProvider: mock\noutDir: artifacts/runs\n");

    const result = await runCli(["doctor", "--config", configPath, "--cwd", projectDir]);
    const root = path.join(projectDir, "artifacts/runs");

    expect(result.error).toBeNull();
    expect(result.stdout).toContain(`Artifact runs root available: ${root}`);
    expect(await fs.readdir(root)).not.toContain(expect.stringMatching(/^\.odw-write-probe-/));
  });

  it("checks an absolute configured root without creating the legacy root", async () => {
    const projectDir = path.join(TEMP_DIR, "absolute-root-project");
    const root = path.join(TEMP_DIR, "absolute-root-outside");
    const configPath = path.join(projectDir, "config.yaml");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(configPath, `defaultProvider: mock\noutDir: ${root}\n`);

    const result = await runCli(["doctor", "--config", configPath, "--cwd", projectDir]);

    expect(result.error).toBeNull();
    expect(await fs.stat(root)).toMatchObject({});
    await expect(fs.stat(path.join(projectDir, ".open-dynamic-workflow/runs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports inherited profile root provenance", async () => {
    const projectDir = path.join(TEMP_DIR, "profile-root");
    const configPath = path.join(projectDir, "config.yaml");
    const root = path.join(projectDir, "inherited-runs");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(configPath, `
defaultProvider: mock
profiles:
  base:
    outDir: inherited-runs
  child:
    extends: base
`);

    const result = await runCli(["doctor", "--config", configPath, "--cwd", projectDir, "--profile", "child", "--verbose"]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain(`Artifact runs root available: ${root}`);
    expect(result.stdout).toContain("Output-root source: profile");
    expect(result.stdout).toContain("Selected profile: child");
  });

  it("reports a configured root file conflict without modifying it or creating the legacy root", async () => {
    const projectDir = path.join(TEMP_DIR, "root-file-conflict");
    const configPath = path.join(projectDir, "config.yaml");
    const rootFile = path.join(projectDir, "runs-file");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(rootFile, "keep me");
    await fs.writeFile(configPath, "defaultProvider: mock\noutDir: runs-file\n");

    const result = await runCli(["doctor", "--config", configPath, "--cwd", projectDir]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain(`Artifact runs root unavailable: ${rootFile}`);
    expect(result.stdout).toContain("directory is required");
    expect(await fs.readFile(rootFile, "utf8")).toBe("keep me");
    await expect(fs.stat(path.join(projectDir, ".open-dynamic-workflow/runs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not create a candidate root for a missing profile or invalid config", async () => {
    const projectDir = path.join(TEMP_DIR, "no-root-on-failure");
    const configPath = path.join(projectDir, "config.yaml");
    const candidate = path.join(projectDir, "candidate-runs");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(configPath, "defaultProvider: mock\noutDir: candidate-runs\n");

    const missingProfile = await runCli(["doctor", "--config", configPath, "--cwd", projectDir, "--profile", "missing"]);
    expect(missingProfile.error).toBeDefined();
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: "ENOENT" });

    await fs.writeFile(configPath, "defaultProvider: mock\noutDir: '   '\n");
    const invalidConfig = await runCli(["doctor", "--config", configPath, "--cwd", projectDir]);
    expect(invalidConfig.error).toBeDefined();
    await expect(fs.stat(candidate)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
