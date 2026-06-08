import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentCallInput, AgentResult, AgentSuccessResult } from "../types/agent.js";
import type { ResolvedConfig } from "../types/config.js";
import type { ArtifactStore } from "../types/artifacts.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export interface CallCacheEntry {
  callId: string;
  fingerprint: string;
  status: "succeeded" | "failed" | "timed_out" | "cancelled" | "skipped";
  resultPath: string;
  agentResultPath?: string;
  agentId: string;
}

export interface CallCacheIndex {
  schemaVersion: "openflow.cache-index.v1";
  entries: Record<string, CallCacheEntry>;
}

export interface RuntimeCallCache {
  enabled: boolean;
  previousRunRoot?: string;
  previousEntries: Record<string, CallCacheEntry>;
  currentEntries: Record<string, CallCacheEntry>;
}

export async function loadRuntimeCallCache(input: {
  resume?: string | undefined;
  noCache?: boolean | undefined;
  config: ResolvedConfig;
  workflowHash: string;
}): Promise<RuntimeCallCache> {
  if (input.noCache) {
    return { enabled: false, previousEntries: {}, currentEntries: {} };
  }

  if (!input.resume) {
    return { enabled: true, previousEntries: {}, currentEntries: {} };
  }

  const previousRunRoot = path.isAbsolute(input.resume)
    ? input.resume
    : path.resolve(input.config.outDir, input.resume);

  const manifestPath = path.join(previousRunRoot, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.workflowHash !== input.workflowHash) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Cannot resume run '${input.resume}' because workflow hash differs.`
    );
  }

  const indexPath = path.join(previousRunRoot, "cache-index.json");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8")) as CallCacheIndex;
  return {
    enabled: true,
    previousRunRoot,
    previousEntries: index.entries ?? {},
    currentEntries: {}
  };
}

export function computeAgentFingerprint(input: {
  call: AgentCallInput;
  provider: string;
  model?: string | undefined;
  cwd: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify({
      prompt: input.call.prompt,
      schema: input.call.schema,
      structuredOutput: input.call.structuredOutput,
      provider: input.provider,
      model: input.model,
      cwd: input.cwd,
      metadata: input.call.metadata
    }))
    .digest("hex");
}

export function cacheKey(callId: string, fingerprint: string): string {
  return `${callId}:${fingerprint}`;
}

export async function materializeCachedAgentResult(input: {
  store: ArtifactStore;
  previousRunRoot: string;
  entry: CallCacheEntry;
  currentAgentId: string;
  label?: string | undefined;
  provider: string;
  model?: string | undefined;
}): Promise<AgentResult> {
  let cachedResult: AgentResult | undefined;
  if (input.entry.agentResultPath) {
    cachedResult = JSON.parse(await fs.readFile(path.join(input.previousRunRoot, input.entry.agentResultPath), "utf8"));
  }

  const normalizedPath = path.join(input.previousRunRoot, input.entry.resultPath);
  const normalized = JSON.parse(await fs.readFile(normalizedPath, "utf8"));

  const agentDir = `agents/${input.currentAgentId}`;
  await input.store.writeText(`${agentDir}/prompt.txt`, "[cache hit]");
  await input.store.writeText(`${agentDir}/stdout.log`, "");
  await input.store.writeText(`${agentDir}/stderr.log`, "");
  await input.store.writeText(`${agentDir}/last-message.txt`, "");
  await input.store.writeJson(`${agentDir}/normalized-result.json`, normalized);
  await input.store.writeJson(`${agentDir}/cache-hit.json`, {
    previousAgentId: input.entry.agentId,
    callId: input.entry.callId,
    fingerprint: input.entry.fingerprint,
    previousResultPath: input.entry.resultPath
  });

  if (cachedResult?.ok) {
    const success: AgentSuccessResult = {
      ...cachedResult,
      id: input.currentAgentId,
      label: input.label,
      provider: input.provider,
      model: input.model,
      durationMs: 0,
      stdout: "",
      stderr: "",
      artifacts: {
        dir: agentDir,
        promptPath: `${agentDir}/prompt.txt`,
        stdoutPath: `${agentDir}/stdout.log`,
        stderrPath: `${agentDir}/stderr.log`,
        lastMessagePath: `${agentDir}/last-message.txt`,
        rawResultPath: `${agentDir}/raw-result.json`,
        normalizedResultPath: `${agentDir}/normalized-result.json`
      }
    };
    await input.store.writeJson(`${agentDir}/raw-result.json`, success);
    return success;
  }

  const success: AgentSuccessResult = {
    ok: true,
    status: "succeeded",
    id: input.currentAgentId,
    label: input.label,
    provider: input.provider,
    model: input.model,
    text: typeof normalized === "string" ? normalized : JSON.stringify(normalized),
    json: typeof normalized === "string" ? undefined : normalized,
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 0,
    artifacts: {
      dir: agentDir,
      promptPath: `${agentDir}/prompt.txt`,
      stdoutPath: `${agentDir}/stdout.log`,
      stderrPath: `${agentDir}/stderr.log`,
      lastMessagePath: `${agentDir}/last-message.txt`,
      rawResultPath: `${agentDir}/raw-result.json`,
      normalizedResultPath: `${agentDir}/normalized-result.json`
    }
  };
  await input.store.writeJson(`${agentDir}/raw-result.json`, success);
  return success;
}

export async function recordCall(input: {
  store?: ArtifactStore | undefined;
  cache?: RuntimeCallCache | undefined;
  callId: string;
  fingerprint: string;
  result: AgentResult;
}): Promise<void> {
  if (!input.store) {
    return;
  }
  if (
    typeof input.store.isRunCreated === "function" &&
    !input.store.isRunCreated()
  ) {
    return;
  }
  if (typeof input.store.appendJsonl !== "function") {
    return;
  }

  const status = input.result.status;
  const entry: CallCacheEntry = {
    callId: input.callId,
    fingerprint: input.fingerprint,
    status,
    resultPath: input.result.artifacts.normalizedResultPath ?? `agents/${input.result.id}/normalized-result.json`,
    agentId: input.result.id
  };

  if (input.result.ok && typeof input.store.writeJson === "function") {
    entry.agentResultPath = `agents/${input.result.id}/agent-result.json`;
    await input.store.writeJson(entry.agentResultPath, input.result);
  }
  await input.store.appendJsonl("calls.jsonl", entry);

  if (input.cache && input.result.ok) {
    input.cache.currentEntries[cacheKey(input.callId, input.fingerprint)] = entry;
    await input.store.writeJson("cache-index.json", {
      schemaVersion: "openflow.cache-index.v1",
      entries: input.cache.currentEntries
    });
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
