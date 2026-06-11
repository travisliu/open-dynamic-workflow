import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-nested-cancellation");

async function runCliWithTimeout(args: string[]) {
  // We can't easily send SIGINT to main() in same process, 
  // so we'll use --timeout-ms to trigger internal cancellation.
  try {
    await main(["node", "openflow", ...args]);
  } catch (err) {
    return err;
  }
  return null;
}

describe("Nested Workflow Cancellation", () => {
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

  it("Propagates cancellation to child workflows", async () => {
    // Create a slow child
    const slowChildPath = path.join(TEMP_DIR, "slow-child.workflow.js");
    await fs.writeFile(slowChildPath, `
      export const meta = { 
        name: "slow-child",
        description: "A slow child workflow"
      };
      export default async ({ signal }) => {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          if (signal.aborted) {
            clearTimeout(t);
            reject(signal.reason);
          }
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(signal.reason);
          });
        });
        return "finished";
      };
    `);

    const parentPath = path.join(TEMP_DIR, "parent-cancel.workflow.js");
    await fs.writeFile(parentPath, `
      export const meta = { 
        name: "parent-cancel",
        description: "Parent that calls slow child"
      };
      export default async ({ workflow }) => {
        return await workflow({ name: "slow-child" });
      };
    `);

    // Update config to include these temp workflows
    const testConfig = {
      workflow: {
        discovery: {
          include: [path.join(TEMP_DIR, "*.workflow.js")]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(testConfig));

    const error: any = await runCliWithTimeout([
      "run",
      parentPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--timeout-ms", "100" // Short timeout to trigger cancellation
    ]);

    expect(error).toBeDefined();
    // It might be WORKFLOW_TIMEOUT or USER_CANCELLED depending on how it's handled
    expect(["WORKFLOW_TIMEOUT", "PROCESS_TIMEOUT", "USER_CANCELLED"]).toContain(error.code);
  });

  it("Short-circuits child call if parent is already aborted (via timeout)", async () => {
    const parentPath = path.join(TEMP_DIR, "parent-short-circuit.workflow.js");
    
    await fs.writeFile(parentPath, `
      export const meta = { 
        name: "parent-short-circuit",
        description: "Parent that waits to be cancelled, then calls missing child"
      };
      export default async ({ signal, workflow }) => {
        try {
          // Wait to be cancelled by timeout
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 5000);
            signal.addEventListener("abort", () => {
              clearTimeout(t);
              resolve();
            });
          });
        } finally {
          // This will be called after timeout triggers abort
          if (signal.aborted) {
            // Use dynamic name to bypass static validation
            const dynamicName = "missing" + "-child";
            await workflow({ name: dynamicName });
          }
        }
      };
    `);

    // Update config to include these temp workflows
    const testConfig = {
      workflow: {
        discovery: {
          include: [path.join(TEMP_DIR, "*.workflow.js")]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(testConfig));

    const error: any = await runCliWithTimeout([
      "run",
      parentPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--timeout-ms", "200"
    ]);

    expect(error).toBeDefined();
    // It should NOT be WORKFLOW_DEFINITION_NOT_FOUND or WORKFLOW_VALIDATION_ERROR
    expect(error.code).not.toBe("WORKFLOW_DEFINITION_NOT_FOUND");
    expect(error.code).not.toBe("WORKFLOW_VALIDATION_ERROR");
    
    // It should be WORKFLOW_TIMEOUT or similar
    expect(["PROCESS_TIMEOUT", "WORKFLOW_TIMEOUT", "USER_CANCELLED", "WORKFLOW_CANCELLED"]).toContain(error.code);

    // Verify artifacts: no child invocation should have started
    const entries = await fs.readdir(TEMP_DIR, { withFileTypes: true });
    const runDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    expect(runDirs.length).toBe(1);
    
    const eventsPath = path.join(TEMP_DIR, runDirs[0], "events.jsonl");
    const eventsContent = await fs.readFile(eventsPath, "utf-8");
    const events = eventsContent.trim().split("\n").map(line => JSON.parse(line));
    
    const childStartedEvent = events.find(e => 
      e.type === "workflow.invocation.started" && 
      e.payload.workflowName === "missing-child"
    );
    
    expect(childStartedEvent).toBeUndefined();
  });
});
