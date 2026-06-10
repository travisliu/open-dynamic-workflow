import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-dynamic-workflows");
const FIXTURE_DIR = path.resolve("tests/fixtures/dynamic-workflows");

async function runCli(args: string[]) {
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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

  return { error };
}

describe("dynamic workflow fixtures", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("validates all curated dynamic workflow fixtures", async () => {
    const files = (await fs.readdir(FIXTURE_DIR))
      .filter((file) => file.endsWith(".workflow.js"))
      .sort();

    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const result = await runCli(["validate", path.join(FIXTURE_DIR, file)]);
      expect(result.error).toBeNull();
    }
  });

  it("runs representative fixtures with the mock provider", async () => {
    for (const file of ["review-changes.workflow.js", "migration-pipeline.workflow.js", "judge-panel.workflow.js"]) {
      const result = await runCli([
        "run",
        path.join(FIXTURE_DIR, file),
        "--provider",
        "mock",
        "--out",
        path.join(TEMP_DIR, file)
      ]);
      expect(result.error).toBeNull();
    }
  });
});
