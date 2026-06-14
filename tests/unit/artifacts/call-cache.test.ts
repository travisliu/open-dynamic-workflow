import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  computeAgentFingerprint,
  findPrefixCacheHit,
  loadRuntimeCallCache,
  materializeCachedAgentResult,
  type RuntimeCallCache
} from "../../../src/artifacts/call-cache.js";
import type { ArtifactStore } from "../../../src/types/artifacts.js";

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
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("computes stable fingerprints and changes when provider-relevant inputs change", () => {
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

  it("uses longest-prefix matching and disables later hits after the first miss", () => {
    const cache = makeCache([
      { sequence: 1, callId: "a", fingerprint: "fp-a", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" },
      { sequence: 2, callId: "b", fingerprint: "fp-b", status: "succeeded", resultPath: "agents/b/normalized-result.json", agentId: "b" },
      { sequence: 3, callId: "c", fingerprint: "fp-c", status: "succeeded", resultPath: "agents/c/normalized-result.json", agentId: "c" }
    ]);

    expect(findPrefixCacheHit({ cache, sequence: 1, callId: "a", fingerprint: "fp-a" })?.agentId).toBe("a");
    expect(findPrefixCacheHit({ cache, sequence: 2, callId: "b", fingerprint: "changed" })).toBeUndefined();
    expect(cache.prefixCacheUsable).toBe(false);
    expect(findPrefixCacheHit({ cache, sequence: 3, callId: "c", fingerprint: "fp-c" })).toBeUndefined();
  });

  it("treats id/label as an additional guard when present", () => {
    const cache = makeCache([
      { sequence: 1, callId: "old-id", fingerprint: "fp", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" }
    ]);

    expect(findPrefixCacheHit({ cache, sequence: 1, callId: "new-id", fingerprint: "fp" })).toBeUndefined();
  });

  it("rebuilds successful ordered entries from calls.jsonl when cache-index.json is missing", async () => {
    const runRoot = path.join(TEMP_DIR, "run-1");
    await fs.mkdir(path.join(runRoot, "agents/a"), { recursive: true });
    await fs.writeFile(path.join(runRoot, "manifest.json"), JSON.stringify({ runId: "run-1", workflowHash: "hash" }), "utf8");
    await fs.writeFile(path.join(runRoot, "agents/a/normalized-result.json"), JSON.stringify("ok"), "utf8");
    await fs.writeFile(path.join(runRoot, "calls.jsonl"), [
      JSON.stringify({ sequence: 1, callId: "a", fingerprint: "fp", status: "failed", resultPath: "agents/a/normalized-result.json", agentId: "a" }),
      JSON.stringify({ sequence: 1, callId: "a", fingerprint: "fp2", status: "succeeded", resultPath: "agents/a/normalized-result.json", agentId: "a" }),
      "not-json"
    ].join("\n"), "utf8");

    const cache = await loadRuntimeCallCache({
      resume: "run-1",
      outDir: TEMP_DIR
    });

    expect(cache.previousEntries.get(1)?.fingerprint).toBe("fp2");
  });

  it("records calls and normalizes artifact paths relative to run root", async () => {
    const runRoot = path.join(TEMP_DIR, "run-rec");
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

    await (await import("../../../src/artifacts/call-cache.js")).recordCall({
      store,
      cache,
      sequence: 1,
      callId: "call-1",
      fingerprint: "fp-1",
      result
    });

    expect(store.appendJsonl).toHaveBeenCalledWith("calls.jsonl", expect.objectContaining({
      resultPath: "agents/agent-1/normalized-result.json",
      agentResultPath: "agents/agent-1/agent-result.json"
    }));
    expect(cache.currentEntries).toHaveLength(1);
    expect(store.writeJson).toHaveBeenCalledWith("cache-index.json", expect.objectContaining({
      entries: expect.arrayContaining([expect.objectContaining({ callId: "call-1" })])
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
        sequence: 1,
        callId: "evil",
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "../outside.json",
        agentId: "evil"
      },
      currentAgentId: "evil",
      provider: "codex",
      permissions: { mode: "default" }
    })).rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
  });

  it("does not leak artifact paths from the previous run directory when loading cache hit", async () => {
    const prevRun = path.join(TEMP_DIR, "prev-run");
    await fs.mkdir(path.join(prevRun, "agents/old-agent"), { recursive: true });
    
    const oldResult = {
      ok: true,
      status: "succeeded",
      id: "old-agent",
      provider: "codex",
      stdout: "old-stdout",
      stderr: "old-stderr",
      exitCode: 0,
      durationMs: 100,
      permissions: { mode: "default" },
      metadata: { m: 1 },
      artifacts: {
        dir: "agents/old-agent",
        promptPath: "agents/old-agent/prompt.txt",
        stdoutPath: "agents/old-agent/stdout.log",
        stderrPath: "agents/old-agent/stderr.log",
        rawResultPath: "agents/old-agent/raw-result.json",
        normalizedResultPath: "agents/old-agent/normalized-result.json",
        permissionsPath: "agents/old-agent/permissions.json",
        metadataPath: "agents/old-agent/metadata.json",
        schemaPath: "agents/old-agent/schema.json",
        validationErrorPath: "agents/old-agent/validation.json"
      }
    };
    
    await fs.writeFile(path.join(prevRun, "agents/old-agent/agent-result.json"), JSON.stringify(oldResult), "utf8");
    await fs.writeFile(path.join(prevRun, "agents/old-agent/normalized-result.json"), JSON.stringify("ok"), "utf8");

    let writtenFiles: string[] = [];
    const store = {
      writeText: async (relativePath: string) => { writtenFiles.push(relativePath); },
      writeJson: async (relativePath: string) => { writtenFiles.push(relativePath); }
    } as any;

    const result = await materializeCachedAgentResult({
      store,
      previousRunRoot: prevRun,
      previousRunId: "prev-run",
      entry: {
        sequence: 1,
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "agents/old-agent/normalized-result.json",
        agentResultPath: "agents/old-agent/agent-result.json",
        agentId: "old-agent"
      },
      currentAgentId: "new-agent",
      provider: "codex"
    });

    for (const [key, value] of Object.entries(result.artifacts)) {
      if (typeof value === "string") {
        expect(value).not.toContain("old-agent");
        expect(value).toContain("new-agent");
      }
    }

    expect(result.artifacts.permissionsPath).toBe("agents/new-agent/permissions.json");
    expect(result.artifacts.metadataPath).toBe("agents/new-agent/metadata.json");
    expect(result.artifacts.schemaPath).toBeUndefined();
    expect(result.artifacts.validationErrorPath).toBeUndefined();

    expect(writtenFiles).toContain("agents/new-agent/permissions.json");
    expect(writtenFiles).toContain("agents/new-agent/metadata.json");
  });
});
