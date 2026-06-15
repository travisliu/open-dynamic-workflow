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
    const tarballName = packOutput.split("\n").pop() || `prmflow-openflow-${PACKAGE_VERSION}.tgz`;
    packedTarballPath = path.resolve(WORKSPACE_DIR, tarballName);
  });

  afterAll(async () => {
    // Clean up temporary npm prefix
    await fs.rm(TEMP_NPM_DIR, { recursive: true, force: true });
    // Clean up packed tarball
    if (packedTarballPath && existsSync(packedTarballPath)) {
      await fs.unlink(packedTarballPath);
    }
  });

  it("can execute npx . --help", () => {
    const stdout = execSync("npx . --help", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Orchestrate coding-agent CLI workflows");
  });

  it("can execute npx . list --help and see examples", () => {
    const stdout = execSync("npx . list --help", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("openflow list agents --verbose");
    expect(stdout).toContain("openflow list workflows --dir examples/workflows");
  });

  it("can execute npx . init --help", () => {
    const stdout = execSync("npx . init --help", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Initialize a project for OpenFlow");
  });

  it("can execute npx . doctor", () => {
    const stdout = execSync("npx . doctor", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Node.js >= 20");
    expect(stdout).toContain(`openflow ${PACKAGE_VERSION}`);
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
    const binaryName = isWindows ? "openflow.cmd" : "openflow";
    const globalBinPath = path.join(TEMP_NPM_DIR, isWindows ? "" : "bin", binaryName);

    expect(existsSync(globalBinPath)).toBe(true);

    const helpStdout = execSync(`"${globalBinPath}" --help`, { encoding: "utf8" });
    expect(helpStdout).toContain("Orchestrate coding-agent CLI workflows");

    const doctorStdout = execSync(`"${globalBinPath}" doctor`, { encoding: "utf8" });
    expect(doctorStdout).toContain("Node.js >= 20");
    expect(doctorStdout).toContain(`openflow ${PACKAGE_VERSION}`);

    // Run the installed openflow binary with a real workflow and verify output/artifacts
    const runOutDir = path.join(TEMP_NPM_DIR, "out");
    await fs.mkdir(runOutDir, { recursive: true });

    const runCommand = `"${globalBinPath}" run tests/fixtures/workflows/mock-success.workflow.js --config tests/fixtures/config/mock.config.yaml --out "${runOutDir}" --report json`;
    const runStdout = execSync(runCommand, { encoding: "utf8" });

    // Assert: stdout is exactly one parseable JSON report
    let parsedReport: any;
    expect(() => {
      parsedReport = JSON.parse(runStdout.trim());
    }).not.toThrow();

    expect(parsedReport.schemaVersion).toBe("openflow.report.v1");
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

    expect(existsSync(path.join(initProjectDir, ".openflow/config.yaml"))).toBe(true);
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
    expect(report.schemaVersion).toBe("openflow.report.v1");
    expect(report.status).toBe("succeeded");
  });
});
