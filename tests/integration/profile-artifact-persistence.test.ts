import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-profile-artifact-persistence");

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

describe("Profile Artifact Persistence Integration Tests (Pending Developer B's run.ts wiring)", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("writes optional run-input.json profile with selected/source/path/hash/resolved snapshot/lineage and no extends", async () => {
    const profilesPath = path.join(TEMP_DIR, "profiles.yaml");
    await fs.writeFile(
      profilesPath,
      `
profiles:
  base:
    args:
      val: "base-val"
      secret: "PROFILE_SECRET_SENTINEL_9f1"
    context:
      ctxVal: "base-ctx"
      ctxSecret: "PROFILE_CONTEXT_SECRET_SENTINEL_7a2"
    run:
      concurrency: 2
  override:
    extends: base
    args:
      val: "override-val"
    context:
      otherVal: "hello"
    run:
      failFast: true
`,
      "utf8"
    );

    const workflowPath = "tests/fixtures/workflows/mock-success.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--profiles",
      profilesPath,
      "--profile",
      "override",
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "profiles.yaml")!;
    const runDir = path.join(TEMP_DIR, runId);

    const runInputPath = path.join(runDir, "run-input.json");
    const runInputContent = await fs.readFile(runInputPath, "utf8");
    const runInput = JSON.parse(runInputContent);

    expect(runInput.profile).toBeDefined();
    const prof = runInput.profile;

    expect(prof.selected).toBe("override");
    expect(prof.source).toBe("external");
    expect(prof.profilesPath).toBe(profilesPath);
    expect(prof.hash).toBeDefined();
    expect(prof.inheritanceChain).toEqual(["base", "override"]);
    expect(prof.resumedFromRecordedProfile).toBeUndefined();

    expect(prof.resolved).toEqual({
      args: {
        val: "override-val",
        secret: "PROFILE_SECRET_SENTINEL_9f1"
      },
      context: {
        ctxVal: "base-ctx",
        ctxSecret: "PROFILE_CONTEXT_SECRET_SENTINEL_7a2",
        otherVal: "hello"
      },
      run: {
        concurrency: 2,
        failFast: true
      }
    });

    expect(prof.resolved.extends).toBeUndefined();

    // Verify privacy constraints: secret appears in run-input.json, but NOT in final report or events.jsonl
    const reportPath = path.join(runDir, "report.json");
    if (await fs.stat(reportPath).catch(() => false)) {
      const reportContent = await fs.readFile(reportPath, "utf8");
      expect(reportContent).not.toContain("PROFILE_SECRET_SENTINEL_9f1");
      expect(reportContent).not.toContain("PROFILE_CONTEXT_SECRET_SENTINEL_7a2");
    }

    const eventsPath = path.join(runDir, "events.jsonl");
    if (await fs.stat(eventsPath).catch(() => false)) {
      const eventsContent = await fs.readFile(eventsPath, "utf8");
      expect(eventsContent).not.toContain("PROFILE_SECRET_SENTINEL_9f1");
      expect(eventsContent).not.toContain("PROFILE_CONTEXT_SECRET_SENTINEL_7a2");
    }
  });

  it("functions without regression when no profile is selected", async () => {
    const workflowPath = "tests/fixtures/workflows/mock-success.workflow.js";
    const configPath = "tests/fixtures/config/mock.config.yaml";

    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR
    ]);

    expect(result.error).toBeNull();

    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const runInputPath = path.join(runDir, "run-input.json");
    const runInput = JSON.parse(await fs.readFile(runInputPath, "utf8"));

    expect(runInput.profile).toBeUndefined();
    expect(runInput.workflowFile).toBeDefined();
  });
});
