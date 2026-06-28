import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { runCli as odwRunCli } from "../../src/cli/index.js";
import { ExitCode } from "../../src/errors/exit-codes.js";

describe("CLI Path Config Legacy Compatibility Integration", () => {
  let tempDir: string;
  let stdoutData: string[];
  let stderrData: string[];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-cli-legacy-compat-"));
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

  async function writeLegacyConfig(dir: string) {
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
    await fs.mkdir(path.join(dir, ".open-dynamic-workflow"), { recursive: true });
    await fs.writeFile(path.join(dir, ".open-dynamic-workflow/config.yaml"), configContent, "utf8");
  }

  // --- Helper to write a valid workflow file ---
  async function writeWorkflow(filePath: string, name: string, description = "desc") {
    const parent = path.dirname(filePath);
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(
      filePath,
      `
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
  async function writeAgent(filePath: string, id: string) {
    const parent = path.dirname(filePath);
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(
      filePath,
      `
      import { defineAgent } from "@travisliu/open-dynamic-workflow";
      export default defineAgent({
        id: ${JSON.stringify(id)},
        description: "agent desc",
        run: async () => {}
      });
      `
    );
  }

  // --- Helper to write a valid tool file ---
  async function writeTool(filePath: string, id: string) {
    const parent = path.dirname(filePath);
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(
      filePath,
      `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: ${JSON.stringify(id)},
        description: "tool desc",
        inputSchema: { type: "object" },
        run: async () => {}
      });
      `
    );
  }

  it("1. Legacy project lists generic files", async () => {
    await writeLegacyConfig(tempDir);
    await writeWorkflow(path.join(tempDir, "workflows/legacy-review.js"), "legacy-review");
    await writeWorkflow(path.join(tempDir, "workflows/legacy.test.js"), "legacy-test-excluded");
    await writeAgent(path.join(tempDir, ".open-dynamic-workflow/agents/legacy-agent.ts"), "legacy-agent");
    await writeTool(path.join(tempDir, ".open-dynamic-workflow/tools/legacy-tool.js"), "legacy-tool");

    const result = await runCli(["list", "--report", "json"]);
    expect(result.exitCode).toBe(ExitCode.Success);

    const output = JSON.parse(result.stdout);
    const resources = output.resources;
    const names = resources.map((r: any) => r.name || r.id);

    expect(names).toContain("legacy-review");
    expect(names).toContain("legacy-agent");
    expect(names).toContain("legacy-tool");
    expect(names).not.toContain("legacy-test-excluded");

    const diags = output.configDiagnostics || [];
    expect(diags.some((d: any) => d.code === "CONFIG_PATH_LEGACY_KEY_USED")).toBe(true);
  });

  it("2. Legacy workflow validates by name", async () => {
    await writeLegacyConfig(tempDir);
    await writeWorkflow(path.join(tempDir, "workflows/legacy-review.js"), "legacy-review");

    const result = await runCli(["validate", "legacy-review"]);
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.stdout).toContain("legacy-review");
  });

  it("3. Legacy workflow validates by direct file path", async () => {
    await writeLegacyConfig(tempDir);
    await writeWorkflow(path.join(tempDir, "workflows/legacy-review.js"), "legacy-review");

    const result = await runCli(["validate", "workflows/legacy-review.js"]);
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.stdout).toContain("legacy-review");
  });

  it("4. Legacy workflow runs with the mock provider", async () => {
    await writeLegacyConfig(tempDir);
    await writeWorkflow(path.join(tempDir, "workflows/legacy-review.js"), "legacy-review");

    const result = await runCli(["run", "legacy-review", "--provider", "mock", "--report", "json"]);
    expect(result.exitCode).toBe(ExitCode.Success);
    
    const output = JSON.parse(result.stdout);
    expect(output.status).toBe("succeeded");
  });

  it("5. Legacy nested exclude prevents invalid generic workflow from loading", async () => {
    await writeLegacyConfig(tempDir);
    // Write invalid workflow inside excluded file
    await fs.mkdir(path.join(tempDir, "workflows"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "workflows/legacy.test.js"), "INVALID CODE METADATA");

    const result = await runCli(["list", "workflows", "--report", "json"]);
    expect(result.exitCode).toBe(ExitCode.Success);

    const output = JSON.parse(result.stdout);
    const resources = output.resources;
    expect(resources.some((r: any) => r.name === "legacy-test-excluded")).toBe(false);
  });

  it("6. Legacy-key warnings remain non-fatal under strict list", async () => {
    await writeLegacyConfig(tempDir);
    await writeWorkflow(path.join(tempDir, "workflows/legacy-review.js"), "legacy-review");
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow/agents"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow/tools"), { recursive: true });

    const result = await runCli(["list", "--strict", "--report", "json"]);
    expect(result.exitCode).toBe(ExitCode.Success);

    const output = JSON.parse(result.stdout);
    const diags = output.configDiagnostics || [];
    expect(diags.some((d: any) => d.code === "CONFIG_PATH_LEGACY_KEY_USED")).toBe(true);
  });

  it("7. New flat keys win over legacy keys end-to-end", async () => {
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
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), configContent, "utf8");

    await writeWorkflow(path.join(tempDir, "legacy-only/legacy.js"), "legacy-wf");
    await writeWorkflow(path.join(tempDir, "new-only/new.workflow.js"), "new-wf");

    const result = await runCli(["list", "workflows", "--report", "json"]);
    expect(result.exitCode).toBe(ExitCode.Success);

    const output = JSON.parse(result.stdout);
    const names = output.resources.map((r: any) => r.name);
    expect(names).toContain("new-wf");
    expect(names).not.toContain("legacy-wf");
  });
});
