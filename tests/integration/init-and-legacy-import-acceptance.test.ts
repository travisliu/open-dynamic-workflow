import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";

const WORKSPACE_DIR = path.resolve(process.cwd());
const ODW_BIN = path.join(WORKSPACE_DIR, "dist/bin/open-dynamic-workflow.js");
const TSC_BIN = path.join(WORKSPACE_DIR, "node_modules/typescript/bin/tsc");

describe("Acceptance: Init and Legacy Import Verbose Diagnostics (AAA)", () => {
  let tempDir: string;

  beforeAll(async () => {
    // Ensure the project is built before running the integration test
    execSync("npm run build", { cwd: WORKSPACE_DIR, stdio: "ignore" });
  });

  it("completes the full init and verbose diagnostics lifecycle", async () => {
    // --- Arrange ---
    // 1. Create a clean, isolated OS-temporary project directory containing no package.json, node_modules, or ODW installation.
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-acceptance-test-"));

    // --- Act ---
    // 1. Execute `odw init --yes` in the temporary project directory to generate the configuration, `.open-dynamic-workflow/globals.d.ts`, and the default tools directory.
    const initResult = spawnSync("node", [ODW_BIN, "init", "--yes", "--provider", "mock"], {
      cwd: tempDir,
      encoding: "utf8"
    });

    expect(initResult.status).toBe(0);

    // --- Arrange continuation: set up mock tool files and workflow after init command creates directories ---
    const globalsDtsPath = path.join(tempDir, ".open-dynamic-workflow/globals.d.ts");
    const starterToolPath = path.join(tempDir, ".open-dynamic-workflow/tools/example.tool.ts");
    const toolsDir = path.join(tempDir, ".open-dynamic-workflow/tools");
    const workflowsDir = path.join(tempDir, "workflows");

    // Ensure the directories exist
    await fs.mkdir(toolsDir, { recursive: true });
    await fs.mkdir(workflowsDir, { recursive: true });

    // Set up no-import tool file
    const noImportToolPath = path.join(toolsDir, "no-import.tool.ts");
    await fs.writeFile(
      noImportToolPath,
      `/// <reference path="../globals.d.ts" />
export default defineTool({
  id: "no-import-tool",
  description: "no-import description",
  inputSchema: { type: "object", properties: {} },
  run: async (ctx) => "no-import-result"
});
`
    );

    // Set up legacy import tool file
    const legacyToolPath = path.join(toolsDir, "legacy.tool.ts");
    await fs.writeFile(
      legacyToolPath,
      `import { defineTool } from '@travisliu/open-dynamic-workflow';
export default defineTool({
  id: "legacy-tool",
  description: "legacy description",
  inputSchema: { type: "object", properties: {} },
  run: async (ctx) => "legacy-result"
});
`
    );

    // Set up minimal workflow that invokes both tools
    const workflowPath = path.join(workflowsDir, "test.workflow.ts");
    await fs.writeFile(
      workflowPath,
      `export const meta = {
  name: "test-workflow",
  description: "Acceptance test workflow",
  phases: ["main"]
};
export default async () => {
  const res1 = await tool({ definition: "no-import-tool", args: {} });
  const res2 = await tool({ definition: "legacy-tool", args: {} });
  return { res1, res2 };
};
`
    );

    // Save the exact contents of globals.d.ts
    const initialGlobalsContent = await fs.readFile(globalsDtsPath, "utf8");

    // 2. Run `tsc --noEmit` targeting the generated starter tool and verify it compiles successfully using the generated type declarations.
    const tscResult = spawnSync(
      "node",
      [
        TSC_BIN,
        "--noEmit",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--strict",
        "--lib",
        "es2022,dom",
        starterToolPath
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    // Run `odw validate`
    const validateResult = spawnSync(
      "node",
      [ODW_BIN, "validate", workflowPath],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    // 3. Run `odw run` with mock execution in verbose mode against the workflow.
    const verboseRunResult = spawnSync(
      "node",
      [
        ODW_BIN,
        "run",
        workflowPath,
        "--provider",
        "mock",
        "--report",
        "json",
        "--verbose"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    // 4. Run the same command in non-verbose mode.
    const nonVerboseRunResult = spawnSync(
      "node",
      [
        ODW_BIN,
        "run",
        workflowPath,
        "--provider",
        "mock",
        "--report",
        "json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    // --- Assert ---
    // 1. Verify that `globals.d.ts` and `example.tool.ts` are successfully created, and the starter tool contains the correct triple-slash reference directive pointing to the globals file.
    expect(existsSync(globalsDtsPath)).toBe(true);
    expect(existsSync(starterToolPath)).toBe(true);
    const starterToolContent = await fs.readFile(starterToolPath, "utf8");
    expect(starterToolContent).toContain('/// <reference path="../globals.d.ts" />');

    // Also assert that tsc output completed with code 0 and no errors
    expect(tscResult.status).toBe(0);
    expect(tscResult.stderr).toBe("");

    // 2. Verify that in verbose mode, exactly one informational diagnostic message about the legacy import is output to stderr, and no warning is output for the no-import tool.
    expect(verboseRunResult.status).toBe(0);
    expect(verboseRunResult.stderr).toContain("Legacy ODW defineTool import detected in .open-dynamic-workflow/tools/legacy.tool.ts");
    expect(verboseRunResult.stderr).not.toContain("no-import.tool.ts");
    
    // Check that there is exactly one such diagnostic line
    const warnings = verboseRunResult.stderr
      .split("\n")
      .filter((line) => line.includes("Legacy ODW defineTool import detected"));
    expect(warnings.length).toBe(1);

    // 3. Verify that in non-verbose mode, no compatibility warning is output to stderr.
    expect(nonVerboseRunResult.status).toBe(0);
    expect(nonVerboseRunResult.stderr).not.toContain("Legacy ODW defineTool import detected");

    // 4. Verify that stdout remains a valid JSON/JSONL document and the command exits with code 0 in both modes.
    // In verbose mode:
    let verboseStdoutParsed: any;
    expect(() => {
      verboseStdoutParsed = JSON.parse(verboseRunResult.stdout.trim());
    }).not.toThrow();
    expect(verboseStdoutParsed.status).toBe("succeeded");
    expect(verboseStdoutParsed.result).toEqual({
      res1: "no-import-result",
      res2: "legacy-result"
    });

    // In non-verbose mode:
    let nonVerboseStdoutParsed: any;
    expect(() => {
      nonVerboseStdoutParsed = JSON.parse(nonVerboseRunResult.stdout.trim());
    }).not.toThrow();
    expect(nonVerboseStdoutParsed.status).toBe("succeeded");
    expect(nonVerboseStdoutParsed.result).toEqual({
      res1: "no-import-result",
      res2: "legacy-result"
    });

    // Assert that globals.d.ts was not modified
    expect(validateResult.status).toBe(0);
    const finalGlobalsContent = await fs.readFile(globalsDtsPath, "utf8");
    expect(finalGlobalsContent).toBe(initialGlobalsContent);
  }, 20_000);

  afterAll(async () => {
    if (tempDir && existsSync(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
