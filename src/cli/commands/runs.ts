import * as fs from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { defaultRunsDir } from "../../artifacts/run-store.js";
import { inspectRun, killRun, listRuns, resolveRunRoot } from "../../artifacts/run-control.js";
import { resolveUserPath } from "../paths.js";

function resolveOutDir(rawOptions: any): string {
  const cwd = rawOptions.cwd ?? process.cwd();
  return rawOptions.out ? resolveUserPath(rawOptions.out, cwd) : defaultRunsDir(cwd);
}

export async function listCommand(input: { rawOptions: any }): Promise<void> {
  const outDir = resolveOutDir(input.rawOptions || {});
  const runs = await listRuns(outDir);
  if (input.rawOptions?.json) {
    process.stdout.write(JSON.stringify({ runs }, null, 2) + "\n");
    return;
  }
  for (const run of runs) {
    process.stdout.write(`${run.runId}\t${run.status}\t${run.updatedAt ?? ""}\t${run.rootDir}\n`);
  }
}

export async function inspectCommand(input: { runIdOrPath: string; rawOptions: any }): Promise<void> {
  const outDir = resolveOutDir(input.rawOptions || {});
  const inspection = await inspectRun(outDir, input.runIdOrPath);
  if (input.rawOptions?.json) {
    process.stdout.write(JSON.stringify(inspection, null, 2) + "\n");
    return;
  }
  process.stdout.write([
    `Run: ${inspection.runId}`,
    `Status: ${inspection.status}`,
    `Updated: ${inspection.updatedAt ?? "unknown"}`,
    `Artifacts: ${inspection.rootDir}`,
    `Events: ${inspection.eventCount}`
  ].join("\n") + "\n");
}

export async function killCommand(input: { runIdOrPath: string; rawOptions: any }): Promise<void> {
  const outDir = resolveOutDir(input.rawOptions || {});
  const signal = (input.rawOptions?.signal || "SIGTERM") as NodeJS.Signals;
  const inspection = await killRun(outDir, input.runIdOrPath, signal);
  if (input.rawOptions?.json) {
    process.stdout.write(JSON.stringify(inspection, null, 2) + "\n");
    return;
  }
  process.stdout.write(`Sent ${signal} to ${inspection.runId}\n`);
}

export async function watchCommand(input: { runIdOrPath: string; rawOptions: any }): Promise<void> {
  const outDir = resolveOutDir(input.rawOptions || {});
  const runRoot = resolveRunRoot(outDir, input.runIdOrPath);
  const eventsPath = path.join(runRoot, "events.jsonl");
  let offset = 0;
  let buffered = "";

  while (true) {
    try {
      const stat = await fs.stat(eventsPath);
      if (stat.size > offset) {
        const handle = await fs.open(eventsPath, "r");
        try {
          const length = stat.size - offset;
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, offset);
          offset = stat.size;
          buffered += buffer.toString("utf8");
          const lines = buffered.split(/\r?\n/);
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            if (input.rawOptions?.jsonl) {
              process.stdout.write(line + "\n");
            } else {
              const event = JSON.parse(line);
              process.stdout.write(`${event.timestamp ?? ""}\t${event.type}\t${JSON.stringify(event.payload ?? {})}\n`);
            }
          }
        } finally {
          await handle.close();
        }
      }
    } catch {
      // The run may not have created events.jsonl yet.
    }

    const inspection = await inspectRun(outDir, input.runIdOrPath);
    if (inspection.status === "succeeded" || inspection.status === "failed" || inspection.status === "cancelled" || inspection.status === "stale") {
      return;
    }
    await sleep(250);
  }
}
