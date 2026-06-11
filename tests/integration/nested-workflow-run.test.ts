import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-nested-run");

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

describe("Nested Workflow Run", () => {
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

  it("Parent-child success run shows correct events and report", async () => {
    const workflowPath = "tests/fixtures/workflows/nested/parent-basic.workflow.js";
    
    const result = await runCli([
      "run",
      workflowPath,
      "--provider", "mock",
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl",
      "--arg", "message=test message"
    ]);

    if (result.error) {
      throw result.error;
    }
    expect(result.error).toBeNull();

    const lines = result.stdout.split("\n").filter(line => line.trim().length > 0);
    const events = lines.map(line => JSON.parse(line));

    // Verify invocation events
    const invocationStarted = events.filter(e => e.type === "workflow.invocation.started");
    const invocationCompleted = events.filter(e => e.type === "workflow.invocation.completed");

    expect(invocationStarted).toHaveLength(2); // root and child
    expect(invocationCompleted).toHaveLength(2); // root and child

    const childStart = invocationStarted.find((e: any) => e.payload.workflowName === "child-basic");
    const rootStart = invocationStarted.find((e: any) => e.payload.workflowName === "parent-basic");

    expect(childStart).toBeDefined();
    expect(rootStart).toBeDefined();
    expect(childStart.payload.depth).toBe(1);
    expect(rootStart.payload.depth).toBe(0);
    expect(childStart.payload.parentWorkflowInvocationId).toBe(rootStart.payload.workflowInvocationId);

    // Verify report
    const runs = (await fs.readdir(TEMP_DIR)).filter(d => d !== "test-config.json");
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    expect(report.status).toBe("succeeded");
    expect(report.workflows).toHaveLength(2);

    const rootSummary = report.workflows.find((w: any) => w.workflowName === "parent-basic");
    const childSummary = report.workflows.find((w: any) => w.workflowName === "child-basic");

    expect(rootSummary.status).toBe("succeeded");
    expect(childSummary.status).toBe("succeeded");
    expect(childSummary.depth).toBe(1);
    expect(childSummary.parentWorkflowInvocationId).toBe(rootSummary.workflowInvocationId);
    
    // Check artifacts
    const childArtifactDir = path.join(runDir, childSummary.artifactPath);
    expect(await fs.stat(path.join(childArtifactDir, "input.json"))).toBeDefined();
    expect(await fs.stat(path.join(childArtifactDir, "result.json"))).toBeDefined();
    expect(await fs.stat(path.join(childArtifactDir, "summary.json"))).toBeDefined();
    
    const childInput = JSON.parse(await fs.readFile(path.join(childArtifactDir, "input.json"), "utf8"));
    expect(childInput.args).toEqual({ message: "test message" });
  });

  it("Parent handles settled child failure", async () => {
    const workflowPath = "tests/fixtures/workflows/nested/parent-settled-failure.workflow.js";
    
    const result = await runCli([
      "run",
      workflowPath,
      "--provider", "mock",
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    if (result.error) {
      throw result.error;
    }
    expect(result.error).toBeNull();
    const report = JSON.parse(result.stdout);

    expect(report.status).toBe("succeeded"); // Parent succeeds because it uses failureMode: settled
    expect(report.workflows).toHaveLength(2);

    const childSummary = report.workflows.find((w: any) => w.workflowName === "child-failure");
    expect(childSummary.status).toBe("failed");
    expect(childSummary.error.message).toBe("intentional child failure");
  });

  it("Detects active recursion", async () => {
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

  it("Validates child input schema", async () => {
    const workflowPath = "tests/fixtures/workflows/nested/parent-invalid-args.workflow.js";
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--arg", "invalidCount=not-a-number"
    ]);

    // Parent should fail
    expect(result.error).not.toBeNull();
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("WORKFLOW_INPUT_VALIDATION_FAILED");
    
    // Should have invocation summary for failed child
    expect(report.workflows).toHaveLength(2); // parent-invalid-args and child-schema
    const childSummary = report.workflows.find((w: any) => w.workflowName === "child-schema");
    expect(childSummary.status).toBe("failed");
  });

  it("Fails invocation if a child workflow returns undefined or an object containing undefined", async () => {
    // Write a child workflow that returns an object containing undefined
    const childPath = path.join(TEMP_DIR, "child-undefined.workflow.js");
    await fs.writeFile(childPath, `
export const meta = { name: "child-undefined", description: "child" };
export default async () => {
  return { value: undefined };
};
    `);

    // Write a parent workflow that calls the child workflow
    const parentPath = path.join(TEMP_DIR, "parent-undefined.workflow.js");
    await fs.writeFile(parentPath, `
export const meta = { name: "parent-undefined", description: "parent" };
export default async () => {
  return await workflow({ name: "child-undefined" });
};
    `);

    // Update config to discover both workflows in TEMP_DIR
    const customConfigPath = path.join(TEMP_DIR, "custom-config.json");
    const customConfig = {
      workflow: {
        discovery: {
          include: [
            "."
          ]
        }
      }
    };
    await fs.writeFile(customConfigPath, JSON.stringify(customConfig));

    const result = await runCli([
      "run",
      parentPath,
      "--config", customConfigPath,
      "--out", TEMP_DIR,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).not.toBeNull();
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("WORKFLOW_RESULT_SERIALIZATION_FAILED");
  });
});
