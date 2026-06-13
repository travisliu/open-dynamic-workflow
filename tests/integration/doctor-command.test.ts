import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-doctor-integration");

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
    await main(["node", "openflow", ...args]);
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

describe("openflow doctor", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("64. Doctor succeeds when optional built-in provider CLIs are missing and default provider is mock", async () => {
    // Arrange
    const configPath = path.join(TEMP_DIR, "case-64.config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  codex: { command: /bogus/codex }
  gemini: { command: /bogus/gemini }
  opencode: { command: /bogus/opencode }
  antigravity: { command: /bogus/agy }
  pi: { command: /bogus/pi }
`);

    // Act
    const result = await runCli(["doctor", "--config", configPath]);

    // Assert
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("available"); // mock
    expect(result.stdout).toContain("✕ opencode");
    expect(result.stdout).toContain("✕ antigravity");
    expect(result.stdout).toContain("✕ pi");
  });

  it("65. Doctor fails when configured default provider is unavailable", async () => {
    // Arrange
    const providers = ["codex", "gemini", "opencode", "antigravity", "pi"];

    for (const provider of providers) {
      const configPath = path.join(TEMP_DIR, `case-65-${provider}.config.yaml`);
      await fs.writeFile(configPath, `
defaultProvider: ${provider}
providers:
  ${provider}: { command: /bogus/${provider} }
`);

      // Act
      const result = await runCli(["doctor", "--config", configPath]);

      // Assert
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(result.stdout).toContain(`✕ ${provider}`);
    }
  }, 15000);

  it("66. Doctor still succeeds when all required providers are available", async () => {
    // Arrange
    const configPath = path.join(TEMP_DIR, "case-66.config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  opencode: { command: "true" }
  antigravity: { command: "true" }
  pi: { command: "true" }
`);

    // Act
    const result = await runCli(["doctor", "--config", configPath]);

    // Assert
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("mock");
  });
});
