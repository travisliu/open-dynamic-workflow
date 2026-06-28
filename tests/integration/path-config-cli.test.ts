import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { runCli as odwRunCli } from "../../src/cli/index.js";
import { ExitCode } from "../../src/errors/exit-codes.js";

describe("CLI Path Config Integration (Phase 2)", () => {
  let tempDir: string;
  let stdoutData: string[];
  let stderrData: string[];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-cli-path-config-"));
    stdoutData = [];
    stderrData = [];
    process.exitCode = 0;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function runCli(args: string[]) {
    const localStdout: string[] = [];
    const localStderr: string[] = [];

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      localStdout.push(chunk.toString());
      stdoutData.push(chunk.toString());
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      localStderr.push(chunk.toString());
      stderrData.push(chunk.toString());
      return true;
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      const msg = args.join(" ") + "\n";
      localStdout.push(msg);
      stdoutData.push(msg);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      const msg = args.join(" ") + "\n";
      localStderr.push(msg);
      stderrData.push(msg);
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
      `
      ${sideEffectCode}
      export const meta = {
        name: ${JSON.stringify(name)},
        description: ${JSON.stringify(description)},
        phases: ["planning", "implementation"],
        version: "1.0.0"
      };
      export default async function workflow() {}
      `
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

  it("suppresses default include and exclude zero-match warnings in JSON reports", async () => {
    await fs.mkdir(path.join(tempDir, "workflows"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow/agents"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow/tools"), { recursive: true });

    const result = await runCli(["list", "--report", "json"]);

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.stdout).not.toContain("*.agent.js");
    expect(result.stdout).not.toContain("*.tool.js");
    expect(result.stdout).not.toContain("CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
    expect(result.stdout).not.toContain("CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");

    const output = JSON.parse(result.stdout);
    const diagnostics = output.configDiagnostics || [];
    expect(diagnostics).toEqual([]);
  });

  it("TC-17/18: lists all resources through flat patterns, and filters by target resource type", async () => {
    // Arrange
    const configContent = `
sharedAgents:
  include:
    - ".open-dynamic-workflow/agents/**/*.ts"
  exclude:
    - "**/*.test.*"
tools:
  include:
    - ".open-dynamic-workflow/tools/**/*.ts"
  exclude:
    - "**/*.test.*"
workflow:
  include:
    - "workflows/**/*.workflow.ts"
  exclude:
    - "**/*.test.*"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    await writeWorkflow(path.join(tempDir, "workflows/w1.workflow.ts"), "workflow-one");
    await writeWorkflow(path.join(tempDir, "workflows/w2.test.workflow.ts"), "workflow-test-excluded");
    await writeAgent(path.join(tempDir, ".open-dynamic-workflow/agents/a1.ts"), "agent-one");
    await writeAgent(path.join(tempDir, ".open-dynamic-workflow/agents/a2.test.ts"), "agent-test-excluded");
    await writeTool(path.join(tempDir, ".open-dynamic-workflow/tools/t1.ts"), "tool-one");
    await writeTool(path.join(tempDir, ".open-dynamic-workflow/tools/t2.test.ts"), "tool-test-excluded");

    // Act - list all resources
    const allResult = await runCli(["list", "--report", "json"]);

    // Assert all resource list
    expect(allResult.exitCode).toBe(ExitCode.Success);
    const allOutput = JSON.parse(allResult.stdout);
    const resources = allOutput.resources;
    
    const workflowNames = resources.filter((r: any) => r.type === "workflow").map((r: any) => r.name);
    const agentIds = resources.filter((r: any) => r.type === "agent").map((r: any) => r.id);
    const toolIds = resources.filter((r: any) => r.type === "tool").map((r: any) => r.id);

    expect(workflowNames).toContain("workflow-one");
    expect(workflowNames).not.toContain("workflow-test-excluded");
    expect(agentIds).toContain("agent-one");
    expect(agentIds).not.toContain("agent-test-excluded");
    expect(toolIds).toContain("tool-one");
    expect(toolIds).not.toContain("tool-test-excluded");

    // Act - list workflows targeted
    const workflowResult = await runCli(["list", "workflows", "--report", "json"]);
    const workflowOutput = JSON.parse(workflowResult.stdout);
    const onlyWorkflows = workflowOutput.resources;
    expect(onlyWorkflows.every((r: any) => r.type === "workflow")).toBe(true);
    expect(onlyWorkflows.map((r: any) => r.name)).toContain("workflow-one");

    // Act - list agents targeted
    const agentResult = await runCli(["list", "agents", "--report", "json"]);
    const agentOutput = JSON.parse(agentResult.stdout);
    const onlyAgents = agentOutput.resources;
    expect(onlyAgents.every((r: any) => r.type === "agent")).toBe(true);
    expect(onlyAgents.map((r: any) => r.id)).toContain("agent-one");

    // Act - list tools targeted
    const toolResult = await runCli(["list", "tools", "--report", "json"]);
    const toolOutput = JSON.parse(toolResult.stdout);
    const onlyTools = toolOutput.resources;
    expect(onlyTools.every((r: any) => r.type === "tool")).toBe(true);
    expect(onlyTools.map((r: any) => r.id)).toContain("tool-one");
  });

  it("reports definition-missing diagnostics for broad plain agent and tool includes", async () => {
    const configContent = `
sharedAgents:
  include:
    - ".open-dynamic-workflow/agents/**/*.js"
tools:
  include:
    - ".open-dynamic-workflow/tools/**/*.js"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    await writeAgent(path.join(tempDir, ".open-dynamic-workflow/agents/valid.js"), "plain-agent");
    await writeTool(path.join(tempDir, ".open-dynamic-workflow/tools/valid.js"), "plain-tool");
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/agents/helper.js"), "export const helper = true;");
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/tools/helper.js"), "export const helper = true;");

    const result = await runCli(["list", "--report", "json"]);

    expect(result.exitCode).toBe(ExitCode.Success);
    const output = JSON.parse(result.stdout);
    const ids = output.resources.map((r: any) => r.id);
    const warningCodes = output.warnings.map((d: any) => d.code);

    expect(ids).toContain("plain-agent");
    expect(ids).toContain("plain-tool");
    expect(warningCodes).toContain("AGENT_DEFINITION_MISSING");
    expect(warningCodes).toContain("TOOL_DEFINITION_MISSING");
  });

  it("TC-07: rejects symlink escapes outside the workspace", async () => {
    // Arrange
    const configContent = `
workflow:
  include:
    - "workflows/**/*.workflow.ts"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Create a target file outside the workspace
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-outside-"));
    const outsideFile = path.join(outsideDir, "outside.workflow.ts");
    await writeWorkflow(outsideFile, "outside-workflow");

    // Create symlink inside workflows/ targeting the outside file
    await fs.mkdir(path.join(tempDir, "workflows"), { recursive: true });
    const symlinkPath = path.join(tempDir, "workflows/escaped.workflow.ts");
    await fs.symlink(outsideFile, symlinkPath);

    // Act
    const result = await runCli(["list", "workflows", "--report", "json"]);

    // Assert
    expect(result.exitCode).toBe(ExitCode.Success); // Non-strict list doesn't exit non-zero for symlink escape warning
    const output = JSON.parse(result.stdout);
    const workflows = output.resources.map((r: any) => r.name);
    
    // The outside workflow should NOT be loaded
    expect(workflows).not.toContain("outside-workflow");
    
    // There should be a warning diagnostic about the symlink escape
    const configDiagnostics = output.configDiagnostics || [];
    const symlinkWarning = configDiagnostics.find((d: any) => d.code === "CONFIG_PATH_SYMLINK_ESCAPE");
    expect(symlinkWarning).toBeDefined();

    // Cleanup outside dir
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("TC-20/21/22: asserts strictness policy for directory-only configuration errors", async () => {
    // Arrange - Config contains invalid directory-only include pattern (fatal in strict contexts)
    const invalidConfig = `
workflow:
  include:
    - "workflows"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), invalidConfig);

    const sideEffectPath = path.join(tempDir, "side-effect.txt");
    await writeWorkflow(path.join(tempDir, "workflows/w1.workflow.ts"), "workflow-one", "desc", sideEffectPath);

    // --- 1. Act: non-strict list ---
    const listResult = await runCli(["list", "workflows", "--report", "json"]);
    
    // Assert: non-strict list exits 0 and does not load resources, but reports fatal diagnostics in the JSON
    expect(listResult.exitCode).toBe(ExitCode.Success);
    const listOutput = JSON.parse(listResult.stdout);
    expect(listOutput.configDiagnostics.some((d: any) => d.code === "CONFIG_PATH_DIRECTORY_ONLY")).toBe(true);
    await expect(fs.stat(sideEffectPath).then(() => true).catch(() => false)).resolves.toBe(false); // side effect should not run

    // --- 2. Act: strict list ---
    const strictListResult = await runCli(["list", "workflows", "--strict"]);

    // Assert: strict list fails immediately and side effect was not evaluated
    expect(strictListResult.exitCode).not.toBe(ExitCode.Success);
    expect(strictListResult.stderr).toContain("CONFIG_PATH_DIRECTORY_ONLY");
    await expect(fs.stat(sideEffectPath).then(() => true).catch(() => false)).resolves.toBe(false);

    // --- 3. Act: validate ---
    const validateResult = await runCli(["validate", "workflows/w1.workflow.ts"]);

    // Assert: validate fails immediately for fatal config diagnostic
    expect(validateResult.exitCode).not.toBe(ExitCode.Success);
    expect(validateResult.stderr).toContain("CONFIG_PATH_DIRECTORY_ONLY");
    await expect(fs.stat(sideEffectPath).then(() => true).catch(() => false)).resolves.toBe(false);

    // --- 4. Act: run ---
    const runResult = await runCli(["run", "workflows/w1.workflow.ts", "--provider", "mock"]);

    // Assert: run fails immediately
    expect(runResult.exitCode).not.toBe(ExitCode.Success);
    expect(runResult.stderr).toContain("CONFIG_PATH_DIRECTORY_ONLY");
    await expect(fs.stat(sideEffectPath).then(() => true).catch(() => false)).resolves.toBe(false);
  });

  it("TC-27/28/29: respects CLI directory overrides while preserving excludes", async () => {
    // Arrange
    const configContent = `
sharedAgents:
  include:
    - ".open-dynamic-workflow/agents/**/*.ts"
  exclude:
    - "**/skip.ts"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Files in default agents directory
    await writeAgent(path.join(tempDir, ".open-dynamic-workflow/agents/a1.ts"), "agent-default");
    
    // Files in custom overridden directory
    const customDir = "custom-agents";
    await writeAgent(path.join(tempDir, `${customDir}/ok.ts`), "agent-custom-ok");
    await writeAgent(path.join(tempDir, `${customDir}/skip.ts`), "agent-custom-skip"); // should be excluded

    // Act - list agents with targeted dir override
    const result = await runCli(["list", "agents", "--dir", customDir, "--report", "json"]);

    // Assert
    expect(result.exitCode).toBe(ExitCode.Success);
    const output = JSON.parse(result.stdout);
    const agentIds = output.resources.map((r: any) => r.id);

    // include is replaced by custom directory, so default resource is absent
    expect(agentIds).not.toContain("agent-default");
    
    // Custom directory resource is included
    expect(agentIds).toContain("agent-custom-ok");
    
    // Exclude pattern "**/skip.ts" is still applied and skips skip.ts
    expect(agentIds).not.toContain("agent-custom-skip");

    // Act - invalid targeted flag combination
    const invalidCli = await runCli(["list", "workflows", "--dir", "custom-agents", "--tools-dir", "custom-tools"]);
    
    // Assert usage error
    expect(invalidCli.exitCode).toBe(ExitCode.CLI_USAGE_ERROR);
  });

  it("TC-23/24: resolves by workflow name through discovery, and allows direct file path bypass", async () => {
    // Arrange
    const configContent = `
workflow:
  include:
    - "workflows/discovered/**/*.workflow.ts"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent);

    // Discovered workflow
    await writeWorkflow(path.join(tempDir, "workflows/discovered/main.workflow.ts"), "main-wf");
    
    // Direct file bypass workflow (outside discovery includes)
    const directFile = path.join(tempDir, "other/manual.workflow.ts");
    await writeWorkflow(directFile, "manual-wf");

    // Act - validate discovered workflow by name
    const nameResult = await runCli(["validate", "main-wf"]);
    expect(nameResult.exitCode).toBe(ExitCode.Success);
    expect(nameResult.stdout).toContain("main-wf");

    // Act - validate direct file path outside discovery
    const fileResult = await runCli(["validate", "other/manual.workflow.ts"]);
    expect(fileResult.exitCode).toBe(ExitCode.Success);
    expect(fileResult.stdout).toContain("manual-wf");
  });

  it("TC-08/30/31/32: verifies zero-match warnings and reporter diagnostics", async () => {
    // Arrange
    const zeroMatchConfig = `
workflow:
  include:
    - "missing/**/*.workflow.ts"
  exclude:
    - "**/never-excl.ts"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), zeroMatchConfig);

    // --- 1. Act: JSON format ---
    const jsonResult = await runCli(["list", "workflows", "--report", "json"]);
    
    // Assert
    expect(jsonResult.exitCode).toBe(ExitCode.Success);
    const jsonOutput = JSON.parse(jsonResult.stdout);
    const diags = jsonOutput.configDiagnostics;
    expect(diags.some((d: any) => d.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING")).toBe(true);
    expect(diags.some((d: any) => d.code === "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING")).toBe(true);

    // --- 2. Act: JSONL format ---
    const jsonlResult = await runCli(["list", "workflows", "--report", "jsonl"]);

    // Assert
    expect(jsonlResult.exitCode).toBe(ExitCode.Success);
    const lines = jsonlResult.stdout.trim().split("\n");
    const diagEvents = lines.map((l) => JSON.parse(l)).filter((e) => e.type === "list.configDiagnostic");
    expect(diagEvents.length).toBeGreaterThanOrEqual(2);
    expect(diagEvents.some((e) => e.diagnostic.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING")).toBe(true);

    // --- 3. Act: Pretty format ---
    const prettyResult = await runCli(["list", "workflows"]);

    // Assert
    expect(prettyResult.exitCode).toBe(ExitCode.Success);
    expect(prettyResult.stdout).toContain("Warnings:");
    expect(prettyResult.stdout).toContain("CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
    expect(prettyResult.stdout).toContain("CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
  });

  it("TC-26: runs doctor command rendering diagnostics andverbose migration guidance", async () => {
    // Arrange - Legacy config keys which generate warnings
    const legacyConfig = `
sharedAgents:
  dir: ".open-dynamic-workflow/agents"
tools:
  dir: ".open-dynamic-workflow/tools"
workflow:
  discovery:
    include:
      - "workflows/**/*.ts"
`;
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), legacyConfig);

    // Act
    const result = await runCli(["doctor", "--verbose"]);

    // Assert
    expect(result.exitCode).toBe(ExitCode.Success); // Doctor succeeds even with fatal-in-strict diagnostics or warnings
    expect(result.stdout).toContain("CONFIG_PATH_LEGACY_KEY_USED");
    expect(result.stdout).toContain("Migrate to the new flat"); // Verbose migration guidance
  });
});
