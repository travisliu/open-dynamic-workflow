import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { vi } from "vitest";

const TEMP_DIR = path.resolve("tests/temp-run-by-name-acceptance");
const CONFIG_PATH = path.resolve("tests/fixtures/config/run-by-name.config.yaml");

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
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
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
    if (err instanceof Error && stderrData.length === 0 && !err.message.includes("process.exit")) {
      stderrData.push(err.message);
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Acceptance - Run Workflow by Name", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("AT-01: Name run succeeds", async () => {
    // Arrange & Act
    const result = await runCli([
      "run",
      "review",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    // Assert
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("◇ review");
    expect(result.stdout).toContain("tests/fixtures/workflows/run-by-name/review.workflow.js");
  });

  it("AT-02: Path run remains compatible", async () => {
    // Act - relative path with extension
    const resultRel = await runCli([
      "run",
      "tests/fixtures/workflows/run-by-name/explicit-path.workflow.js",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);
    expect(resultRel.error).toBeNull();
    const reportRel = JSON.parse(resultRel.stdout);
    expect(reportRel.workflow.targetKind).toBe("workflow-file");

    // Act - explicit relative path
    const resultExplicit = await runCli([
      "run",
      "./tests/fixtures/workflows/run-by-name/explicit-path.workflow.js",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);
    expect(resultExplicit.error).toBeNull();
    const reportExplicit = JSON.parse(resultExplicit.stdout);
    expect(reportExplicit.workflow.targetKind).toBe("workflow-file");
  });

  it("AT-05: Exact case-sensitive matching", async () => {
    // Act - lower case
    const resultLower = await runCli([
      "run",
      "review",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR
    ]);
    expect(resultLower.error).toBeNull();
    expect(resultLower.stdout).toContain("tests/fixtures/workflows/run-by-name/review.workflow.js");

    // Act - Pascal case
    const resultUpper = await runCli([
      "run",
      "Review",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR
    ]);
    expect(resultUpper.error).toBeNull();
    expect(resultUpper.stdout).toContain("tests/fixtures/workflows/run-by-name/case-review.workflow.js");

    // Act - SCREAMING case (should fail to match name and fall back to file, which doesn't exist)
    const resultScreaming = await runCli([
      "run",
      "REVIEW",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR
    ]);
    expect(resultScreaming.error).toBeDefined();
    expect(resultScreaming.stderr).toContain("not found");
  });

  it("AT-06: Bare fallback to file path", async () => {
    // 1. Arrange: Create a workflow file WITHOUT extension
    const fallbackFile = path.join(TEMP_DIR, "fallback-workflow-file");
    await fs.writeFile(fallbackFile, `
export const meta = { name: "actual-name", description: "d" };
await agent({ id: "a1", provider: "mock", prompt: "p" });
`);
    // Create the configured discovery directory under TEMP_DIR so name discovery succeeds (with 0 matches) instead of failing.
    const discoveryDir = path.join(TEMP_DIR, "tests/fixtures/workflows/run-by-name");
    await fs.mkdir(discoveryDir, { recursive: true });

    // 2. Act: Run by the bare filename
    const result = await runCli([
      "run",
      "fallback-workflow-file",
      "--cwd",
      TEMP_DIR,
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // 3. Assert: Resolved as workflow-file via fallback
    expect(result.error).toBeNull();
    const report = JSON.parse(result.stdout);
    expect(report.workflow.targetKind).toBe("workflow-file");
    expect(report.workflow.name).toBe("actual-name");
    expect(report.workflow.file).toContain("fallback-workflow-file");
  });

  it("AT-06: Bare name takes precedence over file fallback", async () => {
    // 1. Arrange: Create a file named 'review' (no extension) in CWD
    // and we know there's a workflow NAME 'review' in discovery scope.
    const fakeFile = path.resolve("review");
    await fs.writeFile(fakeFile, "not a workflow");

    try {
      // 2. Act: Run 'review'
      const result = await runCli([
        "run",
        "review",
        "--config",
        CONFIG_PATH,
        "--out",
        TEMP_DIR,
        "--report",
        "json"
      ]);

      // 3. Assert: It should resolve to the workflow NAME 'review', not the file 'review'
      expect(result.error).toBeNull();
      const report = JSON.parse(result.stdout);
      expect(report.workflow.targetKind).toBe("workflow-name");
      expect(report.workflow.file).toContain("review.workflow.js");
    } finally {
      await fs.rm(fakeFile, { force: true });
    }
  });

  it("AT-10: Target not found (name and file fallback)", async () => {
    // Act
    const result = await runCli([
      "run",
      "missing-workflow",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR
    ]);

    // Assert
    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("missing-workflow");
    expect(result.stderr).toContain("not found by name or file path");
    expect(result.stderr).toContain("open-dynamic-workflow list workflows");
  });

  it("AT-11: Config and cwd discovery scope", async () => {
    // 1. Create a minimal config that DOES NOT include the fixtures
    const narrowConfigPath = path.join(TEMP_DIR, "narrow.config.yaml");
    await fs.writeFile(narrowConfigPath, `
defaultProvider: mock
workflow:
  discovery:
    include: ["non-existent-dir/*.js"]
`);

    // 2. Try to run 'review' with narrow config
    const result = await runCli([
      "run",
      "review",
      "--config",
      narrowConfigPath,
      "--out",
      TEMP_DIR
    ]);

    // 3. Assert failure because 'review' is not in discovery scope
    expect(result.error).toBeDefined();
    expect(result.stderr).toContain("not found");
  });

  it("AT-13: Static discovery does not execute modules", async () => {
    // 1. Setup a fixture that throws at top level
    const throwFixture = path.join(TEMP_DIR, "throw-if-executed.workflow.js");
    await fs.writeFile(throwFixture, `
export const meta = { name: "throw-test", description: "throws" };
throw new Error("EXECUTED_AT_TOP_LEVEL");
`);

    const customConfigPath = path.join(TEMP_DIR, "custom.config.yaml");
    await fs.writeFile(customConfigPath, `
defaultProvider: mock
workflow:
  discovery:
    include: ["${path.relative(process.cwd(), TEMP_DIR)}/*.js"]
`);

    // 2. Validate by name - should NOT throw because it uses static discovery
    const validateResult = await runCli([
      "validate",
      "throw-test",
      "--config",
      customConfigPath
    ]);
    expect(validateResult.error).toBeNull();
    expect(validateResult.stdout).toContain("throw-test");

    // 3. Run by name - should throw because it executes the workflow
    const runResult = await runCli([
      "run",
      "throw-test",
      "--config",
      customConfigPath,
      "--out",
      TEMP_DIR
    ]);
    expect(runResult.error).toBeDefined();
    expect(runResult.stderr).toContain("EXECUTED_AT_TOP_LEVEL");
  });

  it("AT-18: Pretty reporter resolution line", async () => {
    // Act
    const result = await runCli([
      "run",
      "review",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    // Assert
    expect(result.error).toBeNull();
    // Check for "file:" line that identifies the file
    expect(result.stdout).toContain("tests/fixtures/workflows/run-by-name/review.workflow.js");
    expect(result.stdout).toContain("file: ");
  });

  it("AT-21: Resume does not re-resolve moved name", async () => {
    // 1. Arrange: Initial run by name
    const initialResult = await runCli([
      "run",
      "review",
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);
    expect(initialResult.error).toBeNull();
    const initialReport = JSON.parse(initialResult.stdout);
    const runId = initialReport.runId;
    const originalFile = initialReport.workflow.file;

    // 2. Arrange: Add a NEW file with the same meta.name "review"
    const newFile = path.join(TEMP_DIR, "another-review.workflow.js");
    await fs.writeFile(newFile, `
export const meta = { name: "review", description: "another" };
await agent({ id: "a1", provider: "mock", prompt: "p" });
`);

    // 3. Act: Resume the original run
    const resumeResult = await runCli([
      "resume",
      runId,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // 4. Assert: Resume succeeds and uses the ORIGINAL file
    expect(resumeResult.error).toBeNull();
    const resumeReport = JSON.parse(resumeResult.stdout);
    expect(resumeReport.workflow.file).toBe(originalFile);
    expect(resumeReport.workflow.file).not.toBe(newFile);
  });
});
