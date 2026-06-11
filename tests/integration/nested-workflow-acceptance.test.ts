import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-nested-acceptance");

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

describe("Nested Workflow Acceptance Integration", () => {
  let configPath: string;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    
    configPath = path.join(TEMP_DIR, "test-config.json");
    const testConfig = {
      workflow: {
        discovery: {
          include: [
            "tests/fixtures/workflows/nested/*.workflow.js",
            "tests/fixtures/workflows/nested-acceptance/*.workflow.js"
          ]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(testConfig));
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("openflow validate succeeds for a root with a valid child workflow", async () => {
    const workflowPath = "tests/fixtures/workflows/nested-acceptance/valid-root.workflow.js";
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Workflow is valid");
  });

  it("openflow validate rejects duplicate workflow definitions", async () => {
    // Override config to include duplicates
    const dupConfigPath = path.join(TEMP_DIR, "dup-config.json");
    await fs.writeFile(dupConfigPath, JSON.stringify({
      workflow: {
        discovery: {
          include: ["tests/fixtures/workflows/nested-duplicates-isolated/*.workflow.js"]
        }
      }
    }));

    const workflowPath = "tests/fixtures/workflows/nested-acceptance/valid-root.workflow.js";
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", dupConfigPath
    ]);

    expect(result.error).not.toBeNull();
    expect(result.error.code).toBe("WORKFLOW_DUPLICATE_DEFINITION");
    expect(result.error.message).toContain("Duplicate workflow name 'dup'");
    expect(result.error.message).toContain("a.workflow.js");
    expect(result.error.message).toContain("b.workflow.js");
  });

  it("openflow validate rejects missing statically referenced child", async () => {
    const workflowPath = "tests/fixtures/workflows/nested-acceptance/invalid/missing-child-root.invalid";
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath
    ]);

    expect(result.error).not.toBeNull();
    expect(result.error.message).toContain("Workflow 'no-such-child' was not found in the registry");
  });

  it("openflow validate rejects static schema-invalid args", async () => {
    const workflowPath = "tests/fixtures/workflows/nested-acceptance/invalid/invalid-args-root.invalid";
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath
    ]);

    expect(result.error).not.toBeNull();
    expect(result.error.message).toContain("Workflow 'child-echo' input validation failed");
    expect(result.error.message).toContain("must be string at /target");
  });

  it("openflow validate keeps arbitrary imports rejected", async () => {
    const workflowPath = "tests/fixtures/workflows/nested-acceptance/invalid/imports.invalid";
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath
    ]);

    expect(result.error).not.toBeNull();
    expect(result.error.message).toContain("Arbitrary imports are not allowed");
  });
});
