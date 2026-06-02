import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";

const WORKSPACE_DIR = "/root/projects/execflow";
const TEMP_NPM_DIR = path.resolve(WORKSPACE_DIR, "tests/temp-npm-prefix");
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
    const tarballName = packOutput.split("\n").pop() || "execflow-0.1.0.tgz";
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

  it("can execute npx . doctor", () => {
    const stdout = execSync("npx . doctor", { cwd: WORKSPACE_DIR, encoding: "utf8" });
    expect(stdout).toContain("Node.js >= 20");
    expect(stdout).toContain("execflow 0.1.0");
    expect(stdout).toContain("Current directory writable");
  });

  it("can execute npx . validate on a simple workflow", () => {
    const stdout = execSync("npx . validate tests/fixtures/simple-workflow.ts", {
      cwd: WORKSPACE_DIR,
      encoding: "utf8"
    });
    expect(stdout).toContain("Workflow is valid: simple-mock-workflow");
  });

  it("can install globally with a custom prefix and run", () => {
    // Install globally with custom prefix (which uses temp prefix directory inside workspace)
    execSync(`npm install --prefix "${TEMP_NPM_DIR}" -g "${packedTarballPath}"`, {
      cwd: WORKSPACE_DIR,
      stdio: "ignore"
    });

    const isWindows = process.platform === "win32";
    const binaryName = isWindows ? "execflow.cmd" : "execflow";
    const globalBinPath = path.join(TEMP_NPM_DIR, isWindows ? "" : "bin", binaryName);

    expect(existsSync(globalBinPath)).toBe(true);

    const helpStdout = execSync(`"${globalBinPath}" --help`, { encoding: "utf8" });
    expect(helpStdout).toContain("Orchestrate coding-agent CLI workflows");

    const doctorStdout = execSync(`"${globalBinPath}" doctor`, { encoding: "utf8" });
    expect(doctorStdout).toContain("Node.js >= 20");
    expect(doctorStdout).toContain("execflow 0.1.0");
  });
});
