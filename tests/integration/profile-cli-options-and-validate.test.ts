import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { renderCliError } from "../../src/cli/error-output.js";

const TEMP_DIR = path.resolve("tests/temp-profile-cli-options-and-validate");

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
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
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
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Integration - CLI Profile Options and Validate", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });

    // Write a valid simple workflow
    const wfContent = `
export const meta = {
  name: "valid",
  description: "A valid simple workflow"
};
export default { ok: true };
`;
    await fs.writeFile(path.join(TEMP_DIR, "valid.workflow.js"), wfContent);

    // Create default discovery directories to satisfy policy validation
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/agents"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/tools"), { recursive: true });

    // Write a base config.yaml with profiles
    const configContent = `
profiles:
  deep:
    description: "Deep profile"
    args:
      x: 1
`;
    await fs.writeFile(path.join(TEMP_DIR, "config.yaml"), configContent);

    // Write an external .profiles.yml
    const profilesContent = `
profiles:
  ci:
    description: "CI profile"
    args:
      y: 2
`;
    await fs.writeFile(path.join(TEMP_DIR, ".profiles.yml"), profilesContent);
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("run --help and validate --help show profile options and examples", async () => {
    const runHelp = await runCli(["run", "--help"]);
    expect(runHelp.stdout).toContain("--profile <name>");
    expect(runHelp.stdout).toContain("--profiles <path>");
    expect(runHelp.stdout).toContain("run my-workflow --profile fast");

    const valHelp = await runCli(["validate", "--help"]);
    expect(valHelp.stdout).toContain("--profile <name>");
    expect(valHelp.stdout).toContain("--profiles <path>");
    expect(valHelp.stdout).toContain("validate my-workflow --profile fast");
  });

  it("fails with duplicate --profile or --profiles options", async () => {
    const res1 = await runCli(["validate", "some-wf", "--profile", "fast", "--profile", "slow"]);
    expect(res1.error).toBeDefined();
    expect(res1.error.code).toBe("CLI_USAGE_ERROR");

    const res2 = await runCli(["validate", "some-wf", "--profiles", "f1.yml", "--profiles", "f2.yml"]);
    expect(res2.error).toBeDefined();
    expect(res2.error.code).toBe("CLI_USAGE_ERROR");
  });

  it("validates a workflow with inline --profile deep", async () => {
    const res = await runCli([
      "validate",
      path.join(TEMP_DIR, "valid.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--profile",
      "deep"
    ]);

    expect(res.error).toBeNull();
    expect(res.stdout).toContain("Validated workflow");
  });

  it("validates a workflow with external profiles --profiles and --profile ci", async () => {
    const res = await runCli([
      "validate",
      path.join(TEMP_DIR, "valid.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--profiles",
      ".profiles.yml",
      "--profile",
      "ci"
    ]);

    expect(res.error).toBeNull();
    expect(res.stdout).toContain("Validated workflow");
  });

  it("failing profile selection throws before target workflow discovery can run", async () => {
    // We target a non-existent workflow file, but supply a non-existent profile name.
    // If profile selection resolution runs first, it must throw PROFILE_NOT_FOUND,
    // rather than failing on target resolution / file not found.
    const res = await runCli([
      "validate",
      path.join(TEMP_DIR, "non-existent-workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--profile",
      "non-existent-profile"
    ]);

    expect(res.error).toBeDefined();
    expect(res.error.code).toBe("PROFILE_NOT_FOUND");
    // Ensure it was not a target resolution failure
    expect(res.error.code).not.toBe("WORKFLOW_TARGET_NOT_FOUND");
    expect(res.error.code).not.toBe("WORKFLOW_FILE_NOT_FOUND");
  });

  it("run invocation accepts profile flags and parses successfully (proves parser acceptance)", async () => {
    // We use dry-run to avoid running actual workflows/providers
    const res = await runCli([
      "run",
      path.join(TEMP_DIR, "valid.workflow.js"),
      "--config",
      path.join(TEMP_DIR, "config.yaml"),
      "--cwd",
      TEMP_DIR,
      "--profile",
      "deep",
      "--dry-run"
    ]);

    // Should not throw a CLI usage error or option parsing error
    expect(res.error).toBeNull();
  });
});
