import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "../../src/cli/index.js";

interface CliResult {
  stdout: string;
  stderr: string;
  error: unknown;
}

interface ProjectFiles {
  configPath: string;
  workflowPath: string;
}

let projectDir: string;

async function invokeMain(args: string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdout.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderr.push(String(chunk));
    return true;
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    stdout.push(`${values.join(" ")}\n`);
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
    stderr.push(`${values.join(" ")}\n`);
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...values: unknown[]) => {
    stderr.push(`${values.join(" ")}\n`);
  });

  let error: unknown = null;
  try {
    await main(["node", "odw", ...args]);
  } catch (caught) {
    error = caught;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }

  return { stdout: stdout.join(""), stderr: stderr.join(""), error };
}

async function writeRunnableProject({ configYaml, workflowSource }: { configYaml: string; workflowSource?: string }): Promise<ProjectFiles> {
  const workflowPath = path.join(projectDir, "workflows", "acceptance.workflow.js");
  const configPath = path.join(projectDir, "odw.yaml");
  await fs.mkdir(path.dirname(workflowPath), { recursive: true });
  await fs.writeFile(workflowPath, workflowSource ?? `
export const meta = { name: "outdir-acceptance", description: "outDir CLI acceptance workflow" };
export default async () => agent({ id: "stable-agent", prompt: "hello" });
`);
  await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  mock:
    command: mock
    responses:
      default:
        text: ok
workflow:
  discovery:
    include:
      - "workflows/**/*.js"
${configYaml}`);
  return { configPath, workflowPath };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function directChildDirectories(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function expectDisplayedPath(output: string, label: string, expected: string): void {
  expect(output).toContain(`${label}: ${path.resolve(expected)}`);
}

function commandArgs(command: string[], configPath: string): string[] {
  return [...command, "--cwd", projectDir, "--config", configPath];
}

describe("outDir configuration and read-only command acceptance", () => {
  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-outdir-command-acceptance-"));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("applies four-level outDir precedence with independent verbose provenance", async () => {
    // Arrange
    const { configPath } = await writeRunnableProject({ configYaml: `
outDir: global-runs
profiles:
  base:
    outDir: profile-runs
  child:
    extends: base
  fallthrough: {}
` });
    const cases = [
      { args: [], root: "global-runs", source: "config", profile: undefined },
      { args: ["--profile", "child"], root: "profile-runs", source: "profile", profile: "child" },
      { args: ["--profile", "fallthrough"], root: "global-runs", source: "config", profile: "fallthrough" },
      { args: ["--profile", "child", "--out", "cli-runs"], root: "cli-runs", source: "cli", profile: "child" },
    ];

    // Act
    const results: Array<{ testCase: typeof cases[number]; result: CliResult }> = [];
    for (const testCase of cases) {
      results.push({
        testCase,
        result: await invokeMain(commandArgs([
        "run", "workflows/acceptance.workflow.js", "--dry-run", "--verbose", ...testCase.args,
        ], configPath)),
      });
    }

    // Assert
    for (const { testCase, result } of results) {
      expect(result.error).toBeNull();
      expectDisplayedPath(result.stdout, "Artifacts root", path.join(projectDir, testCase.root));
      expect(result.stdout).toContain(`Output-root source: ${testCase.source}`);
      if (testCase.profile) {
        expect(result.stdout).toContain(`Selected profile: ${testCase.profile}`);
      } else {
        expect(result.stdout).not.toContain("Selected profile:");
      }
    }
    for (const root of ["global-runs", "profile-runs", "cli-runs"]) {
      const candidate = path.join(projectDir, root);
      expect(await pathExists(candidate)).toBe(false);
      expect(await directChildDirectories(candidate)).toEqual([]);
    }
  });

  it("uses the built-in root and preserves literal CLI path segments", async () => {
    // Arrange
    const { configPath } = await writeRunnableProject({ configYaml: "" });
    const defaultRoot = path.join(projectDir, ".open-dynamic-workflow", "runs");
    const literalValues = ["~/runs", "$ODW_ROOT/runs", "%ODW_ROOT%/runs", "nested/./child/../literal-runs"];
    const previousOdwRoot = process.env.ODW_ROOT;
    process.env.ODW_ROOT = "must-not-expand";

    try {
      // Act
      const builtIn = await invokeMain(commandArgs([
        "run", "workflows/acceptance.workflow.js", "--dry-run", "--verbose",
      ], configPath));
      const literalResults: Array<{ rawValue: string; result: CliResult }> = [];
      for (const rawValue of literalValues) {
        literalResults.push({
          rawValue,
          result: await invokeMain(commandArgs([
          "run", "workflows/acceptance.workflow.js", "--dry-run", "--verbose", "--out", rawValue,
          ], configPath)),
        });
      }

      // Assert
      expect(builtIn.error).toBeNull();
      expectDisplayedPath(builtIn.stdout, "Artifacts root", defaultRoot);
      expect(builtIn.stdout).toContain("Output-root source: built-in-default");
      expect(await pathExists(defaultRoot)).toBe(false);
      for (const { rawValue, result } of literalResults) {
        const expectedRoot = path.resolve(projectDir, rawValue);
        expect(result.error).toBeNull();
        expectDisplayedPath(result.stdout, "Artifacts root", expectedRoot);
        expect(result.stdout).toContain("Output-root source: cli");
        expect(await pathExists(expectedRoot)).toBe(false);
      }
    } finally {
      if (previousOdwRoot === undefined) delete process.env.ODW_ROOT;
      else process.env.ODW_ROOT = previousOdwRoot;
    }
  });

  it.each([
    {
      name: "whitespace global outDir",
      configYaml: "outDir: '   '\n",
      fieldPath: "outDir",
      candidate: "   ",
    },
    {
      name: "non-string profile outDir",
      configYaml: "profiles:\n  bad:\n    outDir: 42\n",
      fieldPath: "profiles.bad.outDir",
      candidate: "profile-runs",
    },
  ])("fails invalid $name before creating an output root", async ({ configYaml, fieldPath, candidate }) => {
    // Arrange
    const { configPath } = await writeRunnableProject({ configYaml });
    const defaultRoot = path.join(projectDir, ".open-dynamic-workflow", "runs");
    const configuredCandidate = path.resolve(projectDir, candidate);

    // Act
    const result = await invokeMain(commandArgs([
      "run", "workflows/acceptance.workflow.js", "--dry-run", "--verbose",
    ], configPath));

    // Assert
    expect(result.error).toMatchObject({ code: "CONFIG_VALIDATION_ERROR" });
    expect(String((result.error as Error).message)).toContain(fieldPath);
    expect(await pathExists(configuredCandidate)).toBe(false);
    expect(await pathExists(defaultRoot)).toBe(false);
  });

  it("rejects a missing explicit resume profile before run lookup or artifact creation", async () => {
    // Arrange
    const { configPath } = await writeRunnableProject({ configYaml: "outDir: configured-runs\n" });
    const configuredRoot = path.join(projectDir, "configured-runs");
    const legacyRoot = path.join(projectDir, ".open-dynamic-workflow", "runs");

    // Act
    const result = await invokeMain(commandArgs([
      "resume", "missing-run", "--profile", "missing",
    ], configPath));

    // Assert
    expect(result.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(String((result.error as Error).message)).toContain("missing");
    expect(await pathExists(configuredRoot)).toBe(false);
    expect(await pathExists(legacyRoot)).toBe(false);
  });

  it.each([
    { name: "run dry-run", command: ["run", "workflows/acceptance.workflow.js", "--dry-run", "--verbose"] },
    { name: "validate", command: ["validate", "workflows/acceptance.workflow.js"] },
    { name: "list", command: ["list"] },
  ])("keeps a missing configured root absent for successful $name", async ({ name, command }) => {
    // Arrange
    const { configPath } = await writeRunnableProject({ configYaml: "outDir: read-only-runs\n" });
    const configuredRoot = path.join(projectDir, "read-only-runs");

    // Act
    const result = await invokeMain(commandArgs(command, configPath));

    // Assert
    expect(result.error).toBeNull();
    if (name === "run dry-run") {
      expectDisplayedPath(result.stdout, "Artifacts root", configuredRoot);
      expect(result.stdout).toContain("Output-root source: config");
    }
    expect(await pathExists(configuredRoot)).toBe(false);
  });
});
