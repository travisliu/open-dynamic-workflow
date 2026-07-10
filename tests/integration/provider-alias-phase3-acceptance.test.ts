import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const FIXTURE_DIR = path.resolve("tests/fixtures/provider-alias-phase3");
const TEMP_DIR = path.resolve("tests/temp-provider-alias-phase3");
const WORKFLOW = path.join(FIXTURE_DIR, "workflow.js");
const CONFIG = path.join(FIXTURE_DIR, "config.yaml");

async function runCli(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(chunk.toString());
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(chunk.toString());
    return true;
  });

  let error: unknown = null;
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (caught) {
    error = caught;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return { stdout: stdout.join(""), stderr: stderr.join(""), error };
}

async function runDirectories() {
  return (await fs.readdir(TEMP_DIR)).filter((entry) => entry !== ".DS_Store");
}

describe("Provider alias Phase 3 public acceptance", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("keeps direct-provider compatibility, concrete adapter input, and JSON parseability", async () => {
    const result = await runCli([
      "run", WORKFLOW, "--config", CONFIG, "--cwd", process.cwd(),
      "--out", TEMP_DIR, "--report", "json"
    ]);
    expect(result.error).toBeNull();

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.agents.map((agent: any) => agent.id)).toEqual(["aliased", "direct"]);

    const aliased = report.agents[0];
    const direct = report.agents[1];
    expect(aliased.provider).toBe("codex");
    expect(aliased.model).toBe("alias-review-model");
    expect(aliased.providerSelection.selection).toMatchObject({
      requestedProvider: "review-alias",
      providerAlias: "review-alias",
      resolvedProvider: "codex"
    });
    expect(direct.provider).toBe("codex");
    expect(direct.providerSelection.selection.providerAlias).toBeUndefined();

    const runId = (await runDirectories())[0]!;
    const runDir = path.join(TEMP_DIR, runId);
    const adapterLog = JSON.parse(await fs.readFile(path.join(runDir, "agents/aliased/stderr.log"), "utf8"));
    expect(adapterLog.argv).not.toContain("review-alias");
    expect(adapterLog.argv).toContain("--model");
    expect(adapterLog.argv).toContain("alias-review-model");
  });

  it("retains current alias metadata when an unchanged call is replayed from cache", async () => {
    const first = await runCli([
      "run", WORKFLOW, "--config", CONFIG, "--cwd", process.cwd(),
      "--out", TEMP_DIR, "--report", "json"
    ]);
    expect(first.error).toBeNull();
    const firstRunId = (await runDirectories())[0]!;

    const resumed = await runCli([
      "resume", firstRunId, "--out", TEMP_DIR, "--report", "json"
    ]);
    expect(resumed.error).toBeNull();

    const secondRunId = (await runDirectories()).find((id) => id !== firstRunId)!;
    const secondDir = path.join(TEMP_DIR, secondRunId);
    const report = JSON.parse(await fs.readFile(path.join(secondDir, "report.json"), "utf8"));
    const aliased = report.agents.find((agent: any) => agent.id === "aliased");
    expect(aliased.cache?.hit).toBe(true);
    expect(aliased.provider).toBe("codex");
    expect(aliased.providerSelection.selection.requestedProvider).toBe("review-alias");
    expect(aliased.providerSelection.resolvedExecution.model).toBe("alias-review-model");

    const events = (await fs.readFile(path.join(secondDir, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "agent.cache_hit")).toBe(true);
    const serialized = JSON.stringify({
      providerSelection: aliased.providerSelection,
      events: events.filter((event) =>
        event.type === "agent.provider-alias-resolved" ||
        event.type === "agent.provider-setting-overridden" ||
        event.type === "agent.cache_hit"
      ).map((event) => event.payload)
    });
    expect(serialized).not.toContain("PROVIDER_SECRET_SENTINEL");
    expect(serialized).not.toContain("env");
    expect(serialized).not.toContain("command");
  });
});
