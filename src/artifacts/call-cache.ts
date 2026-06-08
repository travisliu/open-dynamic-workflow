import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentCallInput, AgentPermissions, AgentResult, AgentSuccessResult } from "../types/agent.js";
import type { ArtifactStore } from "../types/artifacts.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export interface CallCacheEntry {
  sequence: number;
  callId?: string | undefined;
  fingerprint: string;
  status: "succeeded" | "failed" | "timed_out" | "cancelled" | "skipped";
  resultPath: string;
  agentResultPath?: string | undefined;
  agentId: string;
}

export interface CallCacheIndex {
  schemaVersion: "openflow.cache-index.v1";
  previousRunId?: string | undefined;
  workflowHash?: string | undefined;
  entries: CallCacheEntry[];
}

export interface RuntimeCallCache {
  readEnabled: boolean;
  writeIndex: boolean;
  previousRunRoot?: string | undefined;
  previousRunId?: string | undefined;
  previousWorkflowHash?: string | undefined;
  previousEntries: Map<number, CallCacheEntry>;
  currentEntries: CallCacheEntry[];
  prefixCacheUsable: boolean;
}

export async function loadRuntimeCallCache(input: {
  resume?: string | undefined;
  noCache?: boolean | undefined;
  outDir: string;
}): Promise<RuntimeCallCache> {
  const cache: RuntimeCallCache = {
    readEnabled: !!input.resume && !input.noCache,
    writeIndex: !input.noCache,
    previousEntries: new Map(),
    currentEntries: [],
    prefixCacheUsable: true
  };

  if (!input.resume || input.noCache) {
    return cache;
  }

  const previousRunRoot = path.isAbsolute(input.resume)
    ? input.resume
    : path.resolve(input.outDir, input.resume);
  const manifestPath = path.join(previousRunRoot, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const previousRunId = typeof manifest.runId === "string" ? manifest.runId : path.basename(previousRunRoot);
  const previousWorkflowHash = typeof manifest.workflowHash === "string" ? manifest.workflowHash : undefined;
  const index = await loadCacheIndex(previousRunRoot);

  cache.previousRunRoot = previousRunRoot;
  cache.previousRunId = previousRunId;
  cache.previousWorkflowHash = previousWorkflowHash;
  cache.previousEntries = new Map(index.entries.map((entry) => [entry.sequence, entry]));
  return cache;
}

export function computeAgentFingerprint(input: {
  call: AgentCallInput;
  provider: string;
  model?: string | undefined;
  timeoutMs: number;
  cwd: string;
  providerConfig?: unknown;
}): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify({
      prompt: input.call.prompt,
      schema: input.call.schema,
      structuredOutput: input.call.structuredOutput,
      provider: input.provider,
      model: input.model,
      timeoutMs: input.timeoutMs,
      cwd: input.cwd,
      metadata: input.call.metadata,
      providerConfig: input.providerConfig
    }))
    .digest("hex");
}

export function resolveCallId(input: AgentCallInput): string | undefined {
  return input.id ?? input.label;
}

export function findPrefixCacheHit(input: {
  cache?: RuntimeCallCache | undefined;
  sequence: number;
  callId?: string | undefined;
  fingerprint: string;
}): CallCacheEntry | undefined {
  const cache = input.cache;
  if (!cache?.readEnabled || !cache.prefixCacheUsable) {
    return undefined;
  }

  const entry = cache.previousEntries.get(input.sequence);
  if (
    !entry ||
    entry.status !== "succeeded" ||
    entry.fingerprint !== input.fingerprint ||
    !callIdsCompatible(entry.callId, input.callId)
  ) {
    cache.prefixCacheUsable = false;
    return undefined;
  }

  return entry;
}

export async function materializeCachedAgentResult(input: {
  store: ArtifactStore;
  previousRunRoot: string;
  previousRunId?: string | undefined;
  entry: CallCacheEntry;
  currentAgentId: string;
  label?: string | undefined;
  provider: string;
  model?: string | undefined;
  permissions: AgentPermissions;
}): Promise<AgentSuccessResult> {
  let cachedResult: AgentResult | undefined;
  if (input.entry.agentResultPath) {
    cachedResult = JSON.parse(await fs.readFile(resolvePreviousRunPath(input.previousRunRoot, input.entry.agentResultPath), "utf8"));
  }

  const normalizedPath = resolvePreviousRunPath(input.previousRunRoot, input.entry.resultPath);
  const normalized = JSON.parse(await fs.readFile(normalizedPath, "utf8"));

  const agentDir = `agents/${input.currentAgentId}`;
  await input.store.writeText(`${agentDir}/prompt.txt`, "[cache hit]");
  await input.store.writeText(`${agentDir}/stdout.log`, "");
  await input.store.writeText(`${agentDir}/stderr.log`, "");
  await input.store.writeJson(`${agentDir}/normalized-result.json`, normalized);
  await input.store.writeJson(`${agentDir}/cache-hit.json`, {
    sequence: input.entry.sequence,
    callId: input.entry.callId,
    previousAgentId: input.entry.agentId,
    previousRunId: input.previousRunId,
    resultPath: input.entry.resultPath
  });

  if (cachedResult?.ok) {
    const success: AgentSuccessResult = {
      ...cachedResult,
      id: input.currentAgentId,
      label: input.label,
      provider: input.provider,
      model: input.model,
      stdout: "",
      stderr: "",
      durationMs: 0,
      permissions: cachedResult.permissions ?? { mode: "default" },
      artifacts: {
        ...cachedResult.artifacts,
        dir: agentDir,
        promptPath: `${agentDir}/prompt.txt`,
        stdoutPath: `${agentDir}/stdout.log`,
        stderrPath: `${agentDir}/stderr.log`,
        rawResultPath: `${agentDir}/raw-result.json`,
        normalizedResultPath: `${agentDir}/normalized-result.json`
      },
      cache: {
        hit: true,
        callId: input.entry.callId,
        previousRunId: input.previousRunId,
        previousAgentId: input.entry.agentId
      },
      permissions: input.permissions
    };
    await input.store.writeJson(`${agentDir}/raw-result.json`, success);
    await input.store.writeJson(`${agentDir}/agent-result.json`, success);
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
    permissions: { mode: "default" },
    artifacts: {
      dir: agentDir,
      promptPath: `${agentDir}/prompt.txt`,
      stdoutPath: `${agentDir}/stdout.log`,
      stderrPath: `${agentDir}/stderr.log`,
      rawResultPath: `${agentDir}/raw-result.json`,
      normalizedResultPath: `${agentDir}/normalized-result.json`
    },
    cache: {
      hit: true,
      callId: input.entry.callId,
      previousRunId: input.previousRunId,
      previousAgentId: input.entry.agentId
    },
    permissions: input.permissions
  };
  await input.store.writeJson(`${agentDir}/raw-result.json`, success);
  await input.store.writeJson(`${agentDir}/agent-result.json`, success);
  return success;
}

export async function recordCall(input: {
  store?: ArtifactStore | undefined;
  cache?: RuntimeCallCache | undefined;
  sequence: number;
  callId?: string | undefined;
  fingerprint: string;
  result: AgentResult;
}): Promise<void> {
  if (!input.store) {
    return;
  }
  if (typeof input.store.isRunCreated === "function" && !input.store.isRunCreated()) {
    return;
  }
  if (typeof input.store.appendJsonl !== "function") {
    return;
  }

  const entry: CallCacheEntry = {
    sequence: input.sequence,
    ...(input.callId !== undefined ? { callId: input.callId } : {}),
    fingerprint: input.fingerprint,
    status: input.result.status,
    resultPath: input.result.artifacts.normalizedResultPath ?? input.result.artifacts.rawResultPath ?? `agents/${input.result.id}/raw-result.json`,
    agentId: input.result.id
  };

  if (input.result.ok && typeof input.store.writeJson === "function") {
    entry.agentResultPath = `agents/${input.result.id}/agent-result.json`;
    await input.store.writeJson(entry.agentResultPath, input.result);
  }

  await input.store.appendJsonl("calls.jsonl", entry);

  if (input.cache?.writeIndex && input.result.ok) {
    input.cache.currentEntries.push(entry);
    await input.store.writeJson("cache-index.json", {
      schemaVersion: "openflow.cache-index.v1",
      previousRunId: input.cache.previousRunId,
      workflowHash: input.cache.previousWorkflowHash,
      entries: input.cache.currentEntries
    } satisfies CallCacheIndex);
  }
}

async function loadCacheIndex(previousRunRoot: string): Promise<CallCacheIndex> {
  const indexPath = path.join(previousRunRoot, "cache-index.json");
  try {
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    return {
      schemaVersion: "openflow.cache-index.v1",
      entries: filterSucceededEntries(Array.isArray(index.entries) ? index.entries : Object.values(index.entries ?? {}))
    };
  } catch {
    return rebuildCacheIndexFromCalls(previousRunRoot);
  }
}

async function rebuildCacheIndexFromCalls(previousRunRoot: string): Promise<CallCacheIndex> {
  const callsPath = path.join(previousRunRoot, "calls.jsonl");
  const entries: CallCacheEntry[] = [];
  let content = "";
  try {
    content = await fs.readFile(callsPath, "utf8");
  } catch {
    return { schemaVersion: "openflow.cache-index.v1", entries };
  }

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isCallCacheEntry(parsed) && parsed.status === "succeeded") {
        entries[parsed.sequence] = parsed;
      }
    } catch {
      // Ignore malformed audit lines; calls.jsonl is append-only.
    }
  }

  return {
    schemaVersion: "openflow.cache-index.v1",
    entries: entries.filter(Boolean)
  };
}

function filterSucceededEntries(values: unknown[]): CallCacheEntry[] {
  const entries: CallCacheEntry[] = [];
  for (const value of values) {
    if (isCallCacheEntry(value) && value.status === "succeeded") {
      entries[value.sequence] = value;
    }
  }
  return entries.filter(Boolean);
}

function isCallCacheEntry(value: unknown): value is CallCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sequence === "number" &&
    Number.isInteger(record.sequence) &&
    record.sequence > 0 &&
    (record.callId === undefined || typeof record.callId === "string") &&
    typeof record.fingerprint === "string" &&
    typeof record.status === "string" &&
    typeof record.resultPath === "string" &&
    typeof record.agentId === "string" &&
    (record.agentResultPath === undefined || typeof record.agentResultPath === "string")
  );
}

function callIdsCompatible(previous?: string, current?: string): boolean {
  if (previous === undefined && current === undefined) return true;
  return previous === current;
}

function resolvePreviousRunPath(previousRunRoot: string, relativePath: string): string {
  const root = path.resolve(previousRunRoot);
  const fullPath = path.resolve(root, relativePath);
  if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Cached artifact path escapes previous run directory: ${relativePath}`
    );
  }
  return fullPath;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        sorted[key] = sortValue(child);
      }
    }
    return sorted;
  }
  return value;
}
