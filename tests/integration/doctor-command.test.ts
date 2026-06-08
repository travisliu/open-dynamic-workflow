import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-tc-10");

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

  it("Doctor reports missing Codex CLI", async () => {
    const configPath = path.join(TEMP_DIR, "tc-10.01.config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  codex:
    command: /path/to/bogus/codex
`);

    const result = await runCli([
      "doctor",
      "--config", configPath
    ]);

    expect(result.error).toBeNull();

    // Output contains codex: Unavailable or similar
    expect(result.stdout).toContain("✕ codex");
    expect(result.stdout).toMatch(/unavailable/i);
    expect(result.stdout).toContain("Command '/path/to/bogus/codex' is not available");
    expect(result.stdout).toContain("Warning: optional provider CLI unavailable: codex");
  });

  it("Doctor reports missing Gemini CLI", async () => {
    const configPath = path.join(TEMP_DIR, "tc-10.02.config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  gemini:
    command: /path/to/bogus/gemini
`);

    const result = await runCli([
      "doctor",
      "--config", configPath
    ]);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("✕ gemini");
    expect(result.stdout).toMatch(/unavailable/i);
    expect(result.stdout).toContain("Command '/path/to/bogus/gemini' is not available");
    expect(result.stdout).toContain("Warning: optional provider CLI unavailable: gemini");
  });

  it("Doctor succeeds with mock provider only", async () => {
    const configPath = path.join(TEMP_DIR, "tc-10.03.config.yaml");
    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  codex:
    command: "true"
  gemini:
    command: "true"
`);

    const result = await runCli([
      "doctor",
      "--config", configPath
    ]);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("mock");
    expect(result.stdout).toContain("available");
  });
});
