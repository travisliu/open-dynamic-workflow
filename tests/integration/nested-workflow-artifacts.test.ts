import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-nested-artifacts");

async function runCli(args: string[]) {
  try {
    await main(["node", "openflow", ...args]);
  } catch (err) {
    // Ignore CLI errors in this helper
  }
}

describe("Nested Workflow Artifacts", () => {
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

  it("Writes correct artifact tree for nested run", async () => {
    const workflowPath = "tests/fixtures/workflows/nested/parent-basic.workflow.js";
    
    await runCli([
      "run",
      workflowPath,
      "--provider", "mock",
      "--config", configPath,
      "--out", TEMP_DIR,
      "--arg", "message=artifact-test"
    ]);

    const runs = (await fs.readdir(TEMP_DIR)).filter(d => d !== "test-config.json");
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const workflowsDir = path.join(runDir, "workflows");

    // Should have directories for both invocations
    const workflowDirs = await fs.readdir(workflowsDir);
    expect(workflowDirs).toHaveLength(2);

    // Find child directory (one that is NOT the root runId)
    const runId = runs[0]!;
    const childDirName = workflowDirs.find(d => d !== runId.replace(/[^a-zA-Z0-9._:-]/g, "_"))!;
    const childDir = path.join(workflowsDir, childDirName);

    // Verify child artifacts
    const input = JSON.parse(await fs.readFile(path.join(childDir, "input.json"), "utf8"));
    const result = JSON.parse(await fs.readFile(path.join(childDir, "result.json"), "utf8"));
    const summary = JSON.parse(await fs.readFile(path.join(childDir, "summary.json"), "utf8"));

    expect(input.workflowName).toBe("child-basic");
    expect(input.args).toEqual({ message: "artifact-test" });
    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({ childEcho: "artifact-test" });
    expect(summary.status).toBe("succeeded");
    expect(summary.workflowInvocationId).toBeDefined();
    expect(summary.parentWorkflowInvocationId).toBe(runId);
  });
});
