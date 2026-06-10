import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  inspectRun,
  killRun,
  listRuns,
  writeProcessMetadata
} from "../../../src/artifacts/run-control.js";

const TEMP_DIR = path.resolve("tests/temp-run-control");

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

describe("run control metadata", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("infers stale status when process metadata points to a dead running process", async () => {
    const runRoot = path.join(TEMP_DIR, "stale-run");
    await writeProcessMetadata(runRoot, {
      schemaVersion: "openflow.process.v1",
      runId: "stale-run",
      pid: 99999999,
      mode: "background",
      startedAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:01.000Z",
      command: ["node", "openflow"],
      status: "running"
    });

    const inspection = await inspectRun(TEMP_DIR, "stale-run");
    expect(inspection.status).toBe("stale");
    expect(inspection.process?.status).toBe("running");
  });

  it("throws and persists stale status when killing a dead process", async () => {
    const runRoot = path.join(TEMP_DIR, "dead-run");
    await writeProcessMetadata(runRoot, {
      schemaVersion: "openflow.process.v1",
      runId: "dead-run",
      pid: 99999999,
      mode: "background",
      startedAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:01.000Z",
      command: ["node", "openflow"],
      status: "running"
    });

    await expect(killRun(TEMP_DIR, "dead-run")).rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
    const persisted = JSON.parse(await fs.readFile(path.join(runRoot, "process.json"), "utf8"));
    expect(persisted.status).toBe("stale");
  });

  it("orders listed runs by most recent update", async () => {
    await writeJson(path.join(TEMP_DIR, "old-run", "report.json"), {
      runId: "old-run",
      status: "succeeded",
      finishedAt: "2026-06-09T00:00:00.000Z"
    });
    await writeJson(path.join(TEMP_DIR, "new-run", "report.json"), {
      runId: "new-run",
      status: "failed",
      finishedAt: "2026-06-09T00:01:00.000Z"
    });

    const runs = await listRuns(TEMP_DIR);
    expect(runs.map((run) => run.runId)).toEqual(["new-run", "old-run"]);
  });

  it("rejects inspection of a missing run instead of returning unknown status", async () => {
    await expect(inspectRun(TEMP_DIR, "missing-run")).rejects.toMatchObject({ code: "CLI_USAGE_ERROR" });
  });
});
