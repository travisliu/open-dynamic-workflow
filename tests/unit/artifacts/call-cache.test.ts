import { describe, expect, it, beforeEach, afterEach } from "vitest";
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
});
