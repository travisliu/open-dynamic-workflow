import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { mergeConfig } from "../../../src/config/merge.js";
import { loadConfig } from "../../../src/config/load.js";
import {
  BUILT_IN_DEFAULT_POLICY,
  resolveAgentRetryPolicy,
  resolveGlobalRetryPolicy
} from "../../../src/config/retry.js";
import { computeAgentFingerprint } from "../../../src/artifacts/call-cache.js";
import { createDsl } from "../../../src/workflow/dsl.js";
import type { OpenDynamicWorkflowConfig } from "../../../src/config/types.js";
import type { ResolvedRetryPolicy } from "../../../src/types/retry.js";

describe("Retry policy resolution and cache integration (Phase 2)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "phase-2-retry-acceptance-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should resolve global precedence and preserve resolved retry policy through config load wiring", async () => {
    // Arrange
    const fileRetry: OpenDynamicWorkflowConfig["retry"] = {
      delayMs: 250,
      jitter: false
    };
    const cliOverrides = {
      retryMaxAttempts: 5,
      retryBackoff: "fixed" as const
    };
    const configPath = join(tempDir, "config.yaml");
    await writeFile(
      configPath,
      [
        "retry:",
        "  delayMs: 250",
        "  jitter: false",
        ""
      ].join("\n")
    );

    const expectedGlobal = resolveGlobalRetryPolicy({
      configRetry: fileRetry,
      cliOverrides: {
        maxAttempts: cliOverrides.retryMaxAttempts,
        backoff: cliOverrides.retryBackoff
      }
    });
    const builtInOnly = resolveGlobalRetryPolicy({});

    // Act
    const merged = mergeConfig(DEFAULT_CONFIG, { retry: fileRetry }, cliOverrides);
    const loaded = await loadConfig({ cwd: tempDir, configPath, cli: cliOverrides });
    const agentResolved = resolveAgentRetryPolicy({
      globalPolicy: expectedGlobal,
      agentRetry: {
        delayMs: 125,
        maxAttempts: 2
      }
    });

    // Assert
    expect(builtInOnly).toEqual({
      enabled: false,
      policy: BUILT_IN_DEFAULT_POLICY,
      source: "default",
      disabledBy: "omitted"
    });
    expect(merged.retry).toEqual(expectedGlobal);
    expect(loaded.retry).toEqual(expectedGlobal);
    expect(loaded.retry).toEqual(merged.retry);
    expect(agentResolved).toEqual({
      enabled: true,
      policy: {
        maxAttempts: 2,
        delayMs: 125,
        backoff: "fixed",
        maxDelayMs: 30000,
        jitter: false,
        disableDelay: false
      },
      source: "agent"
    });
  });

  it("should keep retry:false disabled and prevent inherited retry fields from leaking to disabled agents", async () => {
    // Arrange
    const fileRetry: OpenDynamicWorkflowConfig["retry"] = false;
    const configPath = join(tempDir, "config.yaml");
    await writeFile(configPath, "retry: false\n");

    const enabledGlobal = resolveGlobalRetryPolicy({
      configRetry: {
        maxAttempts: 4,
        delayMs: 250,
        backoff: "exponential"
      }
    });

    // Act
    const merged = mergeConfig(DEFAULT_CONFIG, { retry: fileRetry }, {});
    const loaded = await loadConfig({ cwd: tempDir, configPath, cli: {} });
    const disabledAtAgentLevel = resolveAgentRetryPolicy({
      globalPolicy: enabledGlobal,
      agentRetry: false
    });

    // Assert
    expect(merged.retry).toEqual({
      enabled: false,
      policy: BUILT_IN_DEFAULT_POLICY,
      source: "disabled"
    });
    expect(loaded.retry).toEqual(merged.retry);
    expect(disabledAtAgentLevel).toEqual({
      enabled: false,
      policy: BUILT_IN_DEFAULT_POLICY,
      source: "disabled",
      disabledBy: "agent"
    });
    expect(disabledAtAgentLevel.policy).not.toEqual(enabledGlobal.policy);
  });

  it("should include the resolved retry policy in the cache fingerprint to ensure semantic consistency", () => {
    // Arrange
    const baseCall = {
      call: { id: "agent-1", prompt: "hello" },
      provider: "codex",
      model: "m1",
      timeoutMs: 1000,
      cwd: "/repo",
      providerConfig: { command: "codex", args: ["exec"] }
    };
    const enabledRetry = resolveGlobalRetryPolicy({
      configRetry: {
        maxAttempts: 2,
        delayMs: 250,
        backoff: "fixed",
        maxDelayMs: 5000,
        jitter: false,
        disableDelay: true
      }
    });
    const cliResolvedRetry: ResolvedRetryPolicy = {
      enabled: true,
      policy: {
        maxAttempts: 2,
        delayMs: 250,
        backoff: "fixed",
        maxDelayMs: 5000,
        jitter: false,
        disableDelay: true
      },
      source: "cli"
    };
    const reorderedEnabledRetry: ResolvedRetryPolicy = {
      source: "config",
      enabled: true,
      policy: {
        disableDelay: true,
        jitter: false,
        maxDelayMs: 5000,
        backoff: "fixed",
        delayMs: 250,
        maxAttempts: 2
      }
    };
    const disabledRetry = resolveAgentRetryPolicy({
      globalPolicy: enabledRetry,
      agentRetry: false
    });

    // Act
    const enabledFingerprint = computeAgentFingerprint({
      ...baseCall,
      retry: enabledRetry
    });
    const cliFingerprint = computeAgentFingerprint({
      ...baseCall,
      retry: cliResolvedRetry
    });
    const reorderedFingerprint = computeAgentFingerprint({
      ...baseCall,
      retry: reorderedEnabledRetry
    });
    const disabledFingerprint = computeAgentFingerprint({
      ...baseCall,
      retry: disabledRetry
    });
    const semanticVariants = [
      {
        retry: {
          ...enabledRetry,
          policy: { ...enabledRetry.policy, maxAttempts: 3 }
        }
      },
      {
        retry: {
          ...enabledRetry,
          policy: { ...enabledRetry.policy, delayMs: 500 }
        }
      },
      {
        retry: {
          ...enabledRetry,
          policy: { ...enabledRetry.policy, backoff: "exponential" as const }
        }
      },
      {
        retry: {
          ...enabledRetry,
          policy: { ...enabledRetry.policy, jitter: true }
        }
      },
      {
        retry: {
          ...enabledRetry,
          policy: { ...enabledRetry.policy, disableDelay: false }
        }
      }
    ].map((variant) =>
      computeAgentFingerprint({
        ...baseCall,
        retry: variant.retry
      })
    );

    // Assert
    expect(cliFingerprint).toBe(enabledFingerprint);
    expect(reorderedFingerprint).toBe(enabledFingerprint);
    expect(disabledFingerprint).not.toBe(enabledFingerprint);
    for (const fingerprint of semanticVariants) {
      expect(fingerprint).not.toBe(enabledFingerprint);
    }
  });

  it("should verify that resolved retry settings are included in runtime agent cache evaluation and hit-detection paths", async () => {
    const globalRetry = resolveGlobalRetryPolicy({
      configRetry: {
        maxAttempts: 3,
        delayMs: 500,
        backoff: "fixed",
        maxDelayMs: 5000,
        jitter: false,
        disableDelay: false
      }
    });
    const cachedRetry = resolveAgentRetryPolicy({
      globalPolicy: globalRetry,
      agentRetry: {
        delayMs: 250
      }
    });
    const runtimeRetry = resolveAgentRetryPolicy({
      globalPolicy: globalRetry,
      agentRetry: {
        delayMs: 750
      }
    });
    const fingerprint = computeAgentFingerprint({
      call: { id: "call-1", prompt: "hello" },
      provider: "mock",
      timeoutMs: 30000,
      cwd: "/workspace",
      retry: cachedRetry
    } as any);
    const scheduler = {
      schedule: vi.fn().mockResolvedValue({
        ok: true,
        status: "succeeded",
        id: "call-1",
        provider: "mock",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
        permissions: { mode: "default" }
      }),
      drain: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        aborted: false,
        abortReason: undefined,
        runningCount: 0,
        queuedCount: 0,
        completedCount: 0
      })
    };
    const runtime = {
      runId: "run-test-1",
      parsedWorkflow: {
        meta: { name: "test", description: "test" },
        body: "",
        sourcePath: "test.js",
        sourceText: "",
        sourceHash: "abc123"
      },
      config: {
        defaultProvider: "mock",
        concurrency: 1,
        timeoutMs: 30000,
        retry: runtimeRetry,
        providers: {},
        security: { allowWorkflowImports: false, passEnv: [], redactEnv: [] },
        reporting: { mode: "pretty", verbose: false },
        cwd: "/workspace",
        outDir: "/workspace/.open-dynamic-workflow/runs",
        cliArgs: {}
      },
      cli: {},
      args: {},
      cwd: "/workspace",
      artifactsDir: "/workspace/.open-dynamic-workflow/runs/run-test-1",
      agentResults: [],
      toolResults: [],
      scheduler,
      agentExecutor: { execute: vi.fn() },
      eventSink: { emit: vi.fn() },
      abortController: new AbortController(),
      agentCounter: 0,
      callSequence: 0,
      callCache: {
        readEnabled: true,
        writeIndex: true,
        previousEntries: new Map([[1, {
          kind: "agent",
          sequence: 1,
          callId: "call-1",
          fingerprint,
          status: "succeeded",
          resultPath: "agents/old/result.json",
          agentId: "old-agent"
        }]]),
        currentEntries: [],
        prefixCacheUsable: true
      }
    } as any;
    const dsl = createDsl(runtime);

    await dsl.agent({
      id: "call-1",
      prompt: "hello",
      retry: {
        delayMs: 750
      }
    });

    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    expect(runtime.callCache.prefixCacheUsable).toBe(false);
  });

  it("should invalidate previous agent cache entries if the retry configuration gets modified", async () => {
    const omittedGlobalRetry = resolveGlobalRetryPolicy({});
    const runtimeRetry = resolveAgentRetryPolicy({
      globalPolicy: omittedGlobalRetry,
      agentRetry: {
        delayMs: 750
      }
    });
    const cachedFingerprint = computeAgentFingerprint({
      call: { id: "call-1", prompt: "hello" },
      provider: "mock",
      timeoutMs: 30000,
      cwd: "/workspace"
    } as any);
    const runtimeFingerprint = computeAgentFingerprint({
      call: { id: "call-1", prompt: "hello" },
      provider: "mock",
      timeoutMs: 30000,
      cwd: "/workspace",
      retry: runtimeRetry
    } as any);

    expect(runtimeFingerprint).not.toBe(cachedFingerprint);

    const scheduler = {
      schedule: vi.fn().mockResolvedValue({
        ok: true,
        status: "succeeded",
        id: "call-1",
        provider: "mock",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
        permissions: { mode: "default" }
      }),
      drain: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        aborted: false,
        abortReason: undefined,
        runningCount: 0,
        queuedCount: 0,
        completedCount: 0
      })
    };
    const runtime = {
      runId: "run-test-1",
      parsedWorkflow: {
        meta: { name: "test", description: "test" },
        body: "",
        sourcePath: "test.js",
        sourceText: "",
        sourceHash: "abc123"
      },
      config: {
        defaultProvider: "mock",
        concurrency: 1,
        timeoutMs: 30000,
        providers: {},
        security: { allowWorkflowImports: false, passEnv: [], redactEnv: [] },
        reporting: { mode: "pretty", verbose: false },
        cwd: "/workspace",
        outDir: "/workspace/.open-dynamic-workflow/runs",
        cliArgs: {}
      },
      cli: {},
      args: {},
      cwd: "/workspace",
      artifactsDir: "/workspace/.open-dynamic-workflow/runs/run-test-1",
      agentResults: [],
      toolResults: [],
      scheduler,
      agentExecutor: { execute: vi.fn() },
      eventSink: { emit: vi.fn() },
      abortController: new AbortController(),
      agentCounter: 0,
      callSequence: 0,
      callCache: {
        readEnabled: true,
        writeIndex: true,
        previousEntries: new Map([[1, {
          kind: "agent",
          sequence: 1,
          callId: "call-1",
          fingerprint: cachedFingerprint,
          status: "succeeded",
          resultPath: "agents/old/result.json",
          agentId: "old-agent"
        }]]),
        currentEntries: [],
        prefixCacheUsable: true
      }
    } as any;
    const dsl = createDsl(runtime);

    await dsl.agent({
      id: "call-1",
      prompt: "hello",
      retry: {
        delayMs: 750
      }
    });

    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    expect(runtime.callCache.prefixCacheUsable).toBe(false);
  });
});
