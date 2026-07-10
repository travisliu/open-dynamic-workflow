import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { renderCliError } from "../../src/cli/error-output.js";

const TEMP_DIR = path.resolve("tests/temp-profile-phase3-acceptance");
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    error = err;
    if (stderrData.length === 0) {
      renderCliError(err, { argv: ["node", "open-dynamic-workflow", ...args] });
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Phase 3 Profile Acceptance Tests - Persistence, Resume, and Reporting", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });

    // Setup workflow discovery directories to pass validation
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/agents"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/tools"), { recursive: true });

    // Create a dummy workflow
    const wfContent = `
export const meta = {
  name: "acceptance-test-workflow",
  description: "Workflow for acceptance testing phase 3"
};
phase("run");
const res = await agent({ id: "agent-1", prompt: "test prompt" });
export default { res };
`;
    await fs.writeFile(path.join(TEMP_DIR, "workflows/test.workflow.js"), wfContent, "utf8");
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("should persist profile snapshot, redact secret from reports, and resume deterministically (AC-1, AC-3, AC-6, AC-7)", async () => {
    // -------------------------------------------------------------------------
    // 1. Arrange: Setup profile configurations and external YAML catalog with secret sentinel
    // -------------------------------------------------------------------------
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

    const workflowPath = path.join(TEMP_DIR, "workflows/test.workflow.js");
    const configPath = "tests/fixtures/config/mock.config.yaml";

    // Write a test-specific workflow checking the context sentinel
    const testWfContent = `
export const meta = {
  name: "acceptance-test-workflow",
  description: "Workflow for acceptance testing phase 3"
};
phase("run");
if (context.get("ctxSecret") !== "PROFILE_CONTEXT_SECRET_SENTINEL_7a2") {
  throw new Error("Profile context sentinel is missing or incorrect!");
}
const res = await agent({ id: "agent-1", prompt: "test prompt" });
export default { res };
`;
    await fs.writeFile(workflowPath, testWfContent, "utf8");

    // -------------------------------------------------------------------------
    // 2. Act: Run with selected profile and output report in JSON mode
    // -------------------------------------------------------------------------
    const runResult = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--profiles",
      profilesPath,
      "--profile",
      "override",
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // -------------------------------------------------------------------------
    // 3. Assert: Verify the exact recorded snapshot, hash, lineage, and secret redaction
    // -------------------------------------------------------------------------
    expect(runResult.error).toBeNull();

    // Extract run ID
    const runData = JSON.parse(runResult.stdout);
    const runId = runData.runId;
    expect(runId).toBeDefined();

    const runDir = path.join(TEMP_DIR, runId);
    const runInputPath = path.join(runDir, "run-input.json");
    const runInput = JSON.parse(await fs.readFile(runInputPath, "utf8"));

    // Verify run-input.json contains the resolved profile snapshot
    expect(runInput.profile).toBeDefined();
    const prof = runInput.profile;
    expect(prof.selected).toBe("override");
    expect(prof.source).toBe("external");
    expect(prof.profilesPath).toBe(profilesPath);
    expect(prof.hash).toBeDefined();
    expect(prof.inheritanceChain).toEqual(["base", "override"]);
    expect(prof.resumedFromRecordedProfile).toBeUndefined();

    // Verify exact snapshot and removal of 'extends'
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

    // Verify secret sentinel resides only in run-input.json and not in final reports/stdout/events
    expect(runResult.stdout).not.toContain("PROFILE_SECRET_SENTINEL_9f1");
    expect(runResult.stdout).not.toContain("PROFILE_CONTEXT_SECRET_SENTINEL_7a2");
    expect(runResult.stderr).not.toContain("PROFILE_SECRET_SENTINEL_9f1");
    expect(runResult.stderr).not.toContain("PROFILE_CONTEXT_SECRET_SENTINEL_7a2");

    // Final report check
    const reportPath = path.join(runDir, "report.json");
    const reportContent = await fs.readFile(reportPath, "utf8");
    const reportJson = JSON.parse(reportContent);
    expect(reportContent).not.toContain("PROFILE_SECRET_SENTINEL_9f1");
    expect(reportContent).not.toContain("PROFILE_CONTEXT_SECRET_SENTINEL_7a2");
    expect(reportJson.profile).toBeDefined();
    expect(reportJson.profile.resolved).toBeUndefined(); // Compact check

    // Event stream check
    const eventsPath = path.join(runDir, "events.jsonl");
    const eventsContent = await fs.readFile(eventsPath, "utf8");
    expect(eventsContent).not.toContain("PROFILE_SECRET_SENTINEL_9f1");
    expect(eventsContent).not.toContain("PROFILE_CONTEXT_SECRET_SENTINEL_7a2");

    // -------------------------------------------------------------------------
    // 4. Act (Resume): Delete profiles file and perform resume
    // -------------------------------------------------------------------------
    await fs.unlink(profilesPath); // Original profiles file is gone

    const resumeResult = await runCli([
      "resume",
      runId,
      "--out",
      TEMP_DIR,
      "--report",
      "pretty"
    ]);

    // -------------------------------------------------------------------------
    // 5. Assert (Resume): Reuses recorded profile without external loader
    // -------------------------------------------------------------------------
    expect(resumeResult.error).toBeNull();
    expect(resumeResult.stdout).toContain("profile:   override (reused from recorded run input)");

    // Locate the resumed run directory and verify marker in run-input.json
    const runs = (await fs.readdir(TEMP_DIR)).filter(d => uuidRegex.test(d) && d !== runId);
    expect(runs.length).toBe(1);
    const resumeRunId = runs[0];
    const resumeRunInput = JSON.parse(await fs.readFile(path.join(TEMP_DIR, resumeRunId, "run-input.json"), "utf8"));
    expect(resumeRunInput.profile.resumedFromRecordedProfile).toBe(true);
    expect(resumeRunInput.profile.hash).toBe(prof.hash);
  }, 30000);

  it("should handle run --resume with and without overrides, and enforce precedence (AC-4, AC-5)", async () => {
    // -------------------------------------------------------------------------
    // 1. Arrange: Setup profile configurations and run a workflow to persist initial run-input.json
    // -------------------------------------------------------------------------
    const profilesPath = path.join(TEMP_DIR, "profiles.yaml");
    await fs.writeFile(
      profilesPath,
      `
profiles:
  test:
    args:
      val: "original-val"
    run:
      concurrency: 4
`,
      "utf8"
    );

    const workflowPath = path.join(TEMP_DIR, "workflows/test.workflow.js");
    const configPath = "tests/fixtures/config/mock.config.yaml";

    const runResult = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--profiles",
      profilesPath,
      "--profile",
      "test",
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);
    const runId = JSON.parse(runResult.stdout).runId;

    // -------------------------------------------------------------------------
    // 2. Act: Execute run --resume without profile flags
    // -------------------------------------------------------------------------
    const runResumeResult = await runCli([
      "run",
      workflowPath,
      "--resume",
      runId,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // -------------------------------------------------------------------------
    // 3. Assert: Reuses profile and writes resumedFromRecordedProfile marker
    // -------------------------------------------------------------------------
    expect(runResumeResult.error).toBeNull();
    const runResumeData = JSON.parse(runResumeResult.stdout);
    const runResumeId = runResumeData.runId;

    const resumeRunInput = JSON.parse(
      await fs.readFile(path.join(TEMP_DIR, runResumeId, "run-input.json"), "utf8")
    );
    expect(resumeRunInput.profile).toBeDefined();
    expect(resumeRunInput.profile.selected).toBe("test");
    expect(resumeRunInput.profile.resumedFromRecordedProfile).toBe(true);

    // -------------------------------------------------------------------------
    // 4. Act: Modify the profiles catalog with a new override, then run --resume with explicit profile flags
    // -------------------------------------------------------------------------
    const newProfilesPath = path.join(TEMP_DIR, "new-profiles.yaml");
    await fs.writeFile(
      newProfilesPath,
      `
profiles:
  new-test:
    args:
      val: "override-val"
    run:
      concurrency: 5
`,
      "utf8"
    );

    const runResumeOverrideResult = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--resume",
      runId,
      "--profiles",
      newProfilesPath,
      "--profile",
      "new-test",
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // -------------------------------------------------------------------------
    // 5. Assert: Fresh profile resolution is triggered and recorded reuse marker is absent
    // -------------------------------------------------------------------------
    expect(runResumeOverrideResult.error).toBeNull();
    const overrideData = JSON.parse(runResumeOverrideResult.stdout);
    const overrideRunId = overrideData.runId;

    const overrideRunInput = JSON.parse(
      await fs.readFile(path.join(TEMP_DIR, overrideRunId, "run-input.json"), "utf8")
    );
    expect(overrideRunInput.profile).toBeDefined();
    expect(overrideRunInput.profile.selected).toBe("new-test");
    expect(overrideRunInput.profile.resolved.args.val).toBe("override-val");
    expect(overrideRunInput.profile.resumedFromRecordedProfile).toBeUndefined(); // Bypass recorded reuse
  }, 30000);

  it("should fail closed on malformed profile and preserve legacy compatibility (AC-2, AC-9)", async () => {
    // -------------------------------------------------------------------------
    // 1. Arrange: Run workflow without profiles to create a valid legacy (no-profile) run-input.json
    // -------------------------------------------------------------------------
    const workflowPath = path.join(TEMP_DIR, "workflows/test.workflow.js");
    const configPath = "tests/fixtures/config/mock.config.yaml";

    const legacyRunCliResult = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);
    expect(legacyRunCliResult.error).toBeNull();
    const legacyRunId = JSON.parse(legacyRunCliResult.stdout).runId;

    // -------------------------------------------------------------------------
    // 2. Act: Resume the legacy run
    // -------------------------------------------------------------------------
    const legacyResult = await runCli([
      "resume",
      legacyRunId,
      "--out",
      TEMP_DIR
    ]);

    // -------------------------------------------------------------------------
    // 3. Assert: Legacy resume succeeds (backward compatibility)
    // -------------------------------------------------------------------------
    expect(legacyResult.error).toBeNull();

    // -------------------------------------------------------------------------
    // 4. Arrange: Create a corrupt/malformed profile record by editing the run-input.json
    // -------------------------------------------------------------------------
    const corruptRunCliResult = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);
    expect(corruptRunCliResult.error).toBeNull();
    const corruptRunId = JSON.parse(corruptRunCliResult.stdout).runId;

    const runInputPath = path.join(TEMP_DIR, corruptRunId, "run-input.json");
    const runInput = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    runInput.profile = {
      selected: "", // Invalid profile name (empty)
      source: "recorded",
      hash: "invalid-hash",
      resolved: {}
    };
    await fs.writeFile(runInputPath, JSON.stringify(runInput), "utf8");

    // -------------------------------------------------------------------------
    // 5. Act: Resume the corrupt run
    // -------------------------------------------------------------------------
    const corruptResult = await runCli([
      "resume",
      corruptRunId,
      "--out",
      TEMP_DIR
    ]);

    // -------------------------------------------------------------------------
    // 6. Assert: Execution fails closed with PROFILE_VALIDATION_ERROR before doing workflow work
    // -------------------------------------------------------------------------
    expect(corruptResult.error).toBeDefined();
    expect(corruptResult.error.code).toBe("PROFILE_VALIDATION_ERROR");
  }, 30000);

  it("should format outputs properly in JSONL mode and ensure event order (AC-7)", async () => {
    // -------------------------------------------------------------------------
    // 1. Arrange: Setup profile config
    // -------------------------------------------------------------------------
    const profilesPath = path.join(TEMP_DIR, "profiles.yaml");
    await fs.writeFile(
      profilesPath,
      `
profiles:
  fast:
    args: { val: 1 }
    run: { provider: mock }
`,
      "utf8"
    );

    const workflowPath = path.join(TEMP_DIR, "workflows/test.workflow.js");
    const configPath = "tests/fixtures/config/mock.config.yaml";

    // -------------------------------------------------------------------------
    // 2. Act: Run workflow in JSONL mode to check event sequences and ordering
    // -------------------------------------------------------------------------
    const jsonlResult = await runCli([
      "run",
      workflowPath,
      "--config",
      configPath,
      "--profiles",
      profilesPath,
      "--profile",
      "fast",
      "--out",
      TEMP_DIR,
      "--report",
      "jsonl"
    ]);

    // -------------------------------------------------------------------------
    // 3. Assert: JSONL contains profile.resolved before workflow tasks start
    // -------------------------------------------------------------------------
    expect(jsonlResult.error).toBeNull();
    const lines = jsonlResult.stdout.trim().split("\n");
    const events = lines.map(l => JSON.parse(l));

    const resolvedIndex = events.findIndex(e => e.type === "profile.resolved");
    expect(resolvedIndex).toBeGreaterThanOrEqual(0);
    expect(events[resolvedIndex].payload.profile.resolved).toBeUndefined(); // Only compact metadata

    const taskIndex = events.findIndex(e => e.type === "workflow.started" || e.type.startsWith("agent."));
    expect(taskIndex).toBeGreaterThan(resolvedIndex); // Monotonically preceding execution
  }, 30000);
});
