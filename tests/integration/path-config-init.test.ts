import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { main } from "../../src/cli/index.js";
import { parse as parseYaml } from "yaml";

describe("Init Command Path Config Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-init-path-config-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

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

  it("initializes project with flat include/exclude configuration and renamed starter workflow", async () => {
    const result = await runCli(["init", "--yes", "--provider", "mock", "--cwd", tempDir]);

    expect(result.error).toBeNull();

    const configPath = path.join(tempDir, ".open-dynamic-workflow/config.yaml");
    const workflowPath = path.join(tempDir, "workflows/example.workflow.ts");

    // Assert files exist on disk
    const configExists = await fs.stat(configPath).then(s => s.isFile()).catch(() => false);
    const workflowExists = await fs.stat(workflowPath).then(s => s.isFile()).catch(() => false);

    expect(configExists).toBe(true);
    expect(workflowExists).toBe(true);

    // Read and parse YAML configuration
    const configContent = await fs.readFile(configPath, "utf8");
    const parsedConfig = parseYaml(configContent) as any;

    // Assert flat structure without legacy keys
    expect(parsedConfig.sharedAgents).toBeDefined();
    expect(parsedConfig.sharedAgents.dir).toBeUndefined();
    expect(parsedConfig.sharedAgents.include).toContain(".open-dynamic-workflow/agents/**/*.agent.ts");
    expect(parsedConfig.sharedAgents.include).toContain(".open-dynamic-workflow/agents/**/*.agent.js");
    expect(parsedConfig.sharedAgents.exclude).toContain("**/*.test.*");
    expect(parsedConfig.sharedAgents.exclude).toContain("**/*.spec.*");

    expect(parsedConfig.tools).toBeDefined();
    expect(parsedConfig.tools.dir).toBeUndefined();
    expect(parsedConfig.tools.include).toContain(".open-dynamic-workflow/tools/**/*.tool.ts");
    expect(parsedConfig.tools.include).toContain(".open-dynamic-workflow/tools/**/*.tool.js");
    expect(parsedConfig.tools.exclude).toContain("**/*.test.*");
    expect(parsedConfig.tools.exclude).toContain("**/*.spec.*");

    expect(parsedConfig.workflow).toBeDefined();
    expect(parsedConfig.workflow.discovery).toBeUndefined();
    expect(parsedConfig.workflow.include).toContain("workflows/**/*.workflow.ts");
    expect(parsedConfig.workflow.include).toContain("workflows/**/*.workflow.js");
    expect(parsedConfig.workflow.exclude).toContain("**/*.test.*");
    expect(parsedConfig.workflow.exclude).toContain("**/*.spec.*");

    // Assert explicit patterns contain no brace expansion or directory-only globs
    const allIncludePatterns = [
      ...parsedConfig.sharedAgents.include,
      ...parsedConfig.tools.include,
      ...parsedConfig.workflow.include
    ];
    for (const p of allIncludePatterns) {
      expect(p).not.toContain("{");
      expect(p).not.toContain("}");
    }
  });

  it("respects custom directory flags and updates config.yaml accordingly", async () => {
    const result = await runCli([
      "init",
      "--yes",
      "--provider",
      "mock",
      "--cwd",
      tempDir,
      "--workflows-dir",
      "custom-workflows",
      "--agents-dir",
      "custom-agents",
      "--tools-dir",
      "custom-tools"
    ]);

    expect(result.error).toBeNull();

    const configPath = path.join(tempDir, ".open-dynamic-workflow/config.yaml");
    const workflowPath = path.join(tempDir, "custom-workflows/example.workflow.ts");

    // Assert files exist on disk
    const configExists = await fs.stat(configPath).then(s => s.isFile()).catch(() => false);
    const workflowExists = await fs.stat(workflowPath).then(s => s.isFile()).catch(() => false);

    expect(configExists).toBe(true);
    expect(workflowExists).toBe(true);

    const configContent = await fs.readFile(configPath, "utf8");
    const parsedConfig = parseYaml(configContent) as any;

    expect(parsedConfig.sharedAgents.include).toContain("custom-agents/**/*.agent.ts");
    expect(parsedConfig.tools.include).toContain("custom-tools/**/*.tool.ts");
    expect(parsedConfig.workflow.include).toContain("custom-workflows/**/*.workflow.ts");
  });

  it("successfully discovers and validates the generated starter workflow in the initialized project", async () => {
    // 1. Initialize
    const initResult = await runCli(["init", "--yes", "--provider", "mock", "--cwd", tempDir]);
    expect(initResult.error).toBeNull();

    // 2. Run list workflows command to ensure discoverability
    const listResult = await runCli(["list", "workflows", "--cwd", tempDir, "--report", "json"]);
    expect(listResult.error).toBeNull();

    const listOutput = JSON.parse(listResult.stdout);
    expect(listOutput.status).toBe("succeeded");
    expect(listOutput.resources).toBeDefined();
    
    // Check if the generated workflow is found by the new discovery pattern
    const workflowNames = listOutput.resources.map((r: any) => r.name);
    expect(workflowNames).toContain("example-workflow");

    // 3. Run validate workflows/example.workflow.ts to ensure validation succeeds
    const validateResult = await runCli(["validate", "workflows/example.workflow.ts", "--cwd", tempDir]);
    expect(validateResult.error).toBeNull();
  });
});
