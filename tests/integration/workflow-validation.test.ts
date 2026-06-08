import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { exitCodeForError } from "../../src/errors/exit-codes.js";
import { parseWorkflow } from "../../src/workflow/parse.js";

const TEMP_DIR = path.resolve("tests/temp-tc-01");

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
    await main(["node", "openflow", ...args]);
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

describe("Workflow Validation", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Missing metadata fails validation", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-missing-meta.workflow.js");
    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(3);
    
    // Error code is WORKFLOW_VALIDATION_ERROR or WORKFLOW_PARSE_ERROR.
    expect(["WORKFLOW_VALIDATION_ERROR", "WORKFLOW_PARSE_ERROR"]).toContain(result.error.code);

    // Error message explains that metadata is required.
    expect(result.error.message).toMatch(/metadata/i);
  });

  it("Metadata not first statement fails validation", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-meta-not-first.js");
    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(3);
    
    expect(result.error.code).toBe("WORKFLOW_PARSE_ERROR");

    // Error message explains that meta must be the first top-level statement.
    expect(result.error.message).toMatch(/must be the first top-level statement/i);
  });

  it("Dynamic metadata fails validation", async () => {
    const workflowContent = `const name = "dynamic";
export const meta = {
  name,
  description: "Invalid dynamic metadata"
};
export default {};
`;
    const workflowPath = path.join(TEMP_DIR, "dynamic-meta.workflow.js");
    await fs.writeFile(workflowPath, workflowContent);

    expect(() => parseWorkflow({
      sourcePath: "dynamic-meta.workflow.js",
      sourceText: workflowContent
    })).toThrow(/statically analyzable|first top-level statement/);

    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(3);
    
    // Error explains that metadata must be statically analyzable
    expect(result.error.message).toMatch(/statically analyzable|first top-level statement|literal/i);
  });

  it("Restricted require() fails validation", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-require.js");
    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    // CLI exits with code 3 or 5
    expect([3, 5]).toContain(exitCode);
    
    // Error includes a stable code such as WORKFLOW_VALIDATION_ERROR or SECURITY_POLICY_VIOLATION.
    expect(["WORKFLOW_VALIDATION_ERROR", "SECURITY_POLICY_VIOLATION"]).toContain(result.error.code);

    // Error message identifies require() as unsupported.
    expect(result.error.message).toMatch(/require\(\)/);
  });

  it("Unsupported pipeline() fails validation due to function shorthand", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-pipeline.js");
    
    // Act
    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    // Assert
    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    
    // CLI exits with code 3.
    expect(exitCode).toBe(3);
    
    // Error explains that function shorthand is not supported.
    expect(result.error.message).toMatch(/stages must be named stage objects/);
  });

  it("Valid dangerously-full-access permissions passes validation", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/dangerously-full-access-valid.workflow.js");
    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeNull();
  });

  it("Invalid permissions mode fails validation with exit code 3", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/dangerously-full-access-invalid-mode.workflow.js");
    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(3);
    expect(result.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
    expect(result.error.message).toMatch(/agent\(\) permissions\.mode must be 'dangerously-full-access'/);
  });

  it("Invalid permissions extra key fails validation with exit code 3", async () => {
    const workflowPath = path.resolve("tests/fixtures/workflows/dangerously-full-access-extra-key.workflow.js");
    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(3);
    expect(result.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
    expect(result.error.message).toMatch(/agent\(\) permissions contain unsupported key 'approval'/);
  });

  it("permissions: {} fails validation with exit code 3 (AC-04)", async () => {
    const workflowContent = `export const meta = { name: "test", description: "test" };
await agent({ prompt: "test", permissions: {} });
export default {};
`;
    const workflowPath = path.join(TEMP_DIR, "perm-empty-obj.workflow.js");
    await fs.writeFile(workflowPath, workflowContent);

    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(3);
    expect(result.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
    expect(result.error.message).toMatch(/agent\(\) permissions must include a 'mode' property/);
  });

  it("permissions: 'dangerously-full-access' fails validation with exit code 3 (AC-04)", async () => {
    const workflowContent = `export const meta = { name: "test", description: "test" };
await agent({ prompt: "test", permissions: "dangerously-full-access" });
export default {};
`;
    const workflowPath = path.join(TEMP_DIR, "perm-string.workflow.js");
    await fs.writeFile(workflowPath, workflowContent);

    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(3);
    expect(result.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
    expect(result.error.message).toMatch(/agent\(\) permissions must be an object literal/);
  });

  it("permissions: { mode: 123 } fails validation with exit code 3 (AC-04)", async () => {
    const workflowContent = `export const meta = { name: "test", description: "test" };
await agent({ prompt: "test", permissions: { mode: 123 } });
export default {};
`;
    const workflowPath = path.join(TEMP_DIR, "perm-invalid-mode-type.workflow.js");
    await fs.writeFile(workflowPath, workflowContent);

    const result = await runCli([
      "validate",
      workflowPath,
      "--cwd",
      TEMP_DIR
    ]);

    expect(result.error).toBeDefined();
    const exitCode = exitCodeForError(result.error);
    expect(exitCode).toBe(3);
    expect(result.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
    expect(result.error.message).toMatch(/agent\(\) permissions\.mode must be a string literal/);
  });
});
