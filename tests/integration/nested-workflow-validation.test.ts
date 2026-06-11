import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-nested-validation");

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

describe("Nested Workflow Validation", () => {
  let configPath: string;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    
    configPath = path.join(TEMP_DIR, "test-config.json");
    const testConfig = {
      workflow: {
        discovery: {
          include: ["tests/fixtures/workflows/nested/*.workflow.js"]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(testConfig));
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Detects active recursion in nested workflows", async () => {
    const recursionConfigPath = path.join(TEMP_DIR, "recursion-config.json");
    const recursionConfig = {
      workflow: {
        discovery: {
          include: [
            "tests/fixtures/workflows/nested/*.workflow.js",
            "tests/fixtures/workflows/recursion/*.workflow.js"
          ]
        }
      }
    };
    await fs.writeFile(recursionConfigPath, JSON.stringify(recursionConfig));

    const workflowPath = "tests/fixtures/workflows/recursion/parent-recursion-a.workflow.js";
    const result = await runCli([
      "run",
      workflowPath,
      "--config", recursionConfigPath,
      "--out", TEMP_DIR
    ]);

    expect(result.error).not.toBeNull();
    expect(result.error.message).toContain("Static recursion cycle detected");
  });

  it("Validates child input schema and records failure", async () => {
    const workflowPath = "tests/fixtures/workflows/nested/parent-invalid-args.workflow.js";
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--arg", "invalidCount=not-a-number"
    ]);

    expect(result.error).not.toBeNull();
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("WORKFLOW_INPUT_VALIDATION_FAILED");
    
    // Should have invocation summary for failed child
    expect(report.workflows).toHaveLength(2); // parent-invalid-args and child-schema
    const childSummary = report.workflows.find((w: any) => w.workflowName === "child-schema");
    expect(childSummary.status).toBe("failed");
  });

  it("Enforces maximum workflow depth", async () => {
    // Create a special config with low maxDepth
    const depthConfigPath = path.join(TEMP_DIR, "depth-config.json");
    const depthConfig = {
      workflow: {
        maxDepth: 1, // depth 0 (root) -> depth 1 (child) OK, depth 2 FAIL
        discovery: {
          include: ["tests/fixtures/workflows/nested-validation-isolated/*.workflow.js"]
        }
      }
    };
    await fs.writeFile(depthConfigPath, JSON.stringify(depthConfig));

    const workflowPath = "tests/fixtures/workflows/nested-validation-isolated/depth-1.workflow.js";
    const result = await runCli([
      "run",
      workflowPath,
      "--config", depthConfigPath,
      "--out", TEMP_DIR
    ]);

    expect(result.error).not.toBeNull();
    expect(result.error.message).toContain("Maximum workflow depth of 1 exceeded");
  });
});
