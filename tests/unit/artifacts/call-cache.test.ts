import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  computeAgentFingerprint,
  computeToolFingerprint,
  findPrefixCacheHit,
  loadRuntimeCallCache,
  materializeCachedAgentResult,
  materializeCachedToolResult,
  recordAgentCall,
  recordToolCall,
  type RuntimeCallCache
} from "../../../src/artifacts/call-cache.js";
import type { ArtifactStore } from "../../../src/types/artifacts.js";
import type { ResolvedRetryPolicy } from "../../../src/types/retry.js";

const TEMP_DIR = path.resolve("tests/temp-call-cache-unit");

function makeCache(entries: any[]): RuntimeCallCache {
  return {
    readEnabled: true,
    writeIndex: true,
    previousEntries: new Map(entries.map((entry) => [entry.sequence, entry])),
    currentEntries: [],
    prefixCacheUsable: true
  };
}

describe("call cache", () => {
  const mockProviderSelection = {
    schemaVersion: "open-dynamic-workflow.provider-selection.v1",
    selection: {
      requestedProvider: "codex",
      requestedProviderSource: "agent",
      resolvedProvider: "codex"
    },
    resolvedExecution: {
      timeoutMs: 120000,
      retry: {
        enabled: false,
        maxAttempts: 1,
        delayMs: 1000,
        backoff: "fixed",
        maxDelayMs: 1000,
        jitter: false,
        disableDelay: false
      }
    },
    sources: {
      provider: "agent",
      timeoutMs: "builtIn",
      retry: "builtIn"
    }
  } as any;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("computes stable agent fingerprints and changes when provider-relevant inputs change", () => {
    const base = {
      call: { id: "a", prompt: "hello", metadata: { b: 2, a: 1 } },
      provider: "codex",
      model: "m1",
      timeoutMs: 1000,
      cwd: "/repo",
      providerConfig: { args: ["exec"], command: "codex" }
    };

    const first = computeAgentFingerprint(base);
    const reordered = computeAgentFingerprint({
      ...base,
      call: { id: "a", prompt: "hello", metadata: { a: 1, b: 2 } },
      providerConfig: { command: "codex", args: ["exec"] }
    });
    const changed = computeAgentFingerprint({ ...base, call: { id: "a", prompt: "changed" } });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("computes agent fingerprints including resolved thinking effort", () => {
    const base = {
      call: { id: "a", prompt: "hello" },
      provider: "codex",
      model: "m1",
      timeoutMs: 1000,
      cwd: "/repo",
      providerConfig: { args: ["exec"], command: "codex" },
      thinkingEffort: "medium" as const
    };

    const first = computeAgentFingerprint(base);
    const identical = computeAgentFingerprint({ ...base });
    const differentEffort = computeAgentFingerprint({ ...base, thinkingEffort: "high" as const });
    const undefinedEffort = computeAgentFingerprint({ ...base, thinkingEffort: undefined });

    expect(identical).toBe(first);
    expect(differentEffort).not.toBe(first);
    expect(undefinedEffort).not.toBe(first);
  });

  it("computes agent fingerprints including resolved retry policy", () => {
    const base = {
      call: { id: "a", prompt: "hello" },
      provider: "codex",
      model: "m1",
      timeoutMs: 1000,
      cwd: "/repo",
      providerConfig: { args: ["exec"], command: "codex" }
    };

    const baseRetryPolicy: ResolvedRetryPolicy = {
      enabled: true,
      policy: {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: "exponential" as const,
        maxDelayMs: 5000,
        jitter: true,
        disableDelay: false
      },
      source: "config"
    };

    const first = computeAgentFingerprint({ ...base, retry: baseRetryPolicy });
    const identical = computeAgentFingerprint({ ...base, retry: { ...baseRetryPolicy } });
    const withoutRetry = computeAgentFingerprint(base);
    const undefinedRetry = computeAgentFingerprint({ ...base, retry: undefined });

    // unchanged retry policy leaves the existing fingerprint stable
    expect(undefinedRetry).toBe(withoutRetry);
    // retry changes fingerprint from base without retry
    expect(first).not.toBe(withoutRetry);

    // identical resolved retry policy yields the same fingerprint
    expect(identical).toBe(first);

    const cliSourceRetry: ResolvedRetryPolicy = {
      enabled: true,
      policy: {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: "exponential" as const,
        maxDelayMs: 5000,
        jitter: true,
        disableDelay: false
      },
      source: "cli"
    };
    const cliFingerprint = computeAgentFingerprint({ ...base, retry: cliSourceRetry });
    expect(cliFingerprint).toBe(first);

    // changing only maxAttempts changes the fingerprint
    const diffMaxAttempts = computeAgentFingerprint({
      ...base,
      retry: {
        ...baseRetryPolicy,
        policy: { ...baseRetryPolicy.policy, maxAttempts: 5 }
      }
    });
    expect(diffMaxAttempts).not.toBe(first);

    // changing only delay settings changes the fingerprint
    const diffDelay = computeAgentFingerprint({
      ...base,
      retry: {
        ...baseRetryPolicy,
        policy: { ...baseRetryPolicy.policy, delayMs: 2000 }
      }
    });
    expect(diffDelay).not.toBe(first);

    // changing only backoff settings changes the fingerprint
    const diffBackoff = computeAgentFingerprint({
      ...base,
      retry: {
        ...baseRetryPolicy,
        policy: { ...baseRetryPolicy.policy, backoff: "fixed" as const }
      }
    });
    expect(diffBackoff).not.toBe(first);

    // changing jitter changes the fingerprint
    const diffJitter = computeAgentFingerprint({
      ...base,
      retry: {
        ...baseRetryPolicy,
        policy: { ...baseRetryPolicy.policy, jitter: false }
      }
    });
    expect(diffJitter).not.toBe(first);

    // changing disableDelay changes the fingerprint
    const diffDisableDelay = computeAgentFingerprint({
      ...base,
      retry: {
        ...baseRetryPolicy,
        policy: { ...baseRetryPolicy.policy, disableDelay: true }
      }
    });
    expect(diffDisableDelay).not.toBe(first);

    // changing retry: false versus an enabled policy changes the fingerprint
    const disabledRetry: ResolvedRetryPolicy = {
      enabled: false,
      policy: {
        maxAttempts: 1,
        delayMs: 0,
        backoff: "fixed" as const,
        maxDelayMs: 0,
        jitter: false,
        disableDelay: true
      },
      source: "disabled"
    };
    const disabledFp = computeAgentFingerprint({ ...base, retry: disabledRetry });
    expect(disabledFp).not.toBe(first);

    // unrelated object key ordering does not change the fingerprint
    const reorderedRetry: ResolvedRetryPolicy = {
      source: "config",
      enabled: true,
      policy: {
        backoff: "exponential" as const,
        maxAttempts: 3,
        disableDelay: false,
        jitter: true,
        maxDelayMs: 5000,
        delayMs: 1000
      }
    };
    const reorderedFp = computeAgentFingerprint({ ...base, retry: reorderedRetry });
    expect(reorderedFp).toBe(first);

    // absence of retry versus explicit disabled retry produces different fingerprints
    const absenceRetry: ResolvedRetryPolicy = {
      enabled: false,
      policy: {
        maxAttempts: 1,
        delayMs: 1000,
        backoff: "exponential" as const,
        maxDelayMs: 30000,
        jitter: true,
        disableDelay: false
      },
      source: "default",
      disabledBy: "omitted"
    };

    const explicitDisabledRetry: ResolvedRetryPolicy = {
      enabled: false,
      policy: {
        maxAttempts: 1,
        delayMs: 1000,
        backoff: "exponential" as const,
        maxDelayMs: 30000,
        jitter: true,
        disableDelay: false
      },
      source: "disabled",
      disabledBy: "agent"
    };

    const absenceFp = computeAgentFingerprint({ ...base, retry: absenceRetry });
    const explicitDisabledFp = computeAgentFingerprint({ ...base, retry: explicitDisabledRetry });
    expect(absenceFp).toBe(explicitDisabledFp);
  });


  it("computes stable tool fingerprints and changes when tool-relevant inputs change", () => {
    const base = {
      definitionId: "t1",
      args: { a: 1, b: 2 },
      timeoutMs: 1000,
      metadata: { m: 1 },
      sourcePath: "/tools/t1.ts",
      definitionVersion: "1.0.0"
    };

    const first = computeToolFingerprint(base);
    const reordered = computeToolFingerprint({
      ...base,
      args: { b: 2, a: 1 }
    });
    const changedArgs = computeToolFingerprint({ ...base, args: { a: 2 } });
    const changedVersion = computeToolFingerprint({ ...base, definitionVersion: "1.0.1" });

    expect(reordered).toBe(first);
    expect(changedArgs).not.toBe(first);
    expect(changedVersion).not.toBe(first);
  });

  it("uses longest-prefix matching and disables later hits after the first miss (kind aware)", () => {
    const cache = makeCache([
      { kind: "agent", sequence: 1, callId: "a", fingerprint: "fp-a", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" },
      { kind: "tool", sequence: 2, callId: "t", fingerprint: "fp-t", status: "succeeded", resultPath: "tools/t/output.json", toolCallId: "t", definitionId: "t-def" },
      { kind: "agent", sequence: 3, callId: "c", fingerprint: "fp-c", status: "succeeded", resultPath: "agents/c/normalized-result.json", agentId: "c" }
    ]);

    expect(findPrefixCacheHit({ cache, kind: "agent", sequence: 1, callId: "a", fingerprint: "fp-a" })?.kind).toBe("agent");
    
    // Kind mismatch
    expect(findPrefixCacheHit({ cache, kind: "tool", sequence: 1, callId: "a", fingerprint: "fp-a" })).toBeUndefined();
    expect(cache.prefixCacheUsable).toBe(false);

    // After miss, nothing works
    expect(findPrefixCacheHit({ cache, kind: "tool", sequence: 2, callId: "t", fingerprint: "fp-t" })).toBeUndefined();
  });

  it("treats id/label as an additional guard when present", () => {
    const cache = makeCache([
      { kind: "agent", sequence: 1, callId: "old-id", fingerprint: "fp", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" }
    ]);

    expect(findPrefixCacheHit({ cache, kind: "agent", sequence: 1, callId: "new-id", fingerprint: "fp" })).toBeUndefined();
  });

  it("loads legacy agent-only entries as kind: 'agent'", async () => {
    const runRoot = path.join(TEMP_DIR, "run-legacy");
    await fs.mkdir(path.join(runRoot, "agents/a"), { recursive: true });
    await fs.writeFile(path.join(runRoot, "manifest.json"), JSON.stringify({ runId: "run-legacy" }), "utf8");
    await fs.writeFile(path.join(runRoot, "cache-index.json"), JSON.stringify({
      schemaVersion: "open-dynamic-workflow.cache-index.v1",
      entries: [
        { sequence: 1, callId: "a", fingerprint: "fp", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" }
      ]
    }), "utf8");

    const cache = await loadRuntimeCallCache({
      previousRunDir: path.join(TEMP_DIR, "run-legacy")
    });

    const entry = cache.previousEntries.get(1);
    expect(entry?.kind).toBe("agent");
    expect((entry as any).agentId).toBe("a");

    // Can still find it with kind: agent
    expect(findPrefixCacheHit({ cache, kind: "agent", sequence: 1, callId: "a", fingerprint: "fp" })).toBeDefined();
  });

  it("rebuilds successful ordered entries from calls.jsonl when cache-index.json is missing", async () => {
    const runRoot = path.join(TEMP_DIR, "run-rebuild");
    await fs.mkdir(path.join(runRoot, "agents/a"), { recursive: true });
    await fs.writeFile(path.join(runRoot, "manifest.json"), JSON.stringify({ runId: "run-rebuild", workflowHash: "hash" }), "utf8");
    await fs.writeFile(path.join(runRoot, "agents/a/normalized-result.json"), JSON.stringify("ok"), "utf8");
    await fs.writeFile(path.join(runRoot, "calls.jsonl"), [
      JSON.stringify({ kind: "agent", sequence: 1, callId: "a", fingerprint: "fp", status: "failed", resultPath: "agents/a/normalized-result.json", agentId: "a" }),
      JSON.stringify({ kind: "agent", sequence: 1, callId: "a", fingerprint: "fp2", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" }),
      "not-json"
    ].join("\n"), "utf8");

    const cache = await loadRuntimeCallCache({
      previousRunDir: path.join(TEMP_DIR, "run-rebuild")
    });

    expect(cache.previousEntries.get(1)?.fingerprint).toBe("fp2");
  });

  it("materializes cached agent results into current run root and preserves semantic fields in workflow-visible result", async () => {
    const prevRun = path.join(TEMP_DIR, "prev-agent-run");
    await fs.mkdir(path.join(prevRun, "agents/old-a"), { recursive: true });
    await fs.writeFile(path.join(prevRun, "agents/old-a/normalized-result.json"), JSON.stringify("ok"), "utf8");
    const fakePrevResult = {
      ok: true,
      status: "succeeded",
      id: "old-a",
      provider: "codex",
      model: "gpt-4",
      text: "ok",
      stdout: "hello stdout",
      stderr: "hello stderr",
      exitCode: 0,
      durationMs: 1234,
      artifacts: {
        dir: "agents/old-a",
        promptPath: "agents/old-a/prompt.txt",
        stdoutPath: "agents/old-a/stdout.log",
        stderrPath: "agents/old-a/stderr.log"
      },
      permissions: { mode: "default" }
    };
    await fs.writeFile(path.join(prevRun, "agents/old-a/agent-result.json"), JSON.stringify(fakePrevResult), "utf8");

    let writtenFiles: Record<string, any> = {};
    const store = {
      writeText: async (relativePath: string, content: string) => { writtenFiles[relativePath] = content; },
      writeJson: async (relativePath: string, data: any) => { writtenFiles[relativePath] = data; }
    } as any;

    const result = await materializeCachedAgentResult({
      store,
      previousRunRoot: prevRun,
      previousRunId: "prev-run",
      entry: {
        kind: "agent",
        sequence: 1,
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "agents/old-a/normalized-result.json",
        agentId: "old-a",
        agentResultPath: "agents/old-a/agent-result.json"
      },
      currentAgentId: "new-a",
      provider: "codex",
      permissions: { mode: "default" },
      providerSelection: mockProviderSelection
    });

    expect(result.ok).toBe(true);
    expect(result.durationMs).toBe(1234);
    expect(result.stdout).toBe("hello stdout");
    expect(result.stderr).toBe("hello stderr");
    expect(result.cache).toBeUndefined();

    const keys = Object.keys(result);
    for (const key of keys) {
      expect((result as any)[key]).not.toBeUndefined();
    }

    const artifactResult = (result as any).__artifactResult;
    expect(artifactResult).toBeDefined();
    expect(artifactResult.durationMs).toBe(0);
    expect(artifactResult.stdout).toBe("");
    expect(artifactResult.stderr).toBe("");
    expect(artifactResult.cache).toEqual({
      hit: true,
      callId: undefined,
      previousRunId: "prev-run",
      previousAgentId: "old-a"
    });

    expect(writtenFiles["agents/new-a/normalized-result.json"]).toEqual("ok");
    expect(writtenFiles["agents/new-a/cache-hit.json"]).toMatchObject({
      sequence: 1,
      previousAgentId: "old-a",
      previousRunId: "prev-run"
    });
  });

  it("materializes cached agent retry summary and updates summaryPath", async () => {
    const prevRun = path.join(TEMP_DIR, "prev-run-retry");
    await fs.mkdir(path.join(prevRun, "agents/old-a"), { recursive: true });
    await fs.writeFile(path.join(prevRun, "agents/old-a/normalized-result.json"), JSON.stringify("ok"), "utf8");

    const fakePrevResult = {
      ok: true,
      status: "succeeded",
      id: "old-a",
      stdout: "hello stdout",
      stderr: "hello stderr",
      durationMs: 1234,
      retry: {
        enabled: true,
        exhausted: false,
        maxAttempts: 3,
        attemptsStarted: 2,
        finalAttempt: 2,
        summaryPath: "agents/old-a/retry-summary.json",
        attempts: []
      },
      permissions: { mode: "default" }
    };
    await fs.writeFile(path.join(prevRun, "agents/old-a/agent-result.json"), JSON.stringify(fakePrevResult), "utf8");

    const fakeRetrySummary = {
      schemaVersion: "open-dynamic-workflow.retry-summary.v1",
      enabled: true,
      exhausted: false,
      maxAttempts: 3,
      attemptsStarted: 2,
      finalAttempt: 2,
      finalStatus: "succeeded",
      attempts: []
    };
    await fs.writeFile(path.join(prevRun, "agents/old-a/retry-summary.json"), JSON.stringify(fakeRetrySummary), "utf8");

    let writtenFiles: Record<string, any> = {};
    const store = {
      writeText: async (relativePath: string, content: string) => { writtenFiles[relativePath] = content; },
      writeJson: async (relativePath: string, data: any) => { writtenFiles[relativePath] = data; }
    } as any;

    const result = await materializeCachedAgentResult({
      store,
      previousRunRoot: prevRun,
      previousRunId: "prev-run",
      entry: {
        kind: "agent",
        sequence: 1,
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "agents/old-a/normalized-result.json",
        agentId: "old-a",
        agentResultPath: "agents/old-a/agent-result.json"
      },
      currentAgentId: "new-a",
      provider: "codex",
      permissions: { mode: "default" },
      providerSelection: mockProviderSelection
    });

    expect(result.ok).toBe(true);
    expect(result.retry).toBeDefined();
    expect(result.retry?.summaryPath).toBe("agents/new-a/retry-summary.json");
    expect(writtenFiles["agents/new-a/retry-summary.json"]).toEqual(fakeRetrySummary);

    const artifactResult = (result as any).__artifactResult;
    expect(artifactResult.retry?.summaryPath).toBe("agents/new-a/retry-summary.json");
  });

  it("materializes cached tool results into current run root", async () => {
    const prevRun = path.join(TEMP_DIR, "prev-tool-run");
    await fs.mkdir(path.join(prevRun, "tools/old-t"), { recursive: true });
    await fs.writeFile(path.join(prevRun, "tools/old-t/output.json"), JSON.stringify({ out: "ok" }), "utf8");

    let writtenFiles: Record<string, any> = {};
    const store = {
      writeJson: async (relativePath: string, data: any) => { writtenFiles[relativePath] = data; }
    } as any;

    const result = await materializeCachedToolResult({
      store,
      previousRunRoot: prevRun,
      previousRunId: "prev-run-id",
      entry: {
        kind: "tool",
        sequence: 1,
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "tools/old-t/output.json",
        toolCallId: "old-t",
        definitionId: "t-def"
      },
      currentToolCallId: "new-t",
      definitionId: "t-def",
      failureMode: "throw",
      workflowInvocationId: "w1",
      args: { testArg: "argVal" }
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ out: "ok" });
    expect(result.artifactPath).toBe("tools/new-t/output.json");
    expect(writtenFiles["tools/new-t/output.json"]).toEqual({ out: "ok" });
    expect(writtenFiles["tools/new-t/input.json"]).toEqual({ testArg: "argVal" });
    expect(writtenFiles["tools/new-t/cache-hit.json"]).toMatchObject({
      previousToolCallId: "old-t",
      previousRunId: "prev-run-id"
    });
    expect(writtenFiles["tools/new-t/metadata.json"]).toMatchObject({
      schemaVersion: "open-dynamic-workflow.tool.v1",
      toolCallId: "new-t",
      definition: "t-def",
      workflowInvocationId: "w1",
      status: "succeeded",
      queuedAt: expect.any(String),
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      queueDurationMs: 0,
      executionDurationMs: 0,
      durationMs: 0,
      cacheMaterializationDurationMs: expect.any(Number)
    });
  });

  it("materializes cached tool results with loop origin, custom metadata, and args", async () => {
    const prevRun = path.join(TEMP_DIR, "prev-tool-run-loop");
    await fs.mkdir(path.join(prevRun, "tools/old-t"), { recursive: true });
    await fs.writeFile(path.join(prevRun, "tools/old-t/output.json"), JSON.stringify({ out: "ok" }), "utf8");

    let writtenFiles: Record<string, any> = {};
    const store = {
      writeJson: async (relativePath: string, data: any) => { writtenFiles[relativePath] = data; }
    } as any;

    const loopOrigin = {
      kind: "loop-round" as const,
      loopId: "my-loop",
      loopLabel: "my-loop-label",
      roundIndex: 2,
      roundNumber: 3,
      roundId: "r-3"
    };

    const result = await materializeCachedToolResult({
      store,
      previousRunRoot: prevRun,
      previousRunId: "prev-run-id",
      entry: {
        kind: "tool",
        sequence: 2,
        fingerprint: "fp-loop",
        status: "succeeded",
        resultPath: "tools/old-t/output.json",
        toolCallId: "old-t",
        definitionId: "t-def"
      },
      currentToolCallId: "new-t-loop",
      definitionId: "t-def",
      failureMode: "throw",
      workflowInvocationId: "w1",
      parentWorkflowInvocationId: "parent-w1",
      origin: loopOrigin,
      runId: "current-run-id",
      args: { inputVal: "hello-secret" },
      timeoutMs: 5000,
      metadata: { userMeta: "user-value-secret" },
      redactedSecrets: ["secret"]
    });

    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ out: "ok" });
    expect(result.origin).toEqual(loopOrigin);
    expect(writtenFiles["tools/new-t-loop/input.json"]).toEqual({ inputVal: "hello-[REDACTED]" });
    expect(writtenFiles["tools/new-t-loop/input.json"].inputVal).not.toContain("secret");
    expect(writtenFiles["tools/new-t-loop/metadata.json"].metadata.userMeta).not.toContain("secret");
    expect(writtenFiles["tools/new-t-loop/metadata.json"]).toMatchObject({
      schemaVersion: "open-dynamic-workflow.tool.v1",
      runId: "current-run-id",
      toolCallId: "new-t-loop",
      definition: "t-def",
      workflowInvocationId: "w1",
      parentWorkflowInvocationId: "parent-w1",
      effectiveTimeoutMs: 5000,
      metadata: { userMeta: "user-value-[REDACTED]" },
      origin: loopOrigin,
      status: "succeeded",
      queuedAt: expect.any(String),
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      queueDurationMs: 0,
      executionDurationMs: 0,
      durationMs: 0,
      cacheMaterializationDurationMs: expect.any(Number)
    });
  });

  it("records agent calls into calls.jsonl and cache-index.json", async () => {
    const runRoot = path.join(TEMP_DIR, "run-agent-rec");
    await fs.mkdir(runRoot, { recursive: true });
    
    const store = {
      getRunArtifacts: () => ({ rootDir: runRoot }),
      isRunCreated: () => true,
      appendJsonl: vi.fn(),
      writeJson: vi.fn()
    } as any;

    const cache: RuntimeCallCache = {
      readEnabled: true,
      writeIndex: true,
      currentEntries: [],
      previousEntries: new Map(),
      prefixCacheUsable: true
    };

    const result = {
      id: "agent-1",
      status: "succeeded",
      ok: true,
      artifacts: {
        normalizedResultPath: path.join(runRoot, "agents/agent-1/normalized-result.json")
      }
    } as any;

    await recordAgentCall({
      store,
      cache,
      sequence: 1,
      callId: "call-1",
      fingerprint: "fp-1",
      result
    });

    expect(store.appendJsonl).toHaveBeenCalledWith("calls.jsonl", expect.objectContaining({
      kind: "agent",
      resultPath: "agents/agent-1/normalized-result.json",
      agentResultPath: "agents/agent-1/agent-result.json"
    }));
  });

  it("records tool calls into calls.jsonl and cache-index.json", async () => {
    const runRoot = path.join(TEMP_DIR, "run-tool-rec");
    await fs.mkdir(runRoot, { recursive: true });
    
    const store = {
      getRunArtifacts: () => ({ rootDir: runRoot }),
      isRunCreated: () => true,
      appendJsonl: vi.fn(),
      writeJson: vi.fn()
    } as any;

    const cache: RuntimeCallCache = {
      readEnabled: true,
      writeIndex: true,
      currentEntries: [],
      previousEntries: new Map(),
      prefixCacheUsable: true
    };

    const result = {
      toolCallId: "t-1",
      definitionId: "t-def",
      status: "succeeded",
      ok: true,
      artifactPath: path.join(runRoot, "tools/t-1/output.json"),
      workflowInvocationId: "w1"
    } as any;

    await recordToolCall({
      store,
      cache,
      sequence: 1,
      callId: "call-1",
      fingerprint: "fp-1",
      result
    });

    expect(store.appendJsonl).toHaveBeenCalledWith("calls.jsonl", expect.objectContaining({
      kind: "tool",
      toolCallId: "t-1",
      definitionId: "t-def",
      resultPath: "tools/t-1/output.json"
    }));
    expect(store.writeJson).toHaveBeenCalledWith("tools/t-1/tool-result.json", result);
  });

  it("records loop calls into calls.jsonl and cache-index.json", async () => {
    const runRoot = path.join(TEMP_DIR, "run-loop-rec");
    await fs.mkdir(runRoot, { recursive: true });
    
    const store = {
      getRunArtifacts: () => ({ rootDir: runRoot }),
      isRunCreated: () => true,
      appendJsonl: vi.fn(),
      writeJson: vi.fn()
    } as any;

    const cache: RuntimeCallCache = {
      readEnabled: true,
      writeIndex: true,
      currentEntries: [],
      previousEntries: new Map(),
      prefixCacheUsable: true
    };

    const { recordLoopCall } = await import("../../../src/artifacts/call-cache.js");

    await recordLoopCall({
      store,
      cache,
      sequence: 1,
      loopId: "loop-1",
      roundIndex: 1,
      roundId: "loop-1-round-0001",
      fingerprint: "fp-loop",
      resultPath: "loops/loop-1/rounds/0001/round.json"
    });

    expect(store.appendJsonl).toHaveBeenCalledWith("calls.jsonl", expect.objectContaining({
      kind: "loop",
      loopId: "loop-1",
      roundIndex: 1,
      roundId: "loop-1-round-0001",
      fingerprint: "fp-loop"
    }));
  });

  it("rejects cached artifact paths that escape the previous run directory", async () => {
    const store = {
      writeText: async (relativePath: string) => relativePath,
      writeJson: async (relativePath: string) => relativePath
    } as Partial<ArtifactStore> as ArtifactStore;

    await expect(materializeCachedAgentResult({
      store,
      previousRunRoot: TEMP_DIR,
      entry: {
        kind: "agent",
        sequence: 1,
        callId: "evil",
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "../outside.json",
        agentId: "evil"
      },
      currentAgentId: "evil",
      provider: "codex",
      permissions: { mode: "default" },
      providerSelection: mockProviderSelection
    })).rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });

    await expect(materializeCachedToolResult({
      store,
      previousRunRoot: TEMP_DIR,
      entry: {
        kind: "tool",
        sequence: 1,
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "../outside.json",
        toolCallId: "evil",
        definitionId: "evil"
      },
      currentToolCallId: "evil",
      definitionId: "evil",
      failureMode: "throw",
      workflowInvocationId: "w1"
    })).rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
  });

  it("proves v1 cache indexes and old agent entries without Phase 3 fields load without error", async () => {
    const runRoot = path.join(TEMP_DIR, "run-legacy-load");
    await fs.mkdir(path.join(runRoot, "agents/a"), { recursive: true });
    await fs.writeFile(path.join(runRoot, "manifest.json"), JSON.stringify({ runId: "run-legacy-load" }), "utf8");
    await fs.writeFile(path.join(runRoot, "cache-index.json"), JSON.stringify({
      schemaVersion: "open-dynamic-workflow.cache-index.v1",
      entries: [
        { sequence: 1, callId: "a", fingerprint: "fp", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" }
      ]
    }), "utf8");

    const cache = await loadRuntimeCallCache({
      previousRunDir: path.join(TEMP_DIR, "run-legacy-load")
    });

    const entry = cache.previousEntries.get(1) as AgentCallCacheEntry;
    expect(entry).toBeDefined();
    expect(entry.fingerprintVersion).toBeUndefined();
    expect(entry.diagnosticMaterial).toBeUndefined();
  });

  it("proves identifiable v2 mismatches return safe specific reasons and legacy mismatches return the generic reason", () => {
    const oldDiag: AgentFingerprintDiagnosticMaterial = {
      requestedProvider: "alias-1",
      providerAlias: "alias-1",
      providerAliasDigest: "digest-1",
      provider: "concrete-1",
      model: "model-1",
      thinkingEffort: "medium",
      timeoutMs: 5000,
      retry: {
        enabled: true,
        maxAttempts: 3,
        delayMs: 1000,
        backoff: "exponential",
        maxDelayMs: 30000,
        jitter: true,
        disableDelay: false
      }
    };

    const cache = makeCache([
      {
        kind: "agent",
        sequence: 1,
        callId: "a",
        fingerprint: "old-fp",
        status: "succeeded",
        resultPath: "agents/a/normalized-result.json",
        agentId: "a",
        fingerprintVersion: "v2",
        diagnosticMaterial: oldDiag
      }
    ]);

    // Test alias digest change / model change
    let reportedReason = "";
    findPrefixCacheHit({
      cache,
      kind: "agent",
      sequence: 1,
      callId: "a",
      fingerprint: "new-fp",
      currentDiagnosticMaterial: {
        ...oldDiag,
        providerAliasDigest: "digest-2",
        model: "model-2"
      },
      onMismatch: (r) => { reportedReason = r; }
    });
    expect(reportedReason).toBe('provider alias "alias-1" resolved model changed from "model-1" to "model-2"');

    // Reset prefix cache usability for the next lookup test
    cache.prefixCacheUsable = true;
    reportedReason = "";

    // Test alias digest change / thinking effort change
    findPrefixCacheHit({
      cache,
      kind: "agent",
      sequence: 1,
      callId: "a",
      fingerprint: "new-fp",
      currentDiagnosticMaterial: {
        ...oldDiag,
        providerAliasDigest: "digest-2",
        thinkingEffort: "high"
      },
      onMismatch: (r) => { reportedReason = r; }
    });
    expect(reportedReason).toBe('provider alias "alias-1" resolved thinking effort changed from "medium" to "high"');

    // Reset prefix cache usability
    cache.prefixCacheUsable = true;
    reportedReason = "";

    // Test legacy mismatch fallback (when old diagnosticMaterial is absent)
    const cacheLegacy = makeCache([
      {
        kind: "agent",
        sequence: 1,
        callId: "a",
        fingerprint: "old-fp",
        status: "succeeded",
        resultPath: "agents/a/normalized-result.json",
        agentId: "a"
      }
    ]);
    findPrefixCacheHit({
      cache: cacheLegacy,
      kind: "agent",
      sequence: 1,
      callId: "a",
      fingerprint: "new-fp",
      currentDiagnosticMaterial: oldDiag,
      onMismatch: (r) => { reportedReason = r; }
    });
    expect(reportedReason).toBe("fingerprint mismatch");
  });

  it("proves prefix usability becomes false at the first mismatch and remains false for later calls", () => {
    const cache = makeCache([
      { kind: "agent", sequence: 1, callId: "a", fingerprint: "fp-a", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" },
      { kind: "agent", sequence: 2, callId: "b", fingerprint: "fp-b", status: "succeeded", resultPath: "agents/b/normalized-result.json", agentId: "b" }
    ]);

    // Mismatch at sequence 1
    const hit1 = findPrefixCacheHit({
      cache,
      kind: "agent",
      sequence: 1,
      callId: "a",
      fingerprint: "fp-different"
    });
    expect(hit1).toBeUndefined();
    expect(cache.prefixCacheUsable).toBe(false);

    // Sequence 2 has identical fingerprint but prefixCacheUsable is now false, so it must return undefined
    const hit2 = findPrefixCacheHit({
      cache,
      kind: "agent",
      sequence: 2,
      callId: "b",
      fingerprint: "fp-b"
    });
    expect(hit2).toBeUndefined();
  });

  it("proves cache-hit materialization overwrites stale selection fields with current-run values and creates metadata.json when necessary", async () => {
    const prevRun = path.join(TEMP_DIR, "prev-mat-run");
    await fs.mkdir(path.join(prevRun, "agents/old-a"), { recursive: true });
    await fs.writeFile(path.join(prevRun, "agents/old-a/normalized-result.json"), JSON.stringify("ok"), "utf8");

    const fakePrevResult = {
      ok: true,
      status: "succeeded",
      id: "old-a",
      provider: "old-provider",
      model: "old-model",
      text: "ok",
      artifacts: {
        dir: "agents/old-a",
        promptPath: "agents/old-a/prompt.txt",
        stdoutPath: "agents/old-a/stdout.log",
        stderrPath: "agents/old-a/stderr.log"
      },
      permissions: { mode: "default" },
      metadata: {
        someKey: "someValue",
        providerSelection: {
          schemaVersion: "open-dynamic-workflow.provider-selection.v1",
          selection: { requestedProvider: "old-alias", resolvedProvider: "old-provider" }
        }
      }
    };
    await fs.writeFile(path.join(prevRun, "agents/old-a/agent-result.json"), JSON.stringify(fakePrevResult), "utf8");

    let writtenFiles: Record<string, any> = {};
    const store = {
      writeText: async (relativePath: string, content: string) => { writtenFiles[relativePath] = content; },
      writeJson: async (relativePath: string, data: any) => { writtenFiles[relativePath] = data; }
    } as any;

    const currentProviderSelection = {
      schemaVersion: "open-dynamic-workflow.provider-selection.v1",
      selection: {
        requestedProvider: "new-alias",
        requestedProviderSource: "agent",
        resolvedProvider: "new-concrete"
      },
      resolvedExecution: {
        model: "new-model",
        timeoutMs: 99999,
        retry: { enabled: false }
      }
    } as any;

    const result = await materializeCachedAgentResult({
      store,
      previousRunRoot: prevRun,
      previousRunId: "prev-run",
      entry: {
        kind: "agent",
        sequence: 1,
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "agents/old-a/normalized-result.json",
        agentId: "old-a",
        agentResultPath: "agents/old-a/agent-result.json"
      },
      currentAgentId: "new-a",
      provider: "new-concrete",
      model: "new-model",
      permissions: { mode: "default" },
      providerSelection: currentProviderSelection
    });

    expect(result.providerSelection).toEqual(currentProviderSelection);
    expect(result.metadata?.providerSelection).toEqual(currentProviderSelection);
    expect(result.metadata?.someKey).toBe("someValue"); // preserved other keys

    expect(writtenFiles["agents/new-a/metadata.json"]).toEqual({
      someKey: "someValue",
      providerSelection: currentProviderSelection
    });
  });
});
