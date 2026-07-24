import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { validateConfig } from "../../../src/config/schema.js";
import { parseRetryCliOptions } from "../../../src/cli/args.js";
import { runCommand } from "../../../src/cli/commands/run.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import type { CliRunOptions } from "../../../src/types/config.js";
import type { RetryConfigInput } from "../../../src/types/retry.js";
import type { RuntimeRunner, WorkflowRunResult } from "../../../src/runtime/public.js";
import * as fs from "node:fs";

import { precollectAllResourcesForLoad, checkDiscoveryPolicy } from "../../../src/discovery/precollect.js";
import { resolveWorkflowTarget } from "../../../src/workflow/resolve-target.js";
import { loadSharedAgentRegistry } from "../../../src/shared-agents/load.js";
import { loadToolRegistry } from "../../../src/tools/load.js";
import { discoverWorkflowRegistry } from "../../../src/workflow/discovery.js";
import { loadConfig } from "../../../src/config/load.js";
import {
  BUILT_IN_DEFAULT_POLICY,
  resolveAgentRetryPolicy,
  resolveGlobalRetryPolicy
} from "../../../src/config/retry.js";

const loadConfigCalls: any[] = [];
const runtimeExecutionOrder: string[] = [];

function createMockResolvedConfig() {
  return {
    ...DEFAULT_CONFIG,
    cwd: "/mock-cwd",
    outDir: "/mock-out",
    configPath: "/mock-config.yaml",
    defaultModel: "mock-model",
    cliArgs: {},
    _normalizedDiscovery: { workflow: {}, sharedAgents: {}, tools: {} },
    _configDiagnostics: []
  } as any;
}

const mockStoreInstance = {
  createRun: vi.fn().mockResolvedValue(undefined),
  writeJson: vi.fn().mockResolvedValue(undefined),
  writeFinalReport: vi.fn().mockResolvedValue(undefined),
  isRunCreated: vi.fn().mockReturnValue(true),
  getRunArtifacts: vi.fn().mockReturnValue({})
};

const mockReporterInstance = {
  handle: vi.fn(),
  start: vi.fn(),
  finish: vi.fn()
};

vi.mock("../../../src/config/load.js", () => ({
  loadConfig: vi.fn().mockImplementation(async (input: any) => {
    runtimeExecutionOrder.push("loadConfig");
    loadConfigCalls.push(input);
    return createMockResolvedConfig();
  })
}));

vi.mock("../../../src/discovery/precollect.js", () => ({
  precollectAllResourcesForLoad: vi.fn(),
  checkDiscoveryPolicy: vi.fn()
}));

vi.mock("../../../src/workflow/resolve-target.js", () => ({
  resolveWorkflowTarget: vi.fn()
}));

vi.mock("../../../src/shared-agents/load.js", () => ({
  loadSharedAgentRegistry: vi.fn()
}));

vi.mock("../../../src/tools/load.js", () => ({
  loadToolRegistry: vi.fn()
}));

vi.mock("../../../src/workflow/discovery.js", () => ({
  discoverWorkflowRegistry: vi.fn()
}));

vi.mock("../../../src/artifacts/run-store.js", () => ({
  FileSystemArtifactStore: vi.fn().mockImplementation(() => mockStoreInstance)
}));

vi.mock("../../../src/output/reporter.js", () => ({
  createReporter: vi.fn().mockImplementation(() => mockReporterInstance)
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true)
  };
});

describe("Retry configuration and CLI overrides validation (Phase 1)", () => {
  beforeEach(() => {
    loadConfigCalls.length = 0;
    runtimeExecutionOrder.length = 0;
    vi.clearAllMocks();

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(precollectAllResourcesForLoad).mockResolvedValue({
      workflow: {
        loadInput: { candidateFiles: ["workflows/acceptance-workflow.js"], discoveryPolicy: { exclude: [] } },
        collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
      },
      sharedAgents: {
        loadInput: { candidateFiles: ["agents/acceptance-agent.js"], discoveryPolicy: { exclude: [] } },
        collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
      },
      tools: {
        loadInput: { candidateFiles: ["tools/acceptance-tool.js"], discoveryPolicy: { exclude: [] } },
        collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
      }
    } as any);
    vi.mocked(checkDiscoveryPolicy).mockResolvedValue(undefined);
    vi.mocked(resolveWorkflowTarget).mockResolvedValue({
      workflowFile: "workflows/acceptance-workflow.js",
      workflowFileRelative: "workflows/acceptance-workflow.js",
      candidatePaths: [],
      requestedTarget: "workflows/acceptance-workflow.js",
      workflowName: "acceptance-workflow"
    } as any);
    vi.mocked(loadSharedAgentRegistry).mockResolvedValue({ registry: "sharedAgents" } as any);
    vi.mocked(loadToolRegistry).mockResolvedValue({ registry: "tools" } as any);
    vi.mocked(discoverWorkflowRegistry).mockResolvedValue({
      list: () => [
        {
          sourcePath: "/mock-cwd/workflows/acceptance-workflow.js",
          name: "acceptance-workflow",
          parsedWorkflow: {
            meta: { description: "acceptance workflow", phases: [], version: "1.0.0" },
            sourceText: "workflow source",
            sourceHash: "hash"
          }
        }
      ]
    } as any);
    vi.mocked(loadConfig).mockImplementation(async (input: any) => {
      runtimeExecutionOrder.push("loadConfig");
      loadConfigCalls.push(input);
      return createMockResolvedConfig();
    });
  });

  it("should successfully validate omitted config, explicit disable, or valid retry config objects", () => {
    // Arrange
    const validRetryConfig: RetryConfigInput = {
      maxAttempts: 3,
      delayMs: 250,
      maxDelayMs: 1000,
      backoff: "exponential",
      jitter: true,
      disableDelay: false
    };
    const omittedRetryConfig = {
      ...DEFAULT_CONFIG
    };
    const disabledRetryConfig = {
      ...DEFAULT_CONFIG,
      retry: false
    };
    const validConfig = {
      ...DEFAULT_CONFIG,
      retry: validRetryConfig
    };

    // Act & Assert
    expect(() => validateConfig(omittedRetryConfig)).not.toThrow();
    expect(() => validateConfig(disabledRetryConfig)).not.toThrow();
    expect(() => validateConfig(validConfig)).not.toThrow();
  });

  it("should raise validation errors for incorrect retry types, negative bounds, invalid backoff options, or forbidden keys", () => {
    // Arrange
    const invalidCases = [
      {
        label: "string retry",
        config: {
          ...DEFAULT_CONFIG,
          retry: "yes" as any
        },
        message: "Config value 'retry' must be an object."
      },
      {
        label: "array retry",
        config: {
          ...DEFAULT_CONFIG,
          retry: [] as any
        },
        message: "Config value 'retry' must be an object."
      },
      {
        label: "null retry",
        config: {
          ...DEFAULT_CONFIG,
          retry: null as any
        },
        message: "Config value 'retry' must be an object."
      },
      {
        label: "zero retry.maxAttempts",
        config: {
          ...DEFAULT_CONFIG,
          retry: { maxAttempts: 0 }
        },
        message: "Config value 'retry.maxAttempts' must be a positive integer."
      },
      {
        label: "negative retry.delayMs",
        config: {
          ...DEFAULT_CONFIG,
          retry: { delayMs: -1 }
        },
        message: "Config value 'retry.delayMs' must be a non-negative integer."
      },
      {
        label: "negative retry.maxDelayMs",
        config: {
          ...DEFAULT_CONFIG,
          retry: { maxDelayMs: -1 }
        },
        message: "Config value 'retry.maxDelayMs' must be a non-negative integer."
      },
      {
        label: "invalid retry.backoff",
        config: {
          ...DEFAULT_CONFIG,
          retry: { backoff: "linear" as any }
        },
        message: "Config value 'retry.backoff' must be 'fixed' or 'exponential'."
      },
      {
        label: "retryOn",
        config: {
          ...DEFAULT_CONFIG,
          retry: { retryOn: ["provider_error"] } as any
        },
        message:
          "retryOn is not supported in experimental retry v1. Retry eligibility is runtime-defined; configure maxAttempts and delay behavior only."
      },
      {
        label: "retryReasons",
        config: {
          ...DEFAULT_CONFIG,
          retry: { retryReasons: ["provider_error"] } as any
        },
        message:
          "retryReasons is not supported in experimental retry v1. Retry eligibility is runtime-defined; configure maxAttempts and delay behavior only."
      },
      {
        label: "retryOnErrors",
        config: {
          ...DEFAULT_CONFIG,
          retry: { retryOnErrors: ["provider_error"] } as any
        },
        message:
          "retryOnErrors is not supported in experimental retry v1. Retry eligibility is runtime-defined; configure maxAttempts and delay behavior only."
      },
      {
        label: "errorCategories",
        config: {
          ...DEFAULT_CONFIG,
          retry: { errorCategories: ["provider_error"] } as any
        },
        message:
          "errorCategories is not supported in experimental retry v1. Retry eligibility is runtime-defined; configure maxAttempts and delay behavior only."
      }
    ];

    // Assert
    for (const testCase of invalidCases) {
      // Act
      const validate = () => validateConfig(testCase.config);

      // Assert
      expect(validate).toThrow(OpenDynamicWorkflowError);
      try {
        validate();
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.CONFIG_VALIDATION_ERROR);
        expect(error.message).toBe(testCase.message);
      }
    }
  });

  it("should fail validation with explicit diagnostics when loaded through config parsing", async () => {
    // Arrange
    const tempDir = join(tmpdir(), "phase-1-retry-load-acceptance-" + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.yaml");
    const { loadConfig: realLoadConfig } = await vi.importActual<typeof import("../../../src/config/load.js")>(
      "../../../src/config/load.js"
    );

    // Act
    fs.writeFileSync(
      configPath,
      [
        "retry:",
        "  maxAttempts: abc",
        ""
      ].join("\n")
    );

    // Assert
    await expect(
      realLoadConfig({ cwd: tempDir, configPath, cli: {} })
    ).rejects.toMatchObject({
      code: ErrorCode.CONFIG_VALIDATION_ERROR,
      message: "Config value 'retry.maxAttempts' must be a positive integer."
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should parse CLI flags into correct configuration overrides or raise CLI usage errors on bad inputs", () => {
    // Arrange
    const rawOptions = {
      retryMaxAttempts: "4",
      retryDelayMs: "250",
      retryMaxDelayMs: "1500",
      retryBackoff: "fixed",
      retryDisableDelay: true
    };
    const expectedOverrides: Pick<
      CliRunOptions,
      "retryMaxAttempts" | "retryDelayMs" | "retryMaxDelayMs" | "retryBackoff" | "retryDisableDelay"
    > = {
      retryMaxAttempts: 4,
      retryDelayMs: 250,
      retryMaxDelayMs: 1500,
      retryBackoff: "fixed",
      retryDisableDelay: true
    };

    // Act
    const parsed = parseRetryCliOptions(rawOptions);

    // Assert
    expect(parsed).toEqual(expectedOverrides);
    expect(parseRetryCliOptions({ retry: false })).toEqual({ noRetry: true });
    expect(parseRetryCliOptions({ noRetry: true })).toEqual({ noRetry: true });

    for (const invalidOptions of [
      { retryMaxAttempts: "0" },
      { retryDelayMs: "-1" },
      { retryBackoff: "linear" },
      { retry: false, retryMaxAttempts: "2" },
      { noRetry: true, retryDelayMs: "10" }
    ]) {
      expect(() => parseRetryCliOptions(invalidOptions)).toThrow(OpenDynamicWorkflowError);
      try {
        parseRetryCliOptions(invalidOptions);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.CLI_USAGE_ERROR);
      }
    }
  });

  it("should merge config sources field-by-field and properly resolve precedence between global and agent-level settings", () => {
    // Arrange
    const configRetry = {
      delayMs: 250,
      jitter: false
    };
    const cliOverrides = {
      maxAttempts: 5,
      backoff: "fixed" as const,
      disableDelay: true
    };

    // Act
    const resolvedGlobal = resolveGlobalRetryPolicy({
      configRetry,
      cliOverrides
    });
    const resolvedAgent = resolveAgentRetryPolicy({
      globalPolicy: resolvedGlobal,
      agentRetry: {
        maxAttempts: 2,
        delayMs: 125
      }
    });
    const resolvedAfterCliNoRetry = resolveAgentRetryPolicy({
      globalPolicy: resolveGlobalRetryPolicy({
        configRetry: { maxAttempts: 5 },
        cliOverrides: { noRetry: true }
      }),
      agentRetry: {
        maxAttempts: 3,
        delayMs: 75
      }
    });
    const hardDisabledGlobal = resolveGlobalRetryPolicy({
      configRetry: false
    });
    const hardDisabledAgent = resolveAgentRetryPolicy({
      globalPolicy: hardDisabledGlobal,
      agentRetry: {
        maxAttempts: 3
      }
    });
    const explicitAgentDisable = resolveAgentRetryPolicy({
      globalPolicy: resolvedGlobal,
      agentRetry: false
    });

    // Assert
    expect(resolvedGlobal).toEqual({
      enabled: true,
      policy: {
        maxAttempts: 5,
        delayMs: 250,
        backoff: "fixed",
        maxDelayMs: 30000,
        jitter: false,
        disableDelay: true
      },
      source: "cli"
    });
    expect(resolvedAgent).toEqual({
      enabled: true,
      policy: {
        maxAttempts: 2,
        delayMs: 125,
        backoff: "fixed",
        maxDelayMs: 30000,
        jitter: false,
        disableDelay: true
      },
      source: "agent"
    });
    expect(resolvedAfterCliNoRetry).toEqual({
      enabled: true,
      policy: {
        maxAttempts: 3,
        delayMs: 75,
        backoff: "exponential",
        maxDelayMs: 30000,
        jitter: true,
        disableDelay: false
      },
      source: "agent"
    });
    expect(hardDisabledGlobal).toEqual({
      enabled: false,
      policy: BUILT_IN_DEFAULT_POLICY,
      source: "disabled"
    });
    expect(hardDisabledAgent).toEqual({
      enabled: false,
      policy: BUILT_IN_DEFAULT_POLICY,
      source: "disabled"
    });
    expect(explicitAgentDisable).toEqual({
      enabled: false,
      policy: BUILT_IN_DEFAULT_POLICY,
      source: "disabled",
      disabledBy: "agent"
    });
  });

  it("should pass parsed CLI retry options down into the runtime environment before workflow execution runs", async () => {
    // Arrange
    const runtimeRunner: RuntimeRunner = {
      run: vi.fn().mockImplementation(async () => {
        runtimeExecutionOrder.push("runtimeRunner.run");
        return {
          schemaVersion: "open-dynamic-workflow.report.v1",
          runId: "acceptance-run",
          status: "succeeded",
          durationMs: 1,
          artifactsDir: "/mock-out/acceptance-run",
          agents: []
        } as WorkflowRunResult;
      })
    };
    const rawOptions = {
      cwd: "/mock-cwd",
      retryMaxAttempts: "5",
      retryDelayMs: "300",
      retryMaxDelayMs: "1200",
      retryBackoff: "exponential",
      retryDisableDelay: true
    };
    const expectedOverrides = parseRetryCliOptions(rawOptions);

    // Act
    await runCommand({
      workflowFile: "workflows/acceptance-workflow.js",
      rawOptions,
      deps: { runtimeRunner }
    });

    // Assert
    expect(loadConfigCalls).toHaveLength(2);
    expect(loadConfigCalls[0]).toEqual(
      expect.objectContaining({
        cwd: "/mock-cwd",
        cli: expect.objectContaining(expectedOverrides)
      })
    );
    expect(runtimeExecutionOrder).toEqual(["loadConfig", "loadConfig", "runtimeRunner.run"]);
    expect(vi.mocked(runtimeRunner.run)).toHaveBeenCalledTimes(1);
    expect(
      loadConfigCalls[1].cli
    ).toEqual(expect.objectContaining(expectedOverrides));
  });
});
