import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { ErrorCode } from "../../src/errors/codes.js";

const TEMP_DIR = path.resolve("tests/temp-thinking-effort-acceptance");
const FAKE_PROVIDER = path.resolve("tests/fixtures/providers/fake-provider-cli.mjs");

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

  // Mock process.exit to prevent the test runner from exiting
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
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
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Integrated Thinking Effort Acceptance Tests (AAA)", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  // TE-008: Execute a run with CLI thinking effort and verify run-input.json and execution metadata
  it("TE-008: resolves precedence (agent > CLI > provider config) and maps Codex command line format", async () => {
    // 1. Arrange: Setup config, workflow file, and target folder
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    
    const configContent = `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    promptMode: stdin
    defaultThinkingEffort: low
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    // The workflow will define agent call with thinkingEffort: high
    // High should override CLI (medium) and provider config (low)
    const workflowContent = `
export const meta = { name: "codex-test", description: "testing codex mapping" };
export default async (ctx) => {
  const result = await ctx.agent({
    id: "codex-agent",
    provider: "codex",
    prompt: "Hello Codex",
    thinkingEffort: "high"
  });
  return result;
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // 2. Act: Run workflow with --thinking-effort medium
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--thinking-effort", "medium"
    ]);

    // 3. Assert: Verify precedence resolution & command construction
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js")!;
    const runDir = path.join(TEMP_DIR, runId);
    
    // Verify run-input.json has the raw CLI options preserved
    const runInput = JSON.parse(await fs.readFile(path.join(runDir, "run-input.json"), "utf8"));
    expect(runInput.rawOptions.thinkingEffort).toBe("medium");

    // Verify agent resolution source and final thinkingEffort in metadata.json
    const metadata = JSON.parse(await fs.readFile(path.join(runDir, "agents/codex-agent/metadata.json"), "utf8"));
    expect(metadata.thinkingEffort).toBe("high"); // agent wins over CLI and provider config
    expect(metadata.thinkingEffortResolutionSource).toBe("agent");

    // Verify command formatting in stderr log of the fake executable (Codex mapping)
    const stderrLog = JSON.parse(await fs.readFile(path.join(runDir, "agents/codex-agent/stderr.log"), "utf8"));
    // Codex maps "high" to `-c model_reasoning_effort="high"`
    expect(stderrLog.argv).toContain("-c");
    expect(stderrLog.argv).toContain('model_reasoning_effort="high"');
  });

  // Precedence level 2: CLI over provider config default
  it("resolves precedence level 2 (CLI > provider config) and maps Pi command line format", async () => {
    // 1. Arrange: Setup config, workflow file (no agent effort)
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    
    const configContent = `
defaultProvider: pi
concurrency: 1
providers:
  pi:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    defaultThinkingEffort: low
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    // No thinking effort inside agent call, so CLI value will win
    const workflowContent = `
export const meta = { name: "pi-test", description: "testing pi mapping" };
export default async (ctx) => {
  const result = await ctx.agent({
    id: "pi-agent",
    provider: "pi",
    prompt: "Hello Pi"
  });
  return result;
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // 2. Act: Run workflow with --thinking-effort medium
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json",
      "--thinking-effort", "medium"
    ]);

    // 3. Assert: Verify precedence resolution & command construction
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js")!;
    const runDir = path.join(TEMP_DIR, runId);

    const metadata = JSON.parse(await fs.readFile(path.join(runDir, "agents/pi-agent/metadata.json"), "utf8"));
    expect(metadata.thinkingEffort).toBe("medium");
    expect(metadata.thinkingEffortResolutionSource).toBe("cli");

    // Verify command formatting (Pi maps "medium" to `--thinking medium`)
    const stderrLog = JSON.parse(await fs.readFile(path.join(runDir, "agents/pi-agent/stderr.log"), "utf8"));
    expect(stderrLog.argv).toContain("--thinking");
    expect(stderrLog.argv[stderrLog.argv.indexOf("--thinking") + 1]).toBe("medium");
  });

  // Precedence level 3: Provider config default
  it("resolves precedence level 3 (provider config > provider CLI default) and maps OpenCode variant format", async () => {
    // 1. Arrange: Setup config, workflow file (no agent effort, no CLI effort)
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    
    const configContent = `
defaultProvider: opencode
concurrency: 1
providers:
  opencode:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    defaultThinkingEffort: minimal
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    const workflowContent = `
export const meta = { name: "opencode-test", description: "testing opencode mapping" };
export default async (ctx) => {
  const result = await ctx.agent({
    id: "opencode-agent",
    provider: "opencode",
    prompt: "Hello OpenCode"
  });
  return result;
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // 2. Act: Run workflow without CLI option
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // 3. Assert: Verify precedence resolution & command construction
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js")!;
    const runDir = path.join(TEMP_DIR, runId);

    const metadata = JSON.parse(await fs.readFile(path.join(runDir, "agents/opencode-agent/metadata.json"), "utf8"));
    expect(metadata.thinkingEffort).toBe("minimal");
    expect(metadata.thinkingEffortResolutionSource).toBe("provider-default");

    // Verify command formatting (OpenCode maps "minimal" to `--variant minimal`)
    const stderrLog = JSON.parse(await fs.readFile(path.join(runDir, "agents/opencode-agent/stderr.log"), "utf8"));
    expect(stderrLog.argv).toContain("--variant");
    expect(stderrLog.argv[stderrLog.argv.indexOf("--variant") + 1]).toBe("minimal");
  });

  // Precedence level 4: Absence / Provider CLI Default
  it("resolves precedence level 4 (no value -> provider-cli-default) and preserves off value mapping", async () => {
    // 1. Arrange: Setup config, workflow file (no efforts configured)
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    
    const configContent = `
defaultProvider: opencode
concurrency: 1
providers:
  opencode:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    // Case 1: absent thinking effort
    // Case 2: agent thinking effort is "off"
    const workflowContent = `
export const meta = { name: "opencode-absent-off", description: "testing absent vs off" };
export default async (ctx) => {
  const a = await ctx.agent({
    id: "opencode-absent",
    provider: "opencode",
    prompt: "Hello OpenCode Absent"
  });
  const b = await ctx.agent({
    id: "opencode-off",
    provider: "opencode",
    prompt: "Hello OpenCode Off",
    thinkingEffort: "off"
  });
  return { a, b };
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // 2. Act: Run
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // 3. Assert: Verify precedence resolution & command construction
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js")!;
    const runDir = path.join(TEMP_DIR, runId);

    // Case 1: absent -> provider-cli-default
    const metadataA = JSON.parse(await fs.readFile(path.join(runDir, "agents/opencode-absent/metadata.json"), "utf8"));
    expect(metadataA.thinkingEffort).toBeUndefined();
    expect(metadataA.thinkingEffortResolutionSource).toBe("provider-cli-default");

    const stderrLogA = JSON.parse(await fs.readFile(path.join(runDir, "agents/opencode-absent/stderr.log"), "utf8"));
    expect(stderrLogA.argv).not.toContain("--variant"); // No flag generated

    // Case 2: off -> agent source & variant none
    const metadataB = JSON.parse(await fs.readFile(path.join(runDir, "agents/opencode-off/metadata.json"), "utf8"));
    expect(metadataB.thinkingEffort).toBe("off");
    expect(metadataB.thinkingEffortResolutionSource).toBe("agent");

    const stderrLogB = JSON.parse(await fs.readFile(path.join(runDir, "agents/opencode-off/stderr.log"), "utf8"));
    expect(stderrLogB.argv).toContain("--variant");
    expect(stderrLogB.argv[stderrLogB.argv.indexOf("--variant") + 1]).toBe("none"); // off maps to none
  });

  // TE-022: Request effort for unsupported provider (Gemini or Mock) throws error and does not spawn process
  it("TE-022: throws THINKING_EFFORT_NOT_SUPPORTED and does not spawn when provider is unsupported", async () => {
    // 1. Arrange: Setup config with gemini provider
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    
    // We add a provider default thinking effort
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    await fs.writeFile(counterPath, "0", "utf8");

    // We wrap FAKE_PROVIDER inside a command script that increments counter
    const wrapperPath = path.join(TEMP_DIR, "wrapper-cli.mjs");
    await fs.writeFile(wrapperPath, `
import * as fs from 'node:fs';
const val = parseInt(fs.readFileSync(${JSON.stringify(counterPath)}, 'utf8'), 10);
fs.writeFileSync(${JSON.stringify(counterPath)}, String(val + 1), 'utf8');
import('./fake-provider-cli.mjs');
`, "utf8");
    // Copy fake-provider-cli.mjs to TEMP_DIR so import works
    await fs.copyFile(FAKE_PROVIDER, path.join(TEMP_DIR, "fake-provider-cli.mjs"));

    const configContent = `
defaultProvider: gemini
concurrency: 1
providers:
  gemini:
    command: node
    args:
      - ${JSON.stringify(wrapperPath)}
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    // Agent definition uses thinkingEffort: high on gemini
    const workflowContent = `
export const meta = { name: "gemini-test", description: "testing unsupported provider" };
export default async (ctx) => {
  const result = await ctx.agent({
    id: "gemini-agent",
    provider: "gemini",
    prompt: "Hello Gemini",
    thinkingEffort: "high"
  });
  return result;
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // 2. Act: Run
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // 3. Assert: Verify that the error code is THINKING_EFFORT_NOT_SUPPORTED and no child process spawned
    expect(result.error).toBeNull(); // Executor catches error and fails agent call
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js" && r !== "counter.txt" && r !== "wrapper-cli.mjs" && r !== "fake-provider-cli.mjs")!;
    const runDir = path.join(TEMP_DIR, runId);

    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    const agentResult = report.agents[0];
    expect(agentResult.ok).toBe(false);
    expect(agentResult.error.code).toBe(ErrorCode.THINKING_EFFORT_NOT_SUPPORTED);

    // Check process execution counter: must be 0 (no spawn)
    const counter = await fs.readFile(counterPath, "utf8");
    expect(counter).toBe("0");
  });

  // TE-023: Request Codex off or xhigh throws error
  it("TE-023: throws THINKING_EFFORT_VALUE_UNSUPPORTED for Codex off/xhigh and does not spawn", async () => {
    // 1. Arrange: Setup Codex and counter
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    await fs.writeFile(counterPath, "0", "utf8");

    const wrapperPath = path.join(TEMP_DIR, "wrapper-cli.mjs");
    await fs.writeFile(wrapperPath, `
import * as fs from 'node:fs';
const val = parseInt(fs.readFileSync(${JSON.stringify(counterPath)}, 'utf8'), 10);
fs.writeFileSync(${JSON.stringify(counterPath)}, String(val + 1), 'utf8');
import('./fake-provider-cli.mjs');
`, "utf8");
    await fs.copyFile(FAKE_PROVIDER, path.join(TEMP_DIR, "fake-provider-cli.mjs"));

    const configContent = `
defaultProvider: codex
concurrency: 1
providers:
  codex:
    command: node
    args:
      - ${JSON.stringify(wrapperPath)}
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    // Codex with xhigh is unsupported
    const workflowContent = `
export const meta = { name: "codex-test", description: "testing codex unsupported value" };
export default async (ctx) => {
  const result = await ctx.agent({
    id: "codex-agent",
    provider: "codex",
    prompt: "Hello Codex",
    thinkingEffort: "xhigh"
  });
  return result;
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // 2. Act: Run
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // 3. Assert: Verify the error code is THINKING_EFFORT_VALUE_UNSUPPORTED and no spawn
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js" && r !== "counter.txt" && r !== "wrapper-cli.mjs" && r !== "fake-provider-cli.mjs")!;
    const runDir = path.join(TEMP_DIR, runId);

    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    const agentResult = report.agents[0];
    expect(agentResult.ok).toBe(false);
    expect(agentResult.error.code).toBe(ErrorCode.THINKING_EFFORT_VALUE_UNSUPPORTED);

    const counter = await fs.readFile(counterPath, "utf8");
    expect(counter).toBe("0");
  });

  // TE-033: OpenCode conflict with explicit metadata.opencodeVariant
  it("TE-033: throws THINKING_EFFORT_CONFLICT for OpenCode when combining thinkingEffort and opencodeVariant", async () => {
    // 1. Arrange: Setup OpenCode and counter
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    await fs.writeFile(counterPath, "0", "utf8");

    const wrapperPath = path.join(TEMP_DIR, "wrapper-cli.mjs");
    await fs.writeFile(wrapperPath, `
import * as fs from 'node:fs';
const val = parseInt(fs.readFileSync(${JSON.stringify(counterPath)}, 'utf8'), 10);
fs.writeFileSync(${JSON.stringify(counterPath)}, String(val + 1), 'utf8');
import('./fake-provider-cli.mjs');
`, "utf8");
    await fs.copyFile(FAKE_PROVIDER, path.join(TEMP_DIR, "fake-provider-cli.mjs"));

    const configContent = `
defaultProvider: opencode
concurrency: 1
providers:
  opencode:
    command: node
    args:
      - ${JSON.stringify(wrapperPath)}
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    // OpenCode call with thinkingEffort AND opencodeVariant in metadata
    const workflowContent = `
export const meta = { name: "opencode-conflict", description: "testing conflict" };
export default async (ctx) => {
  const result = await ctx.agent({
    id: "opencode-agent",
    provider: "opencode",
    prompt: "Hello OpenCode",
    thinkingEffort: "high",
    metadata: {
      opencodeVariant: "low"
    }
  });
  return result;
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // 2. Act: Run
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // 3. Assert: Verify the error code is THINKING_EFFORT_CONFLICT and no spawn
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js" && r !== "counter.txt" && r !== "wrapper-cli.mjs" && r !== "fake-provider-cli.mjs")!;
    const runDir = path.join(TEMP_DIR, runId);

    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    const agentResult = report.agents[0];
    expect(agentResult.ok).toBe(false);
    expect(agentResult.error.code).toBe(ErrorCode.THINKING_EFFORT_CONFLICT);

    const counter = await fs.readFile(counterPath, "utf8");
    expect(counter).toBe("0");
  });

  // TE-037, TE-038: Caching behavior, check fingerprint change
  it("TE-037 & TE-038: verifies cache hit and miss conditions when resolved effort changes", async () => {
    // 1. Arrange: Setup config and workflow with dynamic agent call parameter
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs");
    
    // We will use a counter file to track actual executions
    const counterPath = path.join(TEMP_DIR, "counter.txt");
    await fs.writeFile(counterPath, "0", "utf8");

    const wrapperPath = path.join(TEMP_DIR, "wrapper-cli.mjs");
    await fs.writeFile(wrapperPath, `
import * as fs from 'node:fs';
const val = parseInt(fs.readFileSync(${JSON.stringify(counterPath)}, 'utf8'), 10);
fs.writeFileSync(${JSON.stringify(counterPath)}, String(val + 1), 'utf8');
import('./fake-provider-cli.mjs');
`, "utf8");
    await fs.copyFile(FAKE_PROVIDER, path.join(TEMP_DIR, "fake-provider-cli.mjs"));

    const configContent = `
defaultProvider: pi
concurrency: 1
providers:
  pi:
    command: node
    args:
      - ${JSON.stringify(wrapperPath)}
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    // Workflow uses args.thinking to pass dynamic value to agent call
    const workflowContent = `
export const meta = { name: "cache-test", description: "testing cache fingerprinting" };
export default async (ctx) => {
  const result = await ctx.agent({
    id: "pi-agent",
    provider: "pi",
    prompt: "Hello Caching Pi",
    thinkingEffort: args.thinking
  });
  return result;
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // First Run: execute with thinkingEffort: "low"
    const run1 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", runsDir,
      "--report", "json",
      "--arg", "thinking=low"
    ]);
    expect(run1.error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1"); // live execution

    const runsAfter1 = await fs.readdir(runsDir);
    const runId1 = runsAfter1[0]!;

    // Second Run: execute with same inputs and same thinkingEffort: "low" -> SHOULD HIT CACHE
    const run2 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", runsDir,
      "--report", "json",
      "--resume", runId1,
      "--arg", "thinking=low"
    ]);
    expect(run2.error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("1"); // counter stays 1 (cache hit!)

    const runsAfter2 = await fs.readdir(runsDir);
    const runId2 = runsAfter2.find(id => id !== runId1)!;
    const report2 = JSON.parse(await fs.readFile(path.join(runsDir, runId2, "report.json"), "utf8"));
    expect(report2.agents[0].cache.hit).toBe(true);

    // Third Run: execute with same inputs but changed thinkingEffort: "high" -> SHOULD MISS CACHE
    const run3 = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", runsDir,
      "--report", "json",
      "--resume", runId2,
      "--arg", "thinking=high"
    ]);
    expect(run3.error).toBeNull();
    expect(await fs.readFile(counterPath, "utf8")).toBe("2"); // counter increments to 2 (cache miss!)

    const runsAfter3 = await fs.readdir(runsDir);
    const runId3 = runsAfter3.find(id => id !== runId1 && id !== runId2)!;
    const report3 = JSON.parse(await fs.readFile(path.join(runsDir, runId3, "report.json"), "utf8"));
    expect(report3.agents[0].cache?.hit || false).toBe(false);
  });

  // TE-044, TE-046: Metadata sanitization (hides secrets and variant info, includes safe fields)
  it("TE-044 & TE-046: sanitizes metadata and redacts secret info", async () => {
    // 1. Arrange: Setup config, workflow file with secret env and metadata properties
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    
    // We add a provider default thinking effort
    const configContent = `
defaultProvider: opencode
concurrency: 1
providers:
  opencode:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    defaultThinkingEffort: low
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    // We pass secret values in env/metadata to assert they don't leak
    const workflowContent = `
export const meta = { name: "security-test", description: "testing metadata sanitization" };
export default async (ctx) => {
  const result = await ctx.agent({
    id: "opencode-agent",
    provider: "opencode",
    prompt: "Hello OpenCode Security",
    metadata: {
      secretToken: "secret-do-not-leak-12345",
      someArbitraryKey: "hello-world"
    }
  });
  return result;
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // 2. Act: Run with secret env variables set
    process.env.GITHUB_TOKEN = "github-secret-token";
    process.env.MY_APP_SECRET = "app-secret-token";

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    delete process.env.GITHUB_TOKEN;
    delete process.env.MY_APP_SECRET;

    // 3. Assert: Verify report and metadata sanitization
    expect(result.error).toBeNull();
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js")!;
    const runDir = path.join(TEMP_DIR, runId);

    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));
    const agentMetadata = report.agents[0].metadata;

    // Verify allowed fields exist
    expect(agentMetadata.thinkingEffort).toBe("low");
    expect(agentMetadata.thinkingEffortResolutionSource).toBe("provider-default");

    // Verify secret and arbitrary metadata keys are removed by the sanitizer
    expect(agentMetadata.secretToken).toBeUndefined();
    expect(agentMetadata.someArbitraryKey).toBeUndefined();

    // Verify metadata.json artifact is also sanitized
    const artifactMetadata = JSON.parse(await fs.readFile(path.join(runDir, "agents/opencode-agent/metadata.json"), "utf8"));
    expect(artifactMetadata.thinkingEffort).toBe("low");
    expect(artifactMetadata.thinkingEffortResolutionSource).toBe("provider-default");
    expect(artifactMetadata.secretToken).toBeUndefined();
    expect(artifactMetadata.someArbitraryKey).toBeUndefined();

    // Verify no secret leak in entire report or metadata outputs
    const reportText = await fs.readFile(path.join(runDir, "report.json"), "utf8");
    const metadataText = await fs.readFile(path.join(runDir, "agents/opencode-agent/metadata.json"), "utf8");
    
    expect(reportText).not.toContain("secret-do-not-leak");
    expect(reportText).not.toContain("github-secret-token");
    expect(reportText).not.toContain("app-secret-token");

    expect(metadataText).not.toContain("secret-do-not-leak");
    expect(metadataText).not.toContain("github-secret-token");
    expect(metadataText).not.toContain("app-secret-token");
  });

  // TE-047: Verify compact pretty output and final JSON report schemas do not gain any top-level thinking effort field
  it("TE-047: asserts compact pretty output and final JSON report schemas do not gain a new top-level/report field for thinking effort", async () => {
    const configPath = path.join(TEMP_DIR, "config.yaml");
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    
    const configContent = `
defaultProvider: opencode
concurrency: 1
providers:
  opencode:
    command: node
    args:
      - ${JSON.stringify(FAKE_PROVIDER)}
    defaultThinkingEffort: low
security:
  passEnv: []
tools:
  dir: tests/fixtures/non-existent-tools
`;

    const workflowContent = `
export const meta = { name: "report-schema-test", description: "testing report schema" };
export default async (ctx) => {
  return await ctx.agent({
    id: "opencode-agent",
    provider: "opencode",
    prompt: "Hello OpenCode",
    thinkingEffort: "high"
  });
};
`;

    await fs.writeFile(configPath, configContent, "utf8");
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // Act 1: Run with pretty output mode
    const prettyResult = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty"
    ]);

    expect(prettyResult.error).toBeNull();
    // Compact pretty output shouldn't gain any "thinking" or "reasoning" lines,
    // (Only verbose pretty formatter displays it).
    expect(prettyResult.stdout).not.toContain("Thinking effort");
    expect(prettyResult.stdout).not.toContain("thinkingEffort");

    // Act 2: Run and read report.json
    const runs = await fs.readdir(TEMP_DIR);
    const runId = runs.find(r => r !== "config.yaml" && r !== "workflow.js")!;
    const runDir = path.join(TEMP_DIR, runId);
    const report = JSON.parse(await fs.readFile(path.join(runDir, "report.json"), "utf8"));

    // Assert: Check top-level keys
    const topLevelKeys = Object.keys(report);
    expect(topLevelKeys).toContain("schemaVersion");
    expect(topLevelKeys).toContain("runId");
    expect(topLevelKeys).toContain("status");
    expect(topLevelKeys).toContain("durationMs");
    expect(topLevelKeys).toContain("artifactsDir");
    
    // Ensure no thinking effort fields are added at the top level of the report object
    expect(report.thinkingEffort).toBeUndefined();
    expect(report.defaultThinkingEffort).toBeUndefined();
    expect(report.thinking).toBeUndefined();
  });
});
