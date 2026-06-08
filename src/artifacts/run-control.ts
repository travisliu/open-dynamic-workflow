import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export type RunProcessStatus = "starting" | "running" | "succeeded" | "failed" | "cancelled" | "stale" | "unknown";

export interface RunProcessMetadata {
  schemaVersion: "openflow.process.v1";
  runId: string;
  pid: number;
  mode: "foreground" | "background";
  startedAt: string;
  updatedAt: string;
  command: string[];
  status: RunProcessStatus;
  exitCode?: number | null;
}

export interface RunInspection {
  runId: string;
  rootDir: string;
  manifest?: any;
  process?: RunProcessMetadata;
  report?: any;
  eventCount: number;
  status: RunProcessStatus;
  updatedAt?: string;
}

export function resolveRunRoot(outDir: string, runIdOrPath: string): string {
  return path.isAbsolute(runIdOrPath)
    ? path.resolve(runIdOrPath)
    : path.resolve(outDir, runIdOrPath);
}

export async function writeProcessMetadata(runRoot: string, metadata: RunProcessMetadata): Promise<string> {
  await fs.mkdir(runRoot, { recursive: true });
  const processPath = path.join(runRoot, "process.json");
  await fs.writeFile(processPath, JSON.stringify(metadata, null, 2), "utf8");
  return processPath;
}

export async function readProcessMetadata(runRoot: string): Promise<RunProcessMetadata | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(runRoot, "process.json"), "utf8"));
  } catch {
    return undefined;
  }
}

export async function updateProcessMetadata(
  runRoot: string,
  patch: Partial<RunProcessMetadata>
): Promise<void> {
  const existing = await readProcessMetadata(runRoot);
  if (!existing) return;
  await writeProcessMetadata(runRoot, {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  });
}

export async function inspectRun(outDir: string, runIdOrPath: string): Promise<RunInspection> {
  const rootDir = resolveRunRoot(outDir, runIdOrPath);
  const manifest = await readJsonIfExists(path.join(rootDir, "manifest.json"));
  const processMeta = await readProcessMetadata(rootDir);
  const report = await readJsonIfExists(path.join(rootDir, "report.json"));
  const eventCount = await countJsonlLines(path.join(rootDir, "events.jsonl"));
  const runId = manifest?.runId || processMeta?.runId || path.basename(rootDir);
  const status = await inferRunStatus({ manifest, processMeta, report });
  const updatedAt = report?.finishedAt || manifest?.updatedAt || processMeta?.updatedAt;
  return {
    runId,
    rootDir,
    ...(manifest !== undefined ? { manifest } : {}),
    ...(processMeta !== undefined ? { process: processMeta } : {}),
    ...(report !== undefined ? { report } : {}),
    eventCount,
    status,
    ...(updatedAt !== undefined ? { updatedAt } : {})
  };
}

export async function listRuns(outDir: string): Promise<RunInspection[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return [];
  }
  const inspections = await Promise.all(entries.map(async (entry) => {
    const root = path.join(outDir, entry);
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) return undefined;
      return inspectRun(outDir, entry);
    } catch {
      return undefined;
    }
  }));
  return inspections
    .filter((item): item is RunInspection => item !== undefined)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function killRun(outDir: string, runIdOrPath: string, signal: NodeJS.Signals = "SIGTERM"): Promise<RunInspection> {
  const rootDir = resolveRunRoot(outDir, runIdOrPath);
  const processMeta = await readProcessMetadata(rootDir);
  if (!processMeta) {
    throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, `Run '${runIdOrPath}' has no process.json metadata.`);
  }
  if (!isProcessAlive(processMeta.pid)) {
    await updateProcessMetadata(rootDir, { status: "stale" });
    throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, `Run '${runIdOrPath}' process ${processMeta.pid} is not running.`);
  }
  process.kill(processMeta.pid, signal);
  return inspectRun(outDir, runIdOrPath);
}

async function inferRunStatus(input: {
  manifest?: any;
  processMeta?: RunProcessMetadata | undefined;
  report?: any;
}): Promise<RunProcessStatus> {
  if (input.report?.status) return input.report.status;
  if (input.manifest?.status && input.manifest.status !== "running") return input.manifest.status;
  if (input.processMeta?.status === "running" && !isProcessAlive(input.processMeta.pid)) return "stale";
  return input.processMeta?.status || input.manifest?.status || "unknown";
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath: string): Promise<any | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function countJsonlLines(filePath: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content.split(/\r?\n/).filter((line) => line.trim() !== "").length;
  } catch {
    return 0;
  }
}
