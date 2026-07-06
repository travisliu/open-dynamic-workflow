import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { OpenDynamicWorkflowConfig } from "../../../src/config/types.js";
import type { ResolvedRetryPolicy } from "../../../src/types/retry.js";

describe("Phase 2 retry acceptance coverage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "phase-2-retry-acceptance-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("resolves global precedence and preserves the resolved retry policy through merge/load wiring", async () => {
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

  it("keeps retry:false disabled and prevents inherited retry fields from leaking through", async () => {
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

  it("includes resolved retry in the agent fingerprint and keeps semantic identity stable", () => {
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
    expect(reorderedFingerprint).toBe(enabledFingerprint);
    expect(disabledFingerprint).not.toBe(enabledFingerprint);
    for (const fingerprint of semanticVariants) {
      expect(fingerprint).not.toBe(enabledFingerprint);
    }
  });
});
