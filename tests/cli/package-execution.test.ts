import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

const WORKSPACE_DIR = path.resolve(process.cwd());
const TEMP_NPM_DIR = path.resolve(WORKSPACE_DIR, "tests/temp-npm-prefix");
const PACKAGE_VERSION = JSON.parse(readFileSync(path.join(WORKSPACE_DIR, "package.json"), "utf8")).version;
let packedTarballPath = "";

describe("CLI package execution and installation", () => {
  beforeAll(async () => {
    // Ensure project is built
    execSync("npm run build", { cwd: WORKSPACE_DIR, stdio: "ignore" });

    // Clean and recreate temp directory inside workspace
    await fs.rm(TEMP_NPM_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_NPM_DIR, { recursive: true });

    // Pack the package
    const packOutput = execSync("npm pack", { cwd: WORKSPACE_DIR, encoding: "utf8" }).trim();
    const tarballName = packOutput.split("\n").pop() || `travisliu-open-dynamic-workflow-${PACKAGE_VERSION}.tgz`;
    packedTarballPath = path.resolve(WORKSPACE_DIR, tarballName);
  }, 60000);

  afterAll(async () => {
    // Clean up temporary npm prefix
    await fs.rm(TEMP_NPM_DIR, { recursive: true, force: true });
    // Clean up packed tarball
    if (packedTarballPath && existsSync(packedTarballPath)) {
      await fs.unlink(packedTarballPath);
    }
  });

  it("can execute the openflow wrapper package bin", () => {
    // Install the packed tarball into openflow/ first to ensure it has the latest local version
    execSync(`npm install --no-save --no-package-lock "${packedTarballPath}"`, {
      cwd: path.join(WORKSPACE_DIR, "openflow"),
      stdio: "ignore"
    });

    // Run --help through the wrapper
    const helpStdout = execSync("node openflow/bin/openflow.js --help 2>&1", {
      cwd: WORKSPACE_DIR,
      encoding: "utf8"
    });
    expect(helpStdout).toContain("[deprecated] @prmflow/openflow has moved to @travisliu/open-dynamic-workflow.");
    expect(helpStdout).toContain("Orchestrate coding-agent CLI workflows");

    // Run doctor through the wrapper
    const doctorStdout = execSync("node openflow/bin/openflow.js doctor 2>&1", {
      cwd: WORKSPACE_DIR,
      encoding: "utf8"
    });
    expect(doctorStdout).toContain("Node.js >= 20");
    expect(doctorStdout).toContain("open-dynamic-workflow");

  }, 30000);

  it("can execute npx . --help", () => {
    const stdout = execSync("npx . --help", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Orchestrate coding-agent CLI workflows");
  });

  it("can execute npx . list --help and see examples", () => {
    const stdout = execSync("npx . list --help", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("open-dynamic-workflow list agents --verbose");
    expect(stdout).toContain("open-dynamic-workflow list workflows --dir examples/workflows");
  });

  it("can execute npx . init --help", () => {
    const stdout = execSync("npx . init --help", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Initialize a project for Open Dynamic Workflow");
  });

  it("can execute npx . doctor", () => {
    const stdout = execSync("npx . doctor", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Node.js >= 20");
    expect(stdout).toContain(`open-dynamic-workflow ${PACKAGE_VERSION}`);
    expect(stdout).toContain("Current directory writable");
  });

  it("can execute npx . validate on a simple workflow", () => {
    const stdout = execSync("npx . validate tests/fixtures/simple-workflow.ts", {
      cwd: WORKSPACE_DIR,
      encoding: "utf8"
    });
    expect(stdout).toContain("Validated workflow \"simple-mock-workflow\" at tests/fixtures/simple-workflow.ts");
  });

  it("can install globally with a custom prefix and run", async () => {
    // Install globally with custom prefix (which uses temp prefix directory inside workspace)
    execSync(`npm install --prefix "${TEMP_NPM_DIR}" -g "${packedTarballPath}"`, {
      cwd: WORKSPACE_DIR,
      stdio: "ignore"
    });

    const isWindows = process.platform === "win32";
    const binaryName = isWindows ? "open-dynamic-workflow.cmd" : "open-dynamic-workflow";
    const globalBinPath = path.join(TEMP_NPM_DIR, isWindows ? "" : "bin", binaryName);
    
    const odwBinaryName = isWindows ? "odw.cmd" : "odw";
    const globalOdwPath = path.join(TEMP_NPM_DIR, isWindows ? "" : "bin", odwBinaryName);

    expect(existsSync(globalBinPath)).toBe(true);
    expect(existsSync(globalOdwPath)).toBe(true);

    const helpStdout = execSync(`"${globalBinPath}" --help`, { encoding: "utf8" });
    expect(helpStdout).toContain("Orchestrate coding-agent CLI workflows");

    const odwHelpStdout = execSync(`"${globalOdwPath}" --help`, { encoding: "utf8" });
    expect(odwHelpStdout).toContain("Orchestrate coding-agent CLI workflows");

    const doctorStdout = execSync(`"${globalBinPath}" doctor`, { encoding: "utf8" });
    expect(doctorStdout).toContain("Node.js >= 20");
    expect(doctorStdout).toContain(`open-dynamic-workflow ${PACKAGE_VERSION}`);

    // Run the installed open-dynamic-workflow binary with a real workflow and verify output/artifacts
    const runOutDir = path.join(TEMP_NPM_DIR, "out");
    await fs.mkdir(runOutDir, { recursive: true });

    const runCommand = `"${globalBinPath}" run tests/fixtures/workflows/mock-success.workflow.js --config tests/fixtures/config/mock.config.yaml --out "${runOutDir}" --report json`;
    const runStdout = execSync(runCommand, { encoding: "utf8" });

    // Assert: stdout is exactly one parseable JSON report
    let parsedReport: any;
    expect(() => {
      parsedReport = JSON.parse(runStdout.trim());
    }).not.toThrow();

    expect(parsedReport.schemaVersion).toBe("open-dynamic-workflow.report.v1");
    expect(typeof parsedReport.runId).toBe("string");
    expect(parsedReport.status).toBe("succeeded");

    // Assert: only one run directory is created under the temp output path
    const runDirs = await fs.readdir(runOutDir);
    expect(runDirs.length).toBe(1);
    const actualRunDir = runDirs[0]!;

    // Assert: the persisted report contains a single runId matching that one run directory
    expect(parsedReport.runId).toBe(actualRunDir);

    const persistedReportPath = path.join(runOutDir, actualRunDir, "report.json");
    expect(existsSync(persistedReportPath)).toBe(true);
    const persistedReportContent = await fs.readFile(persistedReportPath, "utf8");
    const parsedPersistedReport = JSON.parse(persistedReportContent);
    expect(parsedPersistedReport.runId).toBe(actualRunDir);

    // Basic init --yes coverage
    const initProjectDir = path.join(TEMP_NPM_DIR, "init-project");
    await fs.mkdir(initProjectDir, { recursive: true });
    execSync(`"${globalBinPath}" init --yes --cwd "${initProjectDir}"`, { encoding: "utf8" });

    expect(existsSync(path.join(initProjectDir, ".open-dynamic-workflow/config.yaml"))).toBe(true);
    expect(existsSync(path.join(initProjectDir, "workflows/example.ts"))).toBe(true);

    // Init with smoke test
    const smokeTestDir = path.join(TEMP_NPM_DIR, "smoke-test-project");
    await fs.mkdir(smokeTestDir, { recursive: true });
    const smokeStdout = execSync(`"${globalBinPath}" init --yes --cwd "${smokeTestDir}" --run-smoke-test`, { encoding: "utf8" });
    expect(smokeStdout).toContain("Smoke test result");
    expect(smokeStdout).toContain("Validation: succeeded");
    expect(smokeStdout).toContain("Mock run: succeeded");

    // Init with JSON smoke test
    const jsonSmokeDir = path.join(TEMP_NPM_DIR, "json-smoke-project");
    await fs.mkdir(jsonSmokeDir, { recursive: true });
    const jsonStdout = execSync(`"${globalBinPath}" init --yes --cwd "${jsonSmokeDir}" --run-smoke-test --report json`, { encoding: "utf8" });
    const report = JSON.parse(jsonStdout.trim());
    expect(report.schemaVersion).toBe("open-dynamic-workflow.report.v1");
    expect(report.status).toBe("succeeded");

    // Preflight run --report json package execution test
    const preflightCommand = `"${globalBinPath}" run non-existent-workflow --cwd "${TEMP_NPM_DIR}" --report json`;
    let preflightError: any = null;
    let preflightStdout = "";
    try {
      preflightStdout = execSync(preflightCommand, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    } catch (err: any) {
      preflightError = err;
      preflightStdout = err.stdout;
    }
    
    expect(preflightError).not.toBeNull();
    const parsedEnvelope = JSON.parse(preflightStdout.trim());
    expect(parsedEnvelope.schemaVersion).toBe("open-dynamic-workflow.error.v1");
    expect(parsedEnvelope.status).toBe("failed");
    expect(parsedEnvelope.error.code).toBe("WORKFLOW_DISCOVERY_FAILED");
    expect(parsedEnvelope.error.hint).toBeDefined();
    expect(parsedEnvelope.error.hint.code).toBe("PROJECT_INIT_MISSING");
    expect(parsedEnvelope.error.hint.command).toBe("open-dynamic-workflow init");
  }, 45000);

  it("displays --thinking-effort option in npx . run --help and rejects --reasoning-effort", () => {
    const runHelpStdout = execSync("npx . run --help", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(runHelpStdout).toContain("--thinking-effort <effort>");

    let errorResult: any = null;
    try {
      execSync("npx . run my-workflow --reasoning-effort high", { cwd: WORKSPACE_DIR, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    } catch (err: any) {
      errorResult = err;
    }
    expect(errorResult).not.toBeNull();
  });
});
