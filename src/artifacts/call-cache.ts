import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentCallInput, AgentPermissions, AgentResult, AgentSuccessResult } from "../types/agent.js";
import type { ToolExecutionResult, ToolFailureMode } from "../types/tool.js";
import type { ArtifactStore } from "../types/artifacts.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export type CallCacheStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "skipped";

export interface BaseCallCacheEntry {
  kind: "agent" | "tool";
  sequence: number;
  callId?: string | undefined;
  fingerprint: string;
  status: CallCacheStatus;
  resultPath: string;
}

export interface AgentCallCacheEntry extends BaseCallCacheEntry {
  kind: "agent";
  agentId: string;
  agentResultPath?: string | undefined;
}

export interface ToolCallCacheEntry extends BaseCallCacheEntry {
  kind: "tool";
  toolCallId: string;
  definitionId: string;
  toolResultPath?: string | undefined;
}

export type CallCacheEntry = AgentCallCacheEntry | ToolCallCacheEntry;

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

export function computeToolFingerprint(input: {
  definitionId: string;
  args: unknown;
  timeoutMs?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
  sourcePath?: string | undefined;
  definitionVersion?: unknown;
}): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify({
      definitionId: input.definitionId,
      args: input.args,
      timeoutMs: input.timeoutMs,
      metadata: input.metadata,
      sourcePath: input.sourcePath,
      definitionVersion: input.definitionVersion
    }))
    .digest("hex");
}

export function resolveCallId(input: AgentCallInput): string | undefined {
  return input.id ?? input.label;
}

export function findPrefixCacheHit(input: {
  cache?: RuntimeCallCache | undefined;
  kind: "agent";
  sequence: number;
  callId?: string | undefined;
  fingerprint: string;
}): AgentCallCacheEntry | undefined;
export function findPrefixCacheHit(input: {
  cache?: RuntimeCallCache | undefined;
  kind: "tool";
  sequence: number;
  callId?: string | undefined;
  fingerprint: string;
}): ToolCallCacheEntry | undefined;
export function findPrefixCacheHit(input: {
  cache?: RuntimeCallCache | undefined;
  kind: "agent" | "tool";
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
    entry.kind !== input.kind ||
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
  entry: AgentCallCacheEntry;
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
    const agentArtifacts: Record<string, string | undefined> & {
      dir: string;
      promptPath: string;
      stdoutPath: string;
      stderrPath: string;
    } = {
      dir: agentDir,
      promptPath: `${agentDir}/prompt.txt`,
      stdoutPath: `${agentDir}/stdout.log`,
      stderrPath: `${agentDir}/stderr.log`,
      rawResultPath: `${agentDir}/raw-result.json`,
      normalizedResultPath: `${agentDir}/normalized-result.json`
    };

    if (cachedResult.permissions) {
      agentArtifacts.permissionsPath = `${agentDir}/permissions.json`;
      await input.store.writeJson(`${agentDir}/permissions.json`, cachedResult.permissions);
    }
    if (cachedResult.metadata) {
      agentArtifacts.metadataPath = `${agentDir}/metadata.json`;
      await input.store.writeJson(`${agentDir}/metadata.json`, cachedResult.metadata);
    }

    const success: AgentSuccessResult = {
      ...cachedResult,
      id: input.currentAgentId,
      label: input.label,
      provider: input.provider,
      model: input.model,
      stdout: "",
      stderr: "",
      durationMs: 0,
      artifacts: agentArtifacts,
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
    return removeUndefinedProperties(success);
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
  return removeUndefinedProperties(success);
}

export async function materializeCachedToolResult(input: {
  store: ArtifactStore;
  previousRunRoot: string;
  previousRunId?: string | undefined;
  entry: ToolCallCacheEntry;
  currentToolCallId: string;
  definitionId: string;
  failureMode: ToolFailureMode;
  label?: string | undefined;
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
}): Promise<ToolExecutionResult> {
  const previousResultPath = resolvePreviousRunPath(input.previousRunRoot, input.entry.resultPath);
  const output = JSON.parse(await fs.readFile(previousResultPath, "utf8"));

  const toolDir = `tools/${input.currentToolCallId}`;
  await input.store.writeJson(`${toolDir}/output.json`, output);
  await input.store.writeJson(`${toolDir}/cache-hit.json`, {
    sequence: input.entry.sequence,
    callId: input.entry.callId,
    previousToolCallId: input.entry.toolCallId,
    previousRunId: input.previousRunId,
    resultPath: input.entry.resultPath,
    definitionId: input.definitionId
  });

  const success: ToolExecutionResult = {
    ok: true,
    status: "succeeded",
    toolCallId: input.currentToolCallId,
    definitionId: input.definitionId,
    output,
    durationMs: 0,
    artifactPath: `${toolDir}/output.json`,
    workflowInvocationId: input.workflowInvocationId,
    parentWorkflowInvocationId: input.parentWorkflowInvocationId,
    cache: {
      hit: true,
      callId: input.entry.callId,
      previousRunId: input.previousRunId,
      previousToolCallId: input.entry.toolCallId
    }
  };

  await input.store.writeJson(`${toolDir}/tool-result.json`, success);
  return removeUndefinedProperties(success);
}

export async function recordAgentCall(input: {
  store?: ArtifactStore | undefined;
  cache?: RuntimeCallCache | undefined;
  sequence: number;
  callId?: string | undefined;
  fingerprint: string;
  result: AgentResult;
}): Promise<void> {
  if (!input.store || typeof input.store.getRunArtifacts !== "function") return;

  const rootDir = input.store.getRunArtifacts().rootDir;
  const normalizePath = (p: string | undefined) => {
    if (!p) return undefined;
    if (path.isAbsolute(p)) return path.relative(rootDir, p);
    return p;
  };

  const artifacts = input.result.artifacts;
  const resultPath = (artifacts?.normalizedResultPath ? normalizePath(artifacts.normalizedResultPath) : undefined) ??
                     (artifacts?.rawResultPath ? normalizePath(artifacts.rawResultPath) : undefined) ??
                     `agents/${input.result.id}/raw-result.json`;

  const entry: AgentCallCacheEntry = {
    kind: "agent",
    sequence: input.sequence,
    ...(input.callId !== undefined ? { callId: input.callId } : {}),
    fingerprint: input.fingerprint,
    status: input.result.status as CallCacheStatus,
    resultPath: resultPath as string,
    agentId: input.result.id
  };

  if (input.result.ok && typeof input.store.writeJson === "function") {
    const agentResultRelPath = `agents/${input.result.id}/agent-result.json`;
    entry.agentResultPath = agentResultRelPath;
    await input.store.writeJson(agentResultRelPath, input.result);
  }

  await recordCallEntry({
    store: input.store,
    cache: input.cache,
    entry
  });
}

export async function recordToolCall(input: {
  store?: ArtifactStore | undefined;
  cache?: RuntimeCallCache | undefined;
  sequence: number;
  callId?: string | undefined;
  fingerprint: string;
  result: ToolExecutionResult;
}): Promise<void> {
  if (!input.store || typeof input.store.getRunArtifacts !== "function") return;

  const rootDir = input.store.getRunArtifacts().rootDir;
  const normalizePath = (p: string | undefined) => {
    if (!p) return undefined;
    if (path.isAbsolute(p)) return path.relative(rootDir, p);
    return p;
  };

  const resultPath = input.result.artifactPath ? normalizePath(input.result.artifactPath) : `tools/${input.result.toolCallId}/output.json`;

  const entry: ToolCallCacheEntry = {
    kind: "tool",
    sequence: input.sequence,
    ...(input.callId !== undefined ? { callId: input.callId } : {}),
    fingerprint: input.fingerprint,
    status: input.result.status as CallCacheStatus,
    resultPath: resultPath as string,
    toolCallId: input.result.toolCallId,
    definitionId: input.result.definitionId
  };

  if (input.result.ok && typeof input.store.writeJson === "function") {
    const toolResultRelPath = `tools/${input.result.toolCallId}/tool-result.json`;
    entry.toolResultPath = toolResultRelPath;
    await input.store.writeJson(toolResultRelPath, input.result);
  }

  await recordCallEntry({
    store: input.store,
    cache: input.cache,
    entry
  });
}

async function recordCallEntry(input: {
  store: ArtifactStore;
  cache?: RuntimeCallCache | undefined;
  entry: CallCacheEntry;
}): Promise<void> {
  if (typeof input.store.isRunCreated === "function" && !input.store.isRunCreated()) {
    return;
  }
  if (typeof input.store.appendJsonl !== "function") {
    return;
  }

  await input.store.appendJsonl("calls.jsonl", input.entry);

  if (input.cache) {
    if (input.entry.status === "succeeded" && input.cache.writeIndex) {
      input.cache.currentEntries.push(input.entry);
      await input.store.writeJson("cache-index.json", {
        schemaVersion: "openflow.cache-index.v1",
        previousRunId: input.cache.previousRunId,
        workflowHash: input.cache.previousWorkflowHash,
        entries: input.cache.currentEntries
      } satisfies CallCacheIndex);
    } else {
      // Any non-success (or miss) disables further index growth for this run
      input.cache.writeIndex = false;
    }
  }
}

/** @deprecated Use recordAgentCall or recordToolCall */
export const recordCall = recordAgentCall;

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
      const entry = normalizeCallCacheEntry(parsed);
      if (entry && entry.status === "succeeded") {
        entries[entry.sequence] = entry;
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
    const entry = normalizeCallCacheEntry(value);
    if (entry && entry.status === "succeeded") {
      entries[entry.sequence] = entry;
    }
  }
  return entries.filter(Boolean);
}

function normalizeCallCacheEntry(value: unknown): CallCacheEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;

  // Detect kind or fallback to legacy agent detection
  const kind = record.kind === "tool" ? "tool" : "agent";

  if (kind === "agent") {
    if (
      typeof record.sequence === "number" &&
      typeof record.fingerprint === "string" &&
      typeof record.status === "string" &&
      typeof record.resultPath === "string" &&
      typeof record.agentId === "string"
    ) {
      return {
        kind: "agent",
        sequence: record.sequence,
        callId: typeof record.callId === "string" ? record.callId : undefined,
        fingerprint: record.fingerprint,
        status: record.status as CallCacheStatus,
        resultPath: record.resultPath,
        agentId: record.agentId,
        agentResultPath: typeof record.agentResultPath === "string" ? record.agentResultPath : undefined
      };
    }
  } else if (kind === "tool") {
    if (
      typeof record.sequence === "number" &&
      typeof record.fingerprint === "string" &&
      typeof record.status === "string" &&
      typeof record.resultPath === "string" &&
      typeof record.toolCallId === "string" &&
      typeof record.definitionId === "string"
    ) {
      return {
        kind: "tool",
        sequence: record.sequence,
        callId: typeof record.callId === "string" ? record.callId : undefined,
        fingerprint: record.fingerprint,
        status: record.status as CallCacheStatus,
        resultPath: record.resultPath,
        toolCallId: record.toolCallId,
        definitionId: record.definitionId,
        toolResultPath: typeof record.toolResultPath === "string" ? record.toolResultPath : undefined
      };
    }
  }

  return undefined;
}

function isCallCacheEntry(value: unknown): value is CallCacheEntry {
  return normalizeCallCacheEntry(value) !== undefined;
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

function removeUndefinedProperties<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (obj instanceof Date || obj instanceof RegExp || obj instanceof Promise) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedProperties) as any;
  }
  const result: any = {};
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== undefined) {
      result[key] = removeUndefinedProperties(val);
    }
  }
  return result;
}
