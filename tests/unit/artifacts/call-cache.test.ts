import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadRuntimeCallCache, materializeCachedAgentResult } from "../../../src/artifacts/call-cache.js";
import type { ArtifactStore } from "../../../src/types/artifacts.js";

const TEMP_DIR = path.resolve("tests/temp-call-cache-unit");

describe("call cache", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("rebuilds successful entries from calls.jsonl when cache-index.json is missing", async () => {
    const runRoot = path.join(TEMP_DIR, "run-1");
    await fs.mkdir(path.join(runRoot, "agents/a"), { recursive: true });
    await fs.writeFile(path.join(runRoot, "manifest.json"), JSON.stringify({ runId: "run-1", workflowHash: "hash" }), "utf8");
    await fs.writeFile(path.join(runRoot, "agents/a/normalized-result.json"), JSON.stringify("ok"), "utf8");
    await fs.writeFile(path.join(runRoot, "calls.jsonl"), [
      JSON.stringify({
        callId: "a",
        fingerprint: "fp",
        status: "failed",
        resultPath: "agents/a/normalized-result.json",
        agentId: "a"
      }),
      JSON.stringify({
        callId: "a",
        fingerprint: "fp2",
        status: "succeeded",
        resultPath: "agents/a/normalized-result.json",
        agentId: "a"
      })
    ].join("\n"), "utf8");

    const cache = await loadRuntimeCallCache({
      resume: "run-1",
      config: { outDir: TEMP_DIR } as any,
      workflowHash: "hash"
    });

    expect(Object.keys(cache.previousEntries)).toEqual(["a:fp2"]);
  });

  it("rejects cached artifact paths that escape the previous run directory", async () => {
    const writes: Record<string, unknown> = {};
    const store = {
      writeText: async (relativePath: string, value: string) => {
        writes[relativePath] = value;
        return relativePath;
      },
      writeJson: async (relativePath: string, value: unknown) => {
        writes[relativePath] = value;
        return relativePath;
      }
    } as Partial<ArtifactStore> as ArtifactStore;

    await expect(materializeCachedAgentResult({
      store,
      previousRunRoot: TEMP_DIR,
      entry: {
        callId: "evil",
        fingerprint: "fp",
        status: "succeeded",
        resultPath: "../outside.json",
        agentId: "evil"
      },
      currentAgentId: "evil",
      provider: "codex"
    })).rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
  });
});
