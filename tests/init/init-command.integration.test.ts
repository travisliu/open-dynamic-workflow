import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initCommand } from "../../src/cli/commands/init.js";
import { PassThrough } from "node:stream";

describe("open-dynamic-workflow init integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-dynamic-workflow-init-test-"));
    // Ensure we work in the temp directory
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runInit(args: string[] = [], depsOverrides: any = {}) {
    const rawOptions: any = {
      cwd: tmpDir,
      yes: true,
    };
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--run-smoke-test") rawOptions.runSmokeTest = true;
      if (arg === "--report") rawOptions.report = args[++i];
      if (arg === "--force") rawOptions.force = true;
      if (arg === "--strict") rawOptions.strict = true;
      if (arg === "--provider") rawOptions.provider = args[++i];
      if (arg === "--workflows-dir") rawOptions.workflowsDir = args[++i];
      if (arg === "--agents-dir") rawOptions.agentsDir = args[++i];
      if (arg === "--tools-dir") rawOptions.toolsDir = args[++i];
    }

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stdoutData = "";
    let stderrData = "";
    stdout.on("data", (chunk) => stdoutData += chunk.toString());
    stderr.on("data", (chunk) => stderrData += chunk.toString());

    try {
      await initCommand({ 
        rawOptions,
        deps: {
          stdout,
          stderr,
          isTty: false,
          ...depsOverrides
        }
      });
    } catch (e) {
      // Re-attach data to error for inspection if needed, or just return it
      (e as any).stdoutData = stdoutData;
      (e as any).stderrData = stderrData;
      throw e;
    }

    return { stdoutData, stderrData };
  }

  it("creates default project structure", async () => {
    await runInit();

    expect(fs.existsSync(path.join(tmpDir, ".open-dynamic-workflow/config.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "workflows/example.workflow.ts"))).toBe(true);
  });

  it("succeeds with --run-smoke-test", async () => {
    const { stdoutData } = await runInit(["--run-smoke-test"]);
    expect(stdoutData).toContain("Smoke test result");
    expect(stdoutData).toContain("Validation: succeeded");
    expect(stdoutData).toContain("Mock run: succeeded");
  });

  it("writes parseable run JSON to stdout with --report json", async () => {
    const { stdoutData } = await runInit(["--run-smoke-test", "--report", "json"]);
    
    // The output might contain some empty lines or noise, but should contain the JSON
    const report = JSON.parse(stdoutData.trim());
    expect(report.schemaVersion).toBe("open-dynamic-workflow.report.v1");
    expect(report.status).toBe("succeeded");
  });

  it("does not modify existing package.json", async () => {
    const pkgPath = path.join(tmpDir, "package.json");
    const pkgContent = JSON.stringify({ name: "test", version: "1.0.0" }, null, 2);
    fs.writeFileSync(pkgPath, pkgContent);

    await runInit();

    const newContent = fs.readFileSync(pkgPath, "utf8");
    expect(newContent).toBe(pkgContent);
  });

  it("respects custom directory flags", async () => {
    await runInit([
      "--workflows-dir", "flows",
      "--agents-dir", "config/agents",
      "--tools-dir", "config/tools"
    ]);

    expect(fs.existsSync(path.join(tmpDir, "flows/example.workflow.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "config/agents"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "config/tools"))).toBe(true);

    const config = fs.readFileSync(path.join(tmpDir, ".open-dynamic-workflow/config.yaml"), "utf8");
    expect(config).toContain("- flows/**/*.workflow.ts");
    expect(config).toContain("- config/agents/**/*.ts");
    expect(config).toContain("- config/tools/**/*.ts");
  });

  it("fails in strict mode if files exist", async () => {
    fs.mkdirSync(path.join(tmpDir, "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "workflows/example.workflow.ts"), "existing");

    await expect(runInit(["--strict"])).rejects.toThrow(/already exist/);
  });

  it("overwrites files with --force", async () => {
    fs.mkdirSync(path.join(tmpDir, "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "workflows/example.workflow.ts"), "existing");

    await runInit(["--force"]);

    const content = fs.readFileSync(path.join(tmpDir, "workflows/example.workflow.ts"), "utf8");
    expect(content).not.toBe("existing");
  });

  it("fails before writing when .open-dynamic-workflow/agents is a file", async () => {
    fs.mkdirSync(path.join(tmpDir, ".open-dynamic-workflow"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".open-dynamic-workflow/agents"), "I am a file");

    await expect(runInit()).rejects.toThrow(/Cannot reuse "\.open-dynamic-workflow\/agents" as a directory because it is a file/);
    expect(fs.existsSync(path.join(tmpDir, ".open-dynamic-workflow/config.yaml"))).toBe(false);
  });

  it("fails before writing when workflows is a file and does not create config", async () => {
    fs.writeFileSync(path.join(tmpDir, "workflows"), "I am a file");

    await expect(runInit()).rejects.toThrow(/Cannot reuse "workflows" as a directory because it is a file/);
    expect(fs.existsSync(path.join(tmpDir, ".open-dynamic-workflow/config.yaml"))).toBe(false);
  });

  it("fails before writing when .open-dynamic-workflow is a file (unplanned parent)", async () => {
    fs.writeFileSync(path.join(tmpDir, ".open-dynamic-workflow"), "I am a file");

    await expect(runInit()).rejects.toThrow(/Cannot create "\.open-dynamic-workflow\/config\.yaml" because parent path "\.open-dynamic-workflow" is a file, not a directory/);
    expect(fs.readFileSync(path.join(tmpDir, ".open-dynamic-workflow"), "utf8")).toBe("I am a file");
    expect(fs.existsSync(path.join(tmpDir, "workflows"))).toBe(false);
  });

  it("fails for unsupported provider", async () => {
    await expect(runInit(["--provider", "definitely-not-supported"])).rejects.toThrow(/Unsupported provider/);
  });

  it("fails for --report json without --run-smoke-test", async () => {
    await expect(runInit(["--report", "json"])).rejects.toThrow(/--report requires --run-smoke-test/);
  });

  it("fails for empty directory path", async () => {
    await expect(runInit(["--workflows-dir", ""])).rejects.toThrow(/Option "workflows-dir" cannot be empty/);
  });

  it("fails for path outside cwd", async () => {
    await expect(runInit(["--workflows-dir", "../outside"])).rejects.toThrow(/must be inside the project directory/);
  });

  it("moves summary to stderr and keeps stdout clean for JSON report", async () => {
    const { stdoutData, stderrData } = await runInit(["--run-smoke-test", "--report", "json"]);
    
    // stdout should be exactly one parseable JSON object
    const trimmedStdout = stdoutData.trim();
    expect(trimmedStdout.startsWith("{")).toBe(true);
    expect(trimmedStdout.endsWith("}")).toBe(true);
    
    const report = JSON.parse(trimmedStdout);
    expect(report.schemaVersion).toBe("open-dynamic-workflow.report.v1");
    
    // stdout should NOT contain summary phrases
    expect(stdoutData).not.toContain("Open Dynamic Workflow project initialized");
    
    // summary should be on stderr
    expect(stderrData).toContain("Open Dynamic Workflow project initialized");
  });

  it("falls back to mock when requested provider is absent in non-interactive mode", async () => {
    // Inject provider detection showing codex absent
    const detectProviders = vi.fn().mockResolvedValue([
      { name: "mock", detected: true, builtIn: true },
      { name: "codex", detected: false, builtIn: false, command: "codex" }
    ]);
    
    const { stdoutData } = await runInit(["--provider", "codex"], { detectProviders });
    
    expect(stdoutData).toContain('requested provider "codex" was not found in PATH');
    const config = fs.readFileSync(path.join(tmpDir, ".open-dynamic-workflow/config.yaml"), "utf8");
    expect(config).toContain("defaultProvider: mock");
  });

  it("skips existing files and reports them in summary", async () => {
    fs.mkdirSync(path.join(tmpDir, ".open-dynamic-workflow"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".open-dynamic-workflow/config.yaml"), "sentinel config");
    fs.writeFileSync(path.join(tmpDir, "workflows/example.workflow.ts"), "sentinel workflow");

    const { stdoutData } = await runInit();

    expect(fs.readFileSync(path.join(tmpDir, ".open-dynamic-workflow/config.yaml"), "utf8")).toBe("sentinel config");
    expect(fs.readFileSync(path.join(tmpDir, "workflows/example.workflow.ts"), "utf8")).toBe("sentinel workflow");
    expect(stdoutData).toContain("Skipped existing files:");
    expect(stdoutData).toContain(".open-dynamic-workflow/config.yaml");
    expect(stdoutData).toContain("workflows/example.workflow.ts");
  });

  it("overwrites with --force and preserves unrelated files", async () => {
    fs.mkdirSync(path.join(tmpDir, "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "workflows/example.workflow.ts"), "sentinel workflow");
    fs.writeFileSync(path.join(tmpDir, "unrelated.txt"), "unrelated content");

    await runInit(["--force"]);

    expect(fs.readFileSync(path.join(tmpDir, "workflows/example.workflow.ts"), "utf8")).not.toBe("sentinel workflow");
    expect(fs.readFileSync(path.join(tmpDir, "unrelated.txt"), "utf8")).toBe("unrelated content");
  });

  it("lists all conflicts in strict mode", async () => {
    fs.mkdirSync(path.join(tmpDir, ".open-dynamic-workflow"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "workflows"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".open-dynamic-workflow/config.yaml"), "existing config");
    fs.writeFileSync(path.join(tmpDir, "workflows/example.workflow.ts"), "existing workflow");

    // Capture output by catching the error
    let error: any;
    try {
      await runInit(["--strict"]);
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.message).toContain("already exist in strict mode");
    expect(error.stdoutData).toContain(".open-dynamic-workflow/config.yaml");
    expect(error.stdoutData).toContain("workflows/example.workflow.ts");
    
    // Check if missing targets were NOT created
    expect(fs.existsSync(path.join(tmpDir, ".open-dynamic-workflow/agents"))).toBe(false);
  });
});
