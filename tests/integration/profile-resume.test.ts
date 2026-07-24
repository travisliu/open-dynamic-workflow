import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-profile-resume");

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
    await main(["node", "open-dynamic-workflow", ...args]);
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

describe("Profile resume integration tests", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("requires the recorded profile name to remain available for standalone resume", async () => {
    const profilesPath = path.join(TEMP_DIR, "profiles.yaml");
    await fs.writeFile(
      profilesPath,
      `
profiles:
  test:
    args:
      val: "my-arg"
    context:
      myCtx: "my-context-value"
    run:
      concurrency: 4
`,
      "utf8"
    );

    const workflowPath = "tests/fixtures/workflows/mock-success.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";

    // 1. Run with profile
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--profiles",
      profilesPath,
      "--profile",
      "test",
      "--out",
      TEMP_DIR
    ]);

    expect(result1.error).toBeNull();

    const runsAfterRun1 = (await fs.readdir(TEMP_DIR)).filter(r => r !== "profiles.yaml");
    expect(runsAfterRun1.length).toBe(1);
    const runId1 = runsAfterRun1[0]!;

    // 2. Modify and delete the profiles file
    await fs.writeFile(profilesPath, "corrupted content", "utf8");
    await fs.unlink(profilesPath);

    // 3. Standalone resume fails closed because the recorded name cannot be
    // resolved from the current catalog.
    const resultResume = await runCli([
      "resume",
      runId1,
      "--out",
      TEMP_DIR
    ]);

    expect(resultResume.error).toMatchObject({ code: "CLI_USAGE_ERROR" });

    // 4. run --resume uses the previous run only for cache input.
    const resultRunResume = await runCli([
      "run",
      workflowPath,
      "--resume",
      runId1,
      "--out",
      TEMP_DIR
    ]);

    expect(resultRunResume.error).toBeNull();

    const runsAfterRunResume = (await fs.readdir(TEMP_DIR)).filter(r => r !== "profiles.yaml");
    expect(runsAfterRunResume.length).toBe(2);
    const runId2 = runsAfterRunResume.find(r => r !== runId1)!;
    const runInput2 = JSON.parse(await fs.readFile(path.join(TEMP_DIR, runId2, "run-input.json"), "utf8"));
    expect(runInput2.profile).toBeUndefined();

    // 5. odw run --resume with explicit --profile override should try to resolve fresh profile
    // and fail because the profiles file is deleted.
    const resultOverride = await runCli([
      "run",
      workflowPath,
      "--resume",
      runId1,
      "--profile",
      "test",
      "--out",
      TEMP_DIR
    ]);

    expect(resultOverride.error).toBeDefined();
    expect(resultOverride.error.code).toBe("PROFILE_NOT_FOUND");
  });

  it("handles legacy no-profile artifact resume gracefully", async () => {
    const workflowPath = "tests/fixtures/workflows/mock-success.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";

    // 1. Run without profile
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR
    ]);
    expect(result1.error).toBeNull();

    const runs = (await fs.readdir(TEMP_DIR));
    expect(runs.length).toBe(1);
    const runId = runs[0]!;

    // 2. odw resume should succeed
    const resultResume = await runCli([
      "resume",
      runId,
      "--out",
      TEMP_DIR
    ]);
    expect(resultResume.error).toBeNull();
  });

  it("fails closed on corrupt/malformed present profile", async () => {
    const workflowPath = "tests/fixtures/workflows/mock-success.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";

    // 1. Run without profile to generate an artifact
    const result1 = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR
    ]);
    expect(result1.error).toBeNull();

    const runs = (await fs.readdir(TEMP_DIR));
    expect(runs.length).toBe(1);
    const runId = runs[0]!;

    // 2. Corrupt the run-input.json profile field
    const runInputPath = path.join(TEMP_DIR, runId, "run-input.json");
    const runInput = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    runInput.profile = {
      selected: "", // Invalid profile name
      source: "recorded",
      hash: "invalid-hash",
      resolved: {}
    };
    await fs.writeFile(runInputPath, JSON.stringify(runInput), "utf8");

    // 3. odw resume should fail before running the workflow
    const resultResume = await runCli([
      "resume",
      runId,
      "--out",
      TEMP_DIR
    ]);

    expect(resultResume.error).toBeDefined();
    expect(resultResume.error.code).toBe("PROFILE_VALIDATION_ERROR");
  });
});
