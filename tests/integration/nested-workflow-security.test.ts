import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-nested-security");

async function runCli(args: string[]) {
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    return err;
  }
  return null;
}

describe("Nested Workflow Security", () => {
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

  it("Blocks child workflow files outside project root", async () => {
    const outsideDir = "/tmp/cadecli-security-test";
    await fs.mkdir(outsideDir, { recursive: true });
    const outsidePath = path.join(outsideDir, "outside.workflow.js");
    
    await fs.writeFile(outsidePath, `
      export const meta = { 
        name: "outside-wf",
        description: "Outside workflow"
      };
      export default {};
    `);

    const parentPath = path.join(TEMP_DIR, "parent-outside.workflow.js");
    await fs.writeFile(parentPath, `
      export const meta = {
        name: "parent-outside",
        description: "Calls outside workflow"
      };
      export default async ({ workflow }) => {
        return await workflow({ name: "outside-wf" });
      };
    `);

    // Update config to try and include the outside file
    const testConfig = {
      workflow: {
        discovery: {
          include: ["/tmp/cadecli-security-test/*.workflow.js"]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(testConfig));

    const error: any = await runCli([
      "run",
      parentPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--strict"
    ]);

    expect(error).toBeDefined();
    expect(error.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(error.message).toContain("CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN");
    
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("Blocks discovered child workflow files that are symlinks pointing outside project root", async () => {
    const outsideDir = path.join(TEMP_DIR, "../outside-security-test");
    await fs.mkdir(outsideDir, { recursive: true });
    const outsidePath = path.join(outsideDir, "outside.workflow.js");
    
    await fs.writeFile(outsidePath, `
      export const meta = { 
        name: "outside-wf",
        description: "Outside workflow"
      };
      export default {};
    `);

    // Create a symlink inside TEMP_DIR pointing to the outside workflow
    const symlinkPath = path.join(TEMP_DIR, "outside.workflow.js");
    await fs.symlink(outsidePath, symlinkPath, "file");

    const parentPath = path.join(TEMP_DIR, "parent-outside.workflow.js");
    await fs.writeFile(parentPath, `
      export const meta = {
        name: "parent-outside",
        description: "Calls outside workflow"
      };
      export default async ({ workflow }) => {
        return await workflow({ name: "outside-wf" });
      };
    `);

    // Update config to discover files in TEMP_DIR
    const testConfig = {
      workflow: {
        discovery: {
          include: ["*.workflow.js"]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(testConfig));

    const error: any = await runCli([
      "run",
      parentPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--cwd", TEMP_DIR,
      "--strict"
    ]);

    expect(error).toBeDefined();
    expect(error.code).toBe("SECURITY_POLICY_VIOLATION");
    expect(error.message).toContain("Workflow file outside project root");
    
    await fs.rm(outsideDir, { recursive: true, force: true });
  });
});
