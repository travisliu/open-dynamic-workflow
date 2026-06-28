import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { main } from "../../src/cli/index.js";
import { renderCliError } from "../../src/cli/error-output.js";
import { loadConfig } from "../../src/config/load.js";
import { ExitCode, exitCodeForError } from "../../src/errors/exit-codes.js";

describe("Phase 3 Path Configuration - AAA Acceptance Tests", () => {
  let tempDir: string;
  let outsideDir: string;
  let symlinksSupported = true;

  beforeEach(async () => {
    // Arrange: Create temp directories for isolation
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-phase3-acc-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-phase3-outside-"));

    try {
      const testLink = path.join(tempDir, "test-symlink-support");
      await fs.symlink("target", testLink);
      await fs.unlink(testLink);
    } catch {
      symlinksSupported = false;
    }
  });

  afterEach(async () => {
    // Cleanup temp directories
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Thread-safe wrapper that calls main directly to avoid race conditions on global process.exitCode
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

    let exitCode = ExitCode.Success;
    let error: any = null;
    const fullArgv = [
      process.argv[0] ?? "node",
      process.argv[1] ?? "open-dynamic-workflow",
      ...args,
      "--cwd",
      tempDir,
    ];

    try {
      await main(fullArgv);
    } catch (err: any) {
      error = err;
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      const cause = err && typeof err === "object" && "cause" in err ? err.cause : undefined;
      const causeCode = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
      const isControlError = 
        code === "commander.helpDisplayed" ||
        code === "commander.help" ||
        code === "commander.version" ||
        causeCode === "commander.helpDisplayed" ||
        causeCode === "commander.help" ||
        causeCode === "commander.version";

      if (isControlError) {
        exitCode = ExitCode.Success;
      } else {
        renderCliError(err, { argv: fullArgv });
        exitCode = exitCodeForError(err);
      }
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    return {
      stdout: localStdout.join(""),
      stderr: localStderr.join(""),
      error,
      exitCode,
    };
  }

  // --- Helper to write a valid workflow file with side effect option ---
  async function writeWorkflow(filePath: string, name: string, sideEffectPath?: string) {
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
      ${sideEffectCode}
      export const meta = {
        name: ${JSON.stringify(name)},
        description: "workflow desc",
        phases: ["planning", "implementation"],
        version: "1.0.0"
      };
      export default async function workflow() {}
      `
    );
  }

  // --- Helper to write a valid agent file with side effect option ---
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

  // --- Helper to write a valid tool file with side effect option ---
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

  it("1. Legacy Configurations: successfully list and validate generic resources, emitting non-fatal warnings", async () => {
    // ----------------------------------------------------
    // ARRANGE: Set up a legacy-style project configuration and generic resources
    // ----------------------------------------------------
    const configContent = `
defaultProvider: mock
sharedAgents:
  dir: ".open-dynamic-workflow/agents"
tools:
  dir: ".open-dynamic-workflow/tools"
workflow:
  discovery:
    include:
      - "workflows/**/*.js"
      - "workflows/**/*.ts"
    exclude:
      - "**/*.test.*"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Write legacy generic workflows, agents, and tools
    await writeWorkflow(path.join(tempDir, "workflows/legacy-review.js"), "legacy-review");
    await writeWorkflow(path.join(tempDir, "workflows/legacy.test.js"), "legacy-test-excluded");
    await writeAgent(path.join(tempDir, ".open-dynamic-workflow/agents/legacy-agent.ts"), "legacy-agent");
    await writeTool(path.join(tempDir, ".open-dynamic-workflow/tools/legacy-tool.js"), "legacy-tool");

    // ----------------------------------------------------
    // ACT: Call list/validate and programmatically load the configuration
    // ----------------------------------------------------
    const listResult = await runCli(["list", "--report", "json"]);
    const strictListResult = await runCli(["list", "--strict", "--report", "json"]);
    const validateResult = await runCli(["validate", "legacy-review"]);
    const configObj = await loadConfig({ cwd: tempDir, cli: {} });

    // ----------------------------------------------------
    // ASSERT: Verify resources load successfully, warnings are emitted, and strict context doesn't crash on warnings
    // ----------------------------------------------------
    // Exits successfully
    expect(listResult.exitCode, `list failed. stdout: ${listResult.stdout}\nstderr: ${listResult.stderr}`).toBe(ExitCode.Success);
    expect(strictListResult.exitCode, `strict list failed. stdout: ${strictListResult.stdout}\nstderr: ${strictListResult.stderr}`).toBe(ExitCode.Success);
    expect(validateResult.exitCode, `validate failed. stdout: ${validateResult.stdout}\nstderr: ${validateResult.stderr}`).toBe(ExitCode.Success);

    // Resources are discovered correctly
    const listOutput = JSON.parse(listResult.stdout);
    const names = listOutput.resources.map((r: any) => r.name || r.id);
    expect(names).toContain("legacy-review");
    expect(names).toContain("legacy-agent");
    expect(names).toContain("legacy-tool");
    expect(names).not.toContain("legacy-test-excluded");

    // Check diagnostics warnings
    const diags = listOutput.configDiagnostics || [];
    expect(diags.some((d: any) => d.code === "CONFIG_PATH_LEGACY_KEY_USED")).toBe(true);

    // Programmatic check
    expect(configObj._configDiagnostics.some((d: any) => d.code === "CONFIG_PATH_LEGACY_KEY_USED")).toBe(true);
  });

  it("2. Precedence: Flat configurations correctly override legacy configurations for the same dimension", async () => {
    // ----------------------------------------------------
    // ARRANGE: Set up both legacy and flat configurations for workflows
    // ----------------------------------------------------
    const configContent = `
defaultProvider: mock
workflow:
  include:
    - "new-only/**/*.workflow.js"
  discovery:
    include:
      - "legacy-only/**/*.js"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    await writeWorkflow(path.join(tempDir, "legacy-only/legacy.js"), "legacy-wf");
    await writeWorkflow(path.join(tempDir, "new-only/new.workflow.js"), "new-wf");

    // ----------------------------------------------------
    // ACT: Run CLI list and load configuration
    // ----------------------------------------------------
    const result = await runCli(["list", "workflows", "--report", "json"]);
    const configObj = await loadConfig({ cwd: tempDir, cli: {} });

    // ----------------------------------------------------
    // ASSERT: Verify flat configs take precedence and legacy ones are ignored, with override warnings emitted
    // ----------------------------------------------------
    expect(result.exitCode).toBe(ExitCode.Success);
    
    const output = JSON.parse(result.stdout);
    const discoveredNames = output.resources.map((r: any) => r.name);
    expect(discoveredNames).toContain("new-wf");
    expect(discoveredNames).not.toContain("legacy-wf");

    // Verify overrides warnings are emitted
    const diags = configObj._configDiagnostics || [];
    expect(diags.some((d: any) => d.code === "CONFIG_PATH_NEW_OVERRIDES_LEGACY")).toBe(true);
  });

  it("3. Security Boundaries: Unsafe paths, directory-only values, and symlink escapes are rejected early with NO side-effects", async () => {
    // ----------------------------------------------------
    // ARRANGE: Set up config containing relative escapes, absolute path configs, directory-only values,
    // and symlink escapes pointing outside workspace, all with side-effect markers.
    // ----------------------------------------------------
    const relativeEscMarker = path.join(tempDir, "relative-esc-marker.txt");
    const absoluteEscMarker = path.join(tempDir, "absolute-esc-marker.txt");
    const directoryEscMarker = path.join(tempDir, "directory-esc-marker.txt");
    const symlinkEscMarker = path.join(tempDir, "symlink-esc-marker.txt");

    // Outside files
    const outsideWfRelative = path.join(outsideDir, "relative.workflow.ts");
    const outsideWfAbsolute = path.join(outsideDir, "absolute.workflow.ts");
    const outsideWfSymlink = path.join(outsideDir, "symlink.workflow.ts");
    await writeWorkflow(outsideWfRelative, "relative-wf", relativeEscMarker);
    await writeWorkflow(outsideWfAbsolute, "absolute-wf", absoluteEscMarker);
    await writeWorkflow(outsideWfSymlink, "symlink-wf", symlinkEscMarker);

    // In-workspace directory-only target containing file
    const workflowsDir = path.join(tempDir, "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    await writeWorkflow(path.join(workflowsDir, "wf-in-dir.ts"), "dir-wf", directoryEscMarker);

    // Configuration file specifying relative, absolute, and directory-only paths
    const absolutePathConfigValue = outsideWfAbsolute.replace(/\\/g, "/");
    const configContent = `
workflow:
  include:
    - "../outside/**/*.workflow.ts"
    - "${absolutePathConfigValue}"
    - "workflows"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Set up symlink escape if supported
    if (symlinksSupported) {
      const symlinkPath = path.join(tempDir, "workflows/escaped.workflow.ts");
      await fs.symlink(outsideWfSymlink, symlinkPath);
    }

    // A valid workflow for targets in run/validate
    const validWfPath = path.join(tempDir, "workflows/safe.workflow.ts");
    const safeMarker = path.join(tempDir, "safe-marker.txt");
    await writeWorkflow(validWfPath, "safe-wf", safeMarker);

    // ----------------------------------------------------
    // ACT: Run CLI list --strict, validate, and run, and loadConfig
    // ----------------------------------------------------
    const listResult = await runCli(["list", "--strict"]);
    const validateResult = await runCli(["validate", "workflows/safe.workflow.ts"]);
    const runResult = await runCli(["run", "workflows/safe.workflow.ts", "--provider", "mock"]);

    // ----------------------------------------------------
    // ASSERT: Verify all commands failed early, reporting fatal diagnostics, and NO markers were written (proving no evaluation)
    // ----------------------------------------------------
    // Commands must exit non-zero
    expect(listResult.exitCode).not.toBe(ExitCode.Success);
    expect(validateResult.exitCode).not.toBe(ExitCode.Success);
    expect(runResult.exitCode).not.toBe(ExitCode.Success);

    // Verify error diagnostics in output
    const combinedStderr = listResult.stderr + validateResult.stderr + runResult.stderr;
    expect(combinedStderr).toContain("CONFIG_PATH_OUTSIDE_WORKSPACE");
    expect(combinedStderr).toContain("CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN");

    // Verify side effect markers are NOT created (which proves they were never evaluated/imported)
    await expect(fs.stat(relativeEscMarker).then(() => true).catch(() => false)).resolves.toBe(false);
    await expect(fs.stat(absoluteEscMarker).then(() => true).catch(() => false)).resolves.toBe(false);
    await expect(fs.stat(directoryEscMarker).then(() => true).catch(() => false)).resolves.toBe(false);
    await expect(fs.stat(symlinkEscMarker).then(() => true).catch(() => false)).resolves.toBe(false);
    
    // Even the safe target marker should be absent because execution/validation failed early before resource evaluation
    await expect(fs.stat(safeMarker).then(() => true).catch(() => false)).resolves.toBe(false);
  });
});
