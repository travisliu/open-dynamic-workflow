import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { runWorkflowService } from "../../../src/cli/commands/run.js";
import type { RuntimeRunner, WorkflowRunResult } from "../../../src/runtime/public.js";

// Mock precollect and discovery to spy on their inputs
const precollectSpy = vi.fn().mockImplementation(async (options: any) => {
  return {
    workflow: {
      loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
      collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
    },
    sharedAgents: {
      loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
      collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
    },
    tools: {
      loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
      collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
    }
  };
});

vi.mock("../../../src/discovery/precollect.js", () => {
  return {
    precollectAllResourcesForLoad: (args: any) => precollectSpy(args),
    checkDiscoveryPolicy: vi.fn()
  };
});

const discoverySpy = vi.fn().mockImplementation(async (options: any) => {
  return {
    list: () => [
      {
        sourcePath: path.resolve(options.cwd || process.cwd(), options.rootWorkflowPath),
        parsedWorkflow: {
          meta: { name: "test-workflow", version: "1.0.0" },
          sourceHash: "dummy-hash",
          sourceText: "workflow {}"
        }
      }
    ]
  };
});

vi.mock("../../../src/workflow/discovery.js", () => {
  return {
    discoverWorkflowRegistry: (args: any) => discoverySpy(args)
  };
});

const TEMP_DIR = path.resolve("tests/temp-profile-run-precedence-unit");
const FIXTURE_WORKFLOW = path.join(TEMP_DIR, "test.workflow.js");

describe("Unit Tests: Run Profile Resolution & Precedence", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    // Write a dummy workflow file
    await fs.writeFile(
      FIXTURE_WORKFLOW,
      `export const meta = { name: "test-workflow", description: "test" };\nexport default { ok: true };`,
      "utf8"
    );
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("applies profile run options to config and runner when --profile is selected", async () => {
    const configYml = `
profiles:
  test-profile:
    description: "test profile"
    args:
      profileArg: "val1"
    context:
      profileCtx: "val2"
    run:
      provider: "gemini"
      model: "gemini-3.5-flash"
      concurrency: 5
      timeoutMs: 12000
      maxAgentCalls: 50
      failFast: true
      report: "json"
      thinkingEffort: "high"
      retry:
        maxAttempts: 3
        delayMs: 2000
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, configYml, "utf8");

    const runSpy = vi.fn().mockResolvedValue({
      status: "succeeded",
      agents: []
    } as unknown as WorkflowRunResult);
    const mockRunner: RuntimeRunner = { run: runSpy };

    await runWorkflowService({
      workflowFile: FIXTURE_WORKFLOW,
      rawOptions: {
        profile: "test-profile",
        config: configPath,
        cwd: TEMP_DIR,
        out: TEMP_DIR
      },
      deps: { runtimeRunner: mockRunner }
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
    const runArgs = runSpy.mock.calls[0][0];

    // Verify config properties reached final config
    expect(runArgs.config.defaultProvider).toBe("gemini");
    expect(runArgs.config.defaultModel).toBe("gemini-3.5-flash");
    expect(runArgs.config.concurrency).toBe(5);
    expect(runArgs.config.timeoutMs).toBe(12000);
    expect(runArgs.config.maxAgentCalls).toBe(50);
    expect(runArgs.config.failFast).toBe(true);
    expect(runArgs.config.reporting.mode).toBe("json");

    // Verify thinking effort, profileContextSeed and profileReport reached runner inputs
    expect(runArgs.cli.thinkingEffort).toBe("high");
    expect(runArgs.profileReport).toBeDefined();
    expect(runArgs.profileReport.selected).toBe("test-profile");
    expect(runArgs.profileContextSeed).toBeDefined();
    expect(runArgs.profileContextSeed.context.profileCtx).toBe("val2");

    // Verify retry policy was resolved correctly
    expect(runArgs.config.retry?.enabled).toBe(true);
    expect(runArgs.config.retry?.policy.maxAttempts).toBe(3);
    expect(runArgs.config.retry?.policy.delayMs).toBe(2000);

    // Verify resolution preceded discovery / precollect
    expect(precollectSpy).toHaveBeenCalledTimes(1);
    expect(discoverySpy).toHaveBeenCalledTimes(1);
    // Downstream discovery sees the resolved profile-derived concurrency/config
    expect(discoverySpy.mock.calls[0][0].maxLoopRounds).toBe(20);

    // Verify run-input.json contains the profile
    const runs = await fs.readdir(TEMP_DIR);
    const runDirName = runs.find(r => r.length === 36);
    expect(runDirName).toBeDefined();
    const runDir = path.join(TEMP_DIR, runDirName!);

    const profileJsonPath = path.join(runDir, "run-input.json.profile");
    await expect(fs.access(profileJsonPath)).rejects.toThrow();

    const runInputPath = path.join(runDir, "run-input.json");
    const runInputData = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    expect(runInputData.profile).toBeDefined();
    expect(runInputData.profile.selected).toBe("test-profile");
    expect(runInputData.profile.source).toBe("config");
    expect(runInputData.profile.resolved).toBeDefined();
    expect(runInputData.profile.hash).toBeTypeOf("string");
  });

  it("ensures explicit CLI flags override profile run options", async () => {
    const configYml = `
profiles:
  test-profile:
    run:
      provider: "gemini"
      model: "gemini-3.5-flash"
      concurrency: 5
      timeoutMs: 12000
      maxAgentCalls: 50
      failFast: true
      report: "json"
      thinkingEffort: "high"
      retry:
        maxAttempts: 3
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, configYml, "utf8");

    const runSpy = vi.fn().mockResolvedValue({
      status: "succeeded",
      agents: []
    } as unknown as WorkflowRunResult);
    const mockRunner: RuntimeRunner = { run: runSpy };

    await runWorkflowService({
      workflowFile: FIXTURE_WORKFLOW,
      rawOptions: {
        profile: "test-profile",
        config: configPath,
        cwd: TEMP_DIR,
        out: TEMP_DIR,
        provider: "mock",
        model: "my-cli-model",
        concurrency: "2",
        timeoutMs: "5000",
        maxAgentCalls: "10",
        failFast: false,
        report: "pretty",
        thinkingEffort: "low",
        retry: false // maps to noRetry / --no-retry
      },
      deps: { runtimeRunner: mockRunner }
    });

    const runArgs = runSpy.mock.calls[0][0];

    // Explicit overrides win
    expect(runArgs.config.defaultProvider).toBe("mock");
    expect(runArgs.config.defaultModel).toBe("my-cli-model");
    expect(runArgs.config.concurrency).toBe(2);
    expect(runArgs.config.timeoutMs).toBe(5000);
    expect(runArgs.config.maxAgentCalls).toBe(10);
    expect(runArgs.config.failFast).toBe(false);
    expect(runArgs.config.reporting.mode).toBe("pretty");
    expect(runArgs.cli.thinkingEffort).toBe("low");
    expect(runArgs.config.retry?.enabled).toBe(false);
  });

  it("shallow merges args, ensuring explicit --arg overrides collide but other profile args remain", async () => {
    const configYml = `
profiles:
  test-profile:
    args:
      arg1: "profile-val1"
      arg2: "profile-val2"
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, configYml, "utf8");

    const runSpy = vi.fn().mockResolvedValue({
      status: "succeeded",
      agents: []
    } as unknown as WorkflowRunResult);
    const mockRunner: RuntimeRunner = { run: runSpy };

    await runWorkflowService({
      workflowFile: FIXTURE_WORKFLOW,
      rawOptions: {
        profile: "test-profile",
        config: configPath,
        cwd: TEMP_DIR,
        out: TEMP_DIR,
        arg: ["arg2=cli-val2", "arg3=cli-val3"]
      },
      deps: { runtimeRunner: mockRunner }
    });

    const runArgs = runSpy.mock.calls[0][0];
    expect(runArgs.cli.args).toEqual({
      arg1: "profile-val1",
      arg2: "cli-val2",
      arg3: "cli-val3"
    });
  });

  it("keeps normal no-profile execution unchanged", async () => {
    const runSpy = vi.fn().mockResolvedValue({
      status: "succeeded",
      agents: []
    } as unknown as WorkflowRunResult);
    const mockRunner: RuntimeRunner = { run: runSpy };

    await runWorkflowService({
      workflowFile: FIXTURE_WORKFLOW,
      rawOptions: {
        cwd: TEMP_DIR,
        out: TEMP_DIR,
        concurrency: "6"
      },
      deps: { runtimeRunner: mockRunner }
    });

    const runArgs = runSpy.mock.calls[0][0];
    expect(runArgs.config.concurrency).toBe(6);
    expect(runArgs.profileReport).toBeUndefined();
    expect(runArgs.profileContextSeed).toBeUndefined();

    const runs = await fs.readdir(TEMP_DIR);
    const runDirName = runs.find(r => r.length === 36);
    expect(runDirName).toBeDefined();
    const runDir = path.join(TEMP_DIR, runDirName!);

    const profileJsonPath = path.join(runDir, "run-input.json.profile");
    await expect(fs.access(profileJsonPath)).rejects.toThrow();

    const runInputPath = path.join(runDir, "run-input.json");
    const runInputData = JSON.parse(await fs.readFile(runInputPath, "utf8"));
    expect(runInputData.profile).toBeUndefined();
  });
});
