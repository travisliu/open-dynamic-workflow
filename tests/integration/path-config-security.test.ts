import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { runCli as odwRunCli } from "../../src/cli/index.js";
import { ExitCode } from "../../src/errors/exit-codes.js";

describe("CLI Path Config Security Integration", () => {
  let tempDir: string;
  let outsideDir: string;
  let symlinksSupported = true;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-cli-sec-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-cli-sec-outside-"));

    try {
      const testLink = path.join(tempDir, "test-symlink-support");
      await fs.symlink("target", testLink);
      await fs.unlink(testLink);
    } catch {
      symlinksSupported = false;
    }
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function runCli(args: string[]) {
    const localStdout: string[] = [];
    const localStderr: string[] = [];

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      localStdout.push(chunk.toString());
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      localStderr.push(chunk.toString());
      return true;
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      const msg = args.join(" ") + "\n";
      localStdout.push(msg);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      const msg = args.join(" ") + "\n";
      localStderr.push(msg);
    });

    let error: any = null;
    const originalExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      await odwRunCli([...args, "--cwd", tempDir]);
    } catch (err: any) {
      error = err;
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    const code = process.exitCode;
    process.exitCode = originalExitCode;

    return {
      stdout: localStdout.join(""),
      stderr: localStderr.join(""),
      error,
      exitCode: code,
    };
  }

  // --- Helper to write a valid workflow file ---
  async function writeWorkflow(filePath: string, name: string, description = "desc", sideEffectPath?: string) {
    const parent = path.dirname(filePath);
    await fs.mkdir(parent, { recursive: true });
    
    let sideEffectCode = "";
    if (sideEffectPath) {
      sideEffectCode = `
        import * as fs from "node:fs";
        fs.writeFileSync(${JSON.stringify(sideEffectPath)}, "executed");
      `;
    }

    await fs.writeFile(
      filePath,
      `export const meta = {
        name: ${JSON.stringify(name)},
        description: ${JSON.stringify(description)},
        phases: ["planning", "implementation"],
        version: "1.0.0"
      };
      ${sideEffectCode}
      export default async function workflow() {}`
    );
  }

  // --- Helper to write a valid agent file ---
  async function writeAgent(filePath: string, id: string, sideEffectPath?: string) {
    const parent = path.dirname(filePath);
    await fs.mkdir(parent, { recursive: true });

    let sideEffectCode = "";
    if (sideEffectPath) {
      sideEffectCode = `
        import * as fs from "node:fs";
        fs.writeFileSync(${JSON.stringify(sideEffectPath)}, "executed");
      `;
    }

    await fs.writeFile(
      filePath,
      `
      import { defineAgent } from "@travisliu/open-dynamic-workflow";
      ${sideEffectCode}
      export default defineAgent({
        id: ${JSON.stringify(id)},
        description: "agent desc",
        run: async () => {}
      });
      `
    );
  }

  // --- Helper to write a valid tool file ---
  async function writeTool(filePath: string, id: string, sideEffectPath?: string) {
    const parent = path.dirname(filePath);
    await fs.mkdir(parent, { recursive: true });

    let sideEffectCode = "";
    if (sideEffectPath) {
      sideEffectCode = `
        import * as fs from "node:fs";
        fs.writeFileSync(${JSON.stringify(sideEffectPath)}, "executed");
      `;
    }

    await fs.writeFile(
      filePath,
      `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      ${sideEffectCode}
      export default defineTool({
        id: ${JSON.stringify(id)},
        description: "tool desc",
        inputSchema: { type: "object" },
        run: async () => {}
      });
      `
    );
  }

  it("1. Non-strict list reports but does not load workflow symlink escapes", async () => {
    if (!symlinksSupported) {
      console.warn("Skipping symlink integration test");
      return;
    }

    // Config
    const configContent = `
workflow:
  include:
    - "workflows/**/*.workflow.ts"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Create a target workflow file outside the workspace
    const outsideWf = path.join(outsideDir, "outside.workflow.ts");
    const markerFile = path.join(tempDir, "wf-outside-marker.txt");
    await writeWorkflow(outsideWf, "escaped-wf", "desc", markerFile);

    // Symlink it inside the workspace workflows directory
    await fs.mkdir(path.join(tempDir, "workflows"), { recursive: true });
    const symlinkPath = path.join(tempDir, "workflows/escaped.workflow.ts");
    await fs.symlink(outsideWf, symlinkPath);

    // Create a safe workflow file inside the workflows directory
    const safeWf = path.join(tempDir, "workflows/safe.workflow.ts");
    await writeWorkflow(safeWf, "safe-wf", "desc");

    // Run list workflows --report json
    const result = await runCli(["list", "workflows", "--report", "json"]);

    expect(result.exitCode).toBe(ExitCode.Success);
    const output = JSON.parse(result.stdout);
    
    // Escaped workflow should not be loaded, but safe workflow should be loaded
    const workflows = output.resources.map((r: any) => r.name);
    expect(workflows).not.toContain("escaped-wf");
    expect(workflows).toContain("safe-wf");

    // Diagnostic should include CONFIG_PATH_SYMLINK_ESCAPE
    const configDiagnostics = output.configDiagnostics || [];
    const symlinkWarning = configDiagnostics.find((d: any) => d.code === "CONFIG_PATH_SYMLINK_ESCAPE");
    expect(symlinkWarning).toBeDefined();

    // Marker file should not be written (proves module was not evaluated)
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);
  });

  it("2. Shared-agent symlink escapes are rejected before VM evaluation", async () => {
    if (!symlinksSupported) return;

    // Config
    const configContent = `
sharedAgents:
  include:
    - ".open-dynamic-workflow/agents/**/*.agent.ts"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Target outside agent file
    const outsideAgent = path.join(outsideDir, "outside.agent.ts");
    const markerFile = path.join(tempDir, "agent-outside-marker.txt");
    await writeAgent(outsideAgent, "escaped-agent", markerFile);

    // Symlink
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow/agents"), { recursive: true });
    const symlinkPath = path.join(tempDir, ".open-dynamic-workflow/agents/escaped.agent.ts");
    await fs.symlink(outsideAgent, symlinkPath);

    // Run list agents --report json
    const result = await runCli(["list", "agents", "--report", "json"]);

    // If VM/module loading is prevented, exit should be clean or raise safety policy violation, but most importantly no marker
    const output = JSON.parse(result.stdout);
    const configDiagnostics = output.configDiagnostics || [];
    const symlinkWarning = configDiagnostics.find((d: any) => d.code === "CONFIG_PATH_SYMLINK_ESCAPE");
    expect(symlinkWarning).toBeDefined();

    const agents = output.resources.map((r: any) => r.id);
    expect(agents).not.toContain("escaped-agent");
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);
  });

  it("3. Tool symlink escapes are rejected before import", async () => {
    if (!symlinksSupported) return;

    // Config
    const configContent = `
tools:
  include:
    - ".open-dynamic-workflow/tools/**/*.tool.ts"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Target outside tool file
    const outsideTool = path.join(outsideDir, "outside.tool.ts");
    const markerFile = path.join(tempDir, "tool-outside-marker.txt");
    await writeTool(outsideTool, "escaped-tool", markerFile);

    // Symlink
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow/tools"), { recursive: true });
    const symlinkPath = path.join(tempDir, ".open-dynamic-workflow/tools/escaped.tool.ts");
    await fs.symlink(outsideTool, symlinkPath);

    // Run list tools --report json
    const result = await runCli(["list", "tools", "--report", "json"]);

    const output = JSON.parse(result.stdout);
    const configDiagnostics = output.configDiagnostics || [];
    const symlinkWarning = configDiagnostics.find((d: any) => d.code === "CONFIG_PATH_SYMLINK_ESCAPE");
    expect(symlinkWarning).toBeDefined();

    const tools = output.resources.map((r: any) => r.id);
    expect(tools).not.toContain("escaped-tool");
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);
  });

  it("4. Strict list fails before loading resources for out-of-workspace config patterns", async () => {
    // Config: includes invalid pattern
    const configContent = `
tools:
  include:
    - "../outside-tools/**/*.tool.js"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Add a valid in-workspace workflow that has a side-effect marker
    const markerFile = path.join(tempDir, "wf-strict-marker.txt");
    await writeWorkflow(path.join(tempDir, "workflows/safe.workflow.ts"), "safe-wf", "desc", markerFile);

    // Run list --strict
    const result = await runCli(["list", "--strict"]);

    // Non-zero exit code
    expect(result.exitCode).not.toBe(ExitCode.Success);
    expect(result.stderr).toContain("CONFIG_PATH_OUTSIDE_WORKSPACE");

    // The marker file is absent (shows it failed before evaluating workflows)
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);
  });

  it("5. Validate fails before loading resources for out-of-workspace config patterns", async () => {
    // Config: includes invalid pattern
    const configContent = `
tools:
  include:
    - "../outside-tools/**/*.tool.js"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Add a valid in-workspace workflow that has a side-effect marker
    const markerFile = path.join(tempDir, "wf-validate-marker.txt");
    await writeWorkflow(path.join(tempDir, "workflows/safe.workflow.ts"), "safe-wf", "desc", markerFile);

    // Run validate with --strict
    const result = await runCli(["validate", "workflows/safe.workflow.ts", "--strict"]);

    // Non-zero exit code
    expect(result.exitCode).not.toBe(ExitCode.Success);
    expect(result.stderr).toContain("CONFIG_PATH_OUTSIDE_WORKSPACE");

    // Marker file is absent
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);

    // Now test that without --strict, a clean safe workflow succeeds
    const cleanWf = path.join(tempDir, "workflows/clean.workflow.ts");
    await writeWorkflow(cleanWf, "clean-wf", "desc");
    const nonStrictResult = await runCli(["validate", "workflows/clean.workflow.ts"]);
    expect(nonStrictResult.exitCode).toBe(ExitCode.Success);
  });

  it("6. Run fails before execution for out-of-workspace config patterns", async () => {
    // Config: includes invalid pattern
    const configContent = `
tools:
  include:
    - "../outside-tools/**/*.tool.js"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Add a valid in-workspace workflow that has a side-effect marker
    const markerFile = path.join(tempDir, "wf-run-marker.txt");
    await writeWorkflow(path.join(tempDir, "workflows/safe.workflow.ts"), "safe-wf", "desc", markerFile);

    // Run command with --strict
    const result = await runCli(["run", "workflows/safe.workflow.ts", "--provider", "mock", "--strict"]);

    // Non-zero exit code
    expect(result.exitCode).not.toBe(ExitCode.Success);
    expect(result.stderr).toContain("CONFIG_PATH_OUTSIDE_WORKSPACE");

    // Marker file is absent
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);

    // Now test that without --strict, a clean safe workflow succeeds
    const cleanWf = path.join(tempDir, "workflows/clean.workflow.ts");
    await writeWorkflow(cleanWf, "clean-wf", "desc");
    const nonStrictResult = await runCli(["run", "workflows/clean.workflow.ts", "--provider", "mock"]);
    expect(nonStrictResult.exitCode).toBe(ExitCode.Success);
  });

  it("7. CLI directory override outside cwd is rejected", async () => {
    // Run CLI list tools with out-of-workspace dir override
    const outsidePath = path.join(outsideDir, "cli-override-tools");
    const result = await runCli(["list", "tools", "--dir", outsidePath, "--report", "json"]);

    expect(result.exitCode).toBe(ExitCode.Success); // Non-strict list exits 0
    const output = JSON.parse(result.stdout);
    const outsideDiags = output.configDiagnostics.filter(
      (d: any) => d.code === "CONFIG_PATH_OUTSIDE_WORKSPACE"
    );
    expect(outsideDiags.length).toBeGreaterThanOrEqual(1);

    // Strict mode CLI directory override outside cwd
    const strictResult = await runCli(["list", "tools", "--dir", outsidePath, "--strict"]);
    expect(strictResult.exitCode).not.toBe(ExitCode.Success);
    expect(strictResult.stderr).toContain("CONFIG_PATH_OUTSIDE_WORKSPACE");
  });

  it("8. Strict CLI commands fail before evaluating resources if a directory-only exclude pattern is present", async () => {
    // Config: includes directory-only exclude pattern
    const configContent = `
workflow:
  include:
    - "workflows/**/*.workflow.ts"
  exclude:
    - "workflows"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Add a valid in-workspace workflow that has a side-effect marker
    const markerFile = path.join(tempDir, "wf-strict-exclude-marker.txt");
    await writeWorkflow(path.join(tempDir, "workflows/safe.workflow.ts"), "safe-wf", "desc", markerFile);

    // 1. Assert list --strict fails and mentions CONFIG_PATH_DIRECTORY_ONLY
    const listResult = await runCli(["list", "--strict"]);
    expect(listResult.exitCode).not.toBe(ExitCode.Success);
    expect(listResult.stderr).toContain("CONFIG_PATH_DIRECTORY_ONLY");
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);

    // 2. Assert validate --strict fails and mentions CONFIG_PATH_DIRECTORY_ONLY
    const validateResult = await runCli(["validate", "workflows/safe.workflow.ts", "--strict"]);
    expect(validateResult.exitCode).not.toBe(ExitCode.Success);
    expect(validateResult.stderr).toContain("CONFIG_PATH_DIRECTORY_ONLY");
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);

    // 3. Assert run --strict fails and mentions CONFIG_PATH_DIRECTORY_ONLY
    const runResult = await runCli(["run", "workflows/safe.workflow.ts", "--provider", "mock", "--strict"]);
    expect(runResult.exitCode).not.toBe(ExitCode.Success);
    expect(runResult.stderr).toContain("CONFIG_PATH_DIRECTORY_ONLY");
    await expect(fs.stat(markerFile).then(() => true).catch(() => false)).resolves.toBe(false);
  });
});
