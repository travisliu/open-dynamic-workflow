import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { main, runCli as renderCli } from "../../src/cli/index.js";

let projectDir: string;
let externalParent: string;

async function invokeMain(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => { stdout.push(String(chunk)); return true; }),
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => { stderr.push(String(chunk)); return true; }),
    vi.spyOn(console, "log").mockImplementation(() => undefined),
    vi.spyOn(console, "error").mockImplementation(() => undefined),
  ];
  let error: unknown;
  try {
    await main(["node", "odw", ...args]);
  } catch (caught) {
    error = caught;
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
  return { stdout: stdout.join(""), stderr: stderr.join(""), error: error as any };
}

async function invokeRenderedCli(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const priorExitCode = process.exitCode;
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(chunk => { stdout.push(String(chunk)); return true; });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(chunk => { stderr.push(String(chunk)); return true; });
  try {
    process.exitCode = undefined;
    await renderCli(args);
    return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode: process.exitCode };
  } finally {
    process.exitCode = priorExitCode;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

async function writeRunnableProject(configYaml: string, workflowSource?: string) {
  const workflows = path.join(projectDir, "workflows");
  const config = path.join(projectDir, "config.yaml");
  const workflow = path.join(workflows, "stable.workflow.js");
  await fs.mkdir(workflows, { recursive: true });
  await fs.writeFile(config, `defaultProvider: mock
providers:
  mock:
    command: mock
    responses:
      default:
        text: ok
workflow:
  discovery:
    include:
      - workflows/**/*.js
${configYaml}`, "utf8");
  await fs.writeFile(workflow, workflowSource ?? `export const meta = { name: "stable-workflow", description: "acceptance workflow" };
export default async () => agent({ id: "stable-agent", prompt: "hello" });
`, "utf8");
  return { config, workflow };
}

async function directRunIds(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function expectStrictRunLayout(root: string, id: string) {
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect((await fs.stat(path.join(root, id))).isDirectory()).toBe(true);
  await expect(fs.stat(path.join(root, id, id))).rejects.toThrow();
}

async function readJson(file: string): Promise<any> { return JSON.parse(await fs.readFile(file, "utf8")); }
async function readBytes(file: string): Promise<Buffer> { return fs.readFile(file); }
async function snapshotFiles(files: string[]) { return new Map(await Promise.all(files.map(async file => [file, await readBytes(file)] as const))); }
async function expectSnapshotUnchanged(snapshot: Map<string, Buffer>) {
  for (const [file, bytes] of snapshot) expect(await readBytes(file)).toEqual(bytes);
}
async function copyRunCandidate(source: string, destination: string) { await fs.cp(source, destination, { recursive: true }); }

function runArgs(workflow: string, config: string, extra: string[] = []) {
  return ["run", workflow, "--cwd", projectDir, "--config", config, "--report", "json", ...extra];
}
function resumeArgs(target: string, config: string, extra: string[] = []) {
  return ["resume", target, "--cwd", projectDir, "--config", config, "--report", "json", ...extra];
}

describe("outDir run and resume acceptance", () => {
  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-outdir-resume-"));
    externalParent = await fs.mkdtemp(path.join(os.tmpdir(), "odw-outdir-external-"));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(externalParent, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("stores configured and CLI-rooted runs in strict v2 layouts", async () => {
    // Arrange
    const { config, workflow } = await writeRunnableProject("outDir: configured-runs");
    const configuredRoot = path.join(projectDir, "configured-runs");
    const externalRoot = path.join(externalParent, "runs");

    // Act
    expect((await invokeMain(runArgs(workflow, config))).error).toBeUndefined();
    expect((await invokeMain(runArgs(workflow, config, ["--out", externalRoot]))).error).toBeUndefined();

    // Assert
    const configuredIds = await directRunIds(configuredRoot);
    const externalIds = await directRunIds(externalRoot);
    expect(configuredIds).toHaveLength(1);
    expect(externalIds).toHaveLength(1);
    const [configuredId] = configuredIds;
    const [externalId] = externalIds;
    await expectStrictRunLayout(configuredRoot, configuredId!);
    await expectStrictRunLayout(externalRoot, externalId!);
    const configuredInput = await readJson(path.join(configuredRoot, configuredId!, "run-input.json"));
    expect(await readJson(path.join(configuredRoot, configuredId!, "config.resolved.json"))).toMatchObject({ outDir: configuredRoot });
    expect((await readJson(path.join(configuredRoot, configuredId!, "config.resolved.json")))._resolution).toBeUndefined();
    expect(configuredInput).toMatchObject({ schemaVersion: "open-dynamic-workflow.run-input.v2", output: { effectiveRunsRoot: configuredRoot, source: "config" } });
    expect(await readJson(path.join(externalRoot, externalId!, "run-input.json"))).toMatchObject({ output: { effectiveRunsRoot: externalRoot, source: "cli", explicitCliOut: externalRoot } });
    expect(await directRunIds(configuredRoot)).toEqual([configuredId]);
    expect(await directRunIds(externalRoot)).toEqual([externalId]);
  });

  it("uses the recorded profile name from today's catalog and keeps all continuation sources byte-identical", async () => {
    // Arrange
    const first = await writeRunnableProject(`outDir: global-runs
profiles:
  retained: {}`);
    const globalRoot = path.join(projectDir, "global-runs");
    const profileRoot = path.join(projectDir, "current-profile-runs");
    expect((await invokeMain(runArgs(first.workflow, first.config, ["--profile", "retained"]))).error).toBeUndefined();
    const [sourceId] = await directRunIds(globalRoot);
    const source = path.join(globalRoot, sourceId!);
    const sourceIndex = await readJson(path.join(source, "cache-index.json"));
    const snapshot = await snapshotFiles(["run-input.json", "manifest.json", "cache-index.json", sourceIndex.entries[0].resultPath].map(file => path.join(source, file)));
    await fs.writeFile(first.config, `defaultProvider: mock
providers:
  mock:
    command: mock
    responses: { default: { text: ok } }
outDir: global-runs
profiles:
  root: { outDir: current-profile-runs }
  retained: { extends: root }
workflow:
  discovery: { include: ["workflows/**/*.js"] }
`);

    const beforeStandalone = await directRunIds(profileRoot);

    // Act
    expect((await invokeMain(resumeArgs(sourceId!, first.config))).error).toBeUndefined();
    const afterStandalone = await directRunIds(profileRoot);
    const standaloneContinuation = afterStandalone.find(id => !beforeStandalone.includes(id));
    expect(afterStandalone).toHaveLength(beforeStandalone.length + 1);
    expect(standaloneContinuation).toBeDefined();
    await expectStrictRunLayout(profileRoot, standaloneContinuation!);
    expect(standaloneContinuation).not.toBe(sourceId);

    const beforeRunResume = await directRunIds(profileRoot);
    expect((await invokeMain(runArgs(first.workflow, first.config, ["--resume", source, "--profile", "retained"]))).error).toBeUndefined();
    const afterRunResume = await directRunIds(profileRoot);
    const runContinuation = afterRunResume.find(id => !beforeRunResume.includes(id));

    // Assert
    expect(afterRunResume).toHaveLength(beforeRunResume.length + 1);
    expect(runContinuation).toBeDefined();
    await expectStrictRunLayout(profileRoot, runContinuation!);
    expect(runContinuation).not.toBe(sourceId);
    expect(runContinuation).not.toBe(standaloneContinuation);
    expect(await directRunIds(globalRoot)).toEqual([sourceId]);
    await expectSnapshotUnchanged(snapshot);
  });

  it("uses effective-root then legacy lookup, but never falls back from explicit paths", async () => {
    // Arrange
    const { config, workflow } = await writeRunnableProject("outDir: effective-runs");
    const effective = path.join(projectDir, "effective-runs");
    const legacy = path.join(projectDir, ".open-dynamic-workflow", "runs");
    expect((await invokeMain(runArgs(workflow, config))).error).toBeUndefined();
    const [id] = await directRunIds(effective);
    await fs.mkdir(legacy, { recursive: true });
    await copyRunCandidate(path.join(effective, id!), path.join(legacy, id!));
    await fs.writeFile(path.join(legacy, id!, "cache-index.json"), "not valid JSON");

    // Act
    const beforeEffectiveLookup = await directRunIds(effective);
    expect((await invokeMain(runArgs(workflow, config, ["--resume", id!]))).error).toBeUndefined();
    const afterEffectiveLookup = await directRunIds(effective);
    const effectiveContinuation = afterEffectiveLookup.find(candidate => !beforeEffectiveLookup.includes(candidate));
    expect(afterEffectiveLookup).toHaveLength(beforeEffectiveLookup.length + 1);
    expect(effectiveContinuation).toBeDefined();
    await expectStrictRunLayout(effective, effectiveContinuation!);
    expect(await readJson(path.join(effective, effectiveContinuation!, "report.json"))).toMatchObject({ agents: [{ cache: { hit: true } }] });
    expect(await fs.stat(path.join(effective, effectiveContinuation!, "agents", "stable-agent", "cache-hit.json"))).toBeDefined();

    const fallbackSource = effectiveContinuation!;
    await copyRunCandidate(path.join(effective, fallbackSource), path.join(legacy, fallbackSource));
    const fallbackSnapshot = await snapshotFiles([
      path.join(legacy, fallbackSource, "run-input.json"),
      path.join(legacy, fallbackSource, "manifest.json"),
      path.join(legacy, fallbackSource, "cache-index.json"),
    ]);
    await fs.rm(path.join(effective, fallbackSource), { recursive: true });
    const beforeFallback = await directRunIds(effective);
    expect((await invokeMain(runArgs(workflow, config, ["--resume", fallbackSource]))).error).toBeUndefined();
    const afterFallback = await directRunIds(effective);
    const fallbackContinuation = afterFallback.find(candidate => !beforeFallback.includes(candidate));
    const beforeExplicit = await directRunIds(effective);
    const relative = await invokeMain(resumeArgs("./missing-id", config));
    const absolute = await invokeMain(resumeArgs(path.join(projectDir, "missing-absolute"), config));

    // Assert
    expect(afterFallback).toHaveLength(beforeFallback.length + 1);
    expect(fallbackContinuation).toBeDefined();
    await expectStrictRunLayout(effective, fallbackContinuation!);
    expect(fallbackContinuation).not.toBe(fallbackSource);
    await expectSnapshotUnchanged(fallbackSnapshot);
    await expect(fs.stat(path.join(effective, fallbackSource))).rejects.toThrow();
    expect(relative.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(absolute.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(relative.error.message).toContain(path.join(projectDir, "missing-id"));
    expect(absolute.error.message).toContain(path.join(projectDir, "missing-absolute"));
    expect(await directRunIds(effective)).toEqual(beforeExplicit);
    expect(await fs.stat(path.join(legacy, fallbackSource))).toBeDefined();
  });

  it("rejects conflicting and invalid previous storage before a continuation mutates it", async () => {
    // Arrange
    const { config } = await writeRunnableProject("outDir: effective-runs");
    const root = path.join(projectDir, "effective-runs");
    const sentinel = path.join(projectDir, "sentinel.txt");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(sentinel, "outside bytes");
    const badFile = path.join(root, "regular-file");
    await fs.writeFile(badFile, "file bytes");
    const missingInput = path.join(root, "missing-input");
    const malformed = path.join(root, "malformed");
    await fs.mkdir(missingInput); await fs.mkdir(malformed);
    await fs.writeFile(path.join(malformed, "run-input.json"), JSON.stringify({ schemaVersion: "open-dynamic-workflow.run-input.v2", output: { effectiveRunsRoot: root, source: "unknown" }, invocation: {} }));
    const snapshots = await snapshotFiles([badFile, sentinel, path.join(malformed, "run-input.json")]);

    // Act
    const regularFile = await invokeMain(resumeArgs("regular-file", config));
    const missingInputResult = await invokeMain(resumeArgs("missing-input", config));
    const malformedResult = await invokeMain(resumeArgs("malformed", config));

    // Assert
    expect(regularFile.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(regularFile.error.message).toContain(badFile);
    expect(missingInputResult.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(missingInputResult.error.message).toContain("run-input.json");
    expect(malformedResult.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(malformedResult.error.message).toMatch(/malformed|run-input\.json/i);
    expect(await directRunIds(root)).toEqual(["malformed", "missing-input"]);
    await expectSnapshotUnchanged(snapshots);
    expect([regularFile, missingInputResult, malformedResult].every(result => !result.stdout.includes("success"))).toBe(true);
  });

  it("reads v1 only as audit data and writes the continuation beneath the current root as v2", async () => {
    // Arrange
    const initial = await writeRunnableProject("outDir: old-runs");
    const oldRoot = path.join(projectDir, "old-runs");
    expect((await invokeMain(runArgs(initial.workflow, initial.config))).error).toBeUndefined();
    const [sourceId] = await directRunIds(oldRoot);
    const source = path.join(oldRoot, sourceId!);
    const original = await readJson(path.join(source, "run-input.json"));
    const v1 = { schemaVersion: "open-dynamic-workflow.run-input.v1", runId: sourceId, workflowFile: original.workflowFile, requestedTarget: original.requestedTarget, targetKind: original.targetKind, workflowName: original.workflowName, cwd: projectDir, configPath: initial.config, outDir: path.join(externalParent, "stale-root"), rawOptions: { arg: [], out: path.join(externalParent, "also-stale") } };
    await fs.writeFile(path.join(source, "run-input.json"), JSON.stringify(v1));
    await fs.writeFile(initial.config, `defaultProvider: mock
providers:
  mock:
    command: mock
    responses: { default: { text: ok } }
outDir: current-runs
workflow:
  discovery: { include: ["workflows/**/*.js"] }
`);
    const current = path.join(projectDir, "current-runs");
    const sourceSnapshot = await snapshotFiles([path.join(source, "run-input.json"), path.join(source, "manifest.json"), path.join(source, "cache-index.json")]);

    // Act
    const result = await invokeMain(resumeArgs(source, initial.config));

    // Assert
    expect(result.error).toBeUndefined();
    const continuations = await directRunIds(current);
    expect(continuations).toHaveLength(1);
    const [continuation] = continuations;
    await expectStrictRunLayout(current, continuation!);
    expect(continuation).not.toBe(sourceId);
    expect(await readJson(path.join(current, continuation!, "run-input.json"))).toMatchObject({ schemaVersion: "open-dynamic-workflow.run-input.v2", output: { effectiveRunsRoot: current } });
    expect(await directRunIds(path.join(externalParent, "stale-root"))).toEqual([]);
    expect(await directRunIds(path.join(externalParent, "also-stale"))).toEqual([]);
    await expectSnapshotUnchanged(sourceSnapshot);
    expect(await directRunIds(oldRoot)).toEqual([sourceId]);
  });

  it("reuses external-root cache artifacts and contains malicious cache paths", async () => {
    // Arrange
    const { config, workflow } = await writeRunnableProject("");
    const root = path.join(externalParent, "runs");
    expect((await invokeMain(runArgs(workflow, config, ["--out", root]))).error).toBeUndefined();
    const [sourceId] = await directRunIds(root);
    const source = path.join(root, sourceId!);
    const sourceSnapshot = await snapshotFiles([path.join(source, "run-input.json"), path.join(source, "cache-index.json")]);

    // Act
    expect((await invokeMain(runArgs(workflow, config, ["--out", root, "--resume", sourceId!]))).error).toBeUndefined();
    const continuation = (await directRunIds(root)).find(id => id !== sourceId)!;
    await expectSnapshotUnchanged(sourceSnapshot);
    const index = await readJson(path.join(source, "cache-index.json"));
    const sentinel = path.join(projectDir, "outside-sentinel.txt");
    await fs.writeFile(sentinel, "unchanged");
    index.entries[0].resultPath = "../../outside-sentinel.txt";
    await fs.writeFile(path.join(source, "cache-index.json"), JSON.stringify(index));
    const before = await directRunIds(root);
    const traversal = await invokeMain(runArgs(workflow, config, ["--out", root, "--resume", sourceId!]));

    // Assert
    expect(await readJson(path.join(root, continuation, "report.json"))).toMatchObject({ agents: [{ id: "stable-agent", cache: { hit: true } }] });
    expect(await fs.stat(path.join(root, continuation, "agents", "stable-agent", "cache-hit.json"))).toBeDefined();
    expect(traversal.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(await fs.readFile(sentinel, "utf8")).toBe("unchanged");
    const after = await directRunIds(root);
    const attempted = after.filter(id => !before.includes(id));
    expect(attempted.length).toBeLessThanOrEqual(1);
    if (attempted[0]) {
      const attemptedReport = await readJson(path.join(root, attempted[0], "report.json"));
      expect(attemptedReport.status).not.toBe("success");
      expect(attemptedReport.agents?.some((agent: any) => agent.cache?.hit)).not.toBe(true);
      expect(await pathExists(path.join(root, attempted[0], "agents", "stable-agent", "cache-hit.json"))).toBe(false);
    }
    for (const id of after) expect(path.dirname(path.join(root, id))).toBe(root);
  });

  it("renders standalone resume failures as JSON and JSONL error envelopes", async () => {
    // Arrange
    const { config } = await writeRunnableProject("outDir: effective-runs");
    const missing = path.join(projectDir, "absent-run");

    // Act
    const json = await invokeRenderedCli(["resume", missing, "--cwd", projectDir, "--config", config, "--report", "json"]);
    const jsonl = await invokeRenderedCli(["resume", missing, "--cwd", projectDir, "--config", config, "--report", "jsonl"]);

    // Assert
    expect(JSON.parse(json.stdout)).toMatchObject({ schemaVersion: "open-dynamic-workflow.error.v1", status: "failed", error: { code: "CLI_USAGE_ERROR" } });
    const lines = jsonl.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(lines).toEqual([expect.objectContaining({ type: "cli.error", error: expect.objectContaining({ code: "CLI_USAGE_ERROR" }) })]);
    expect(json.stderr).toBe("");
    expect(jsonl.stderr).toBe("");
    expect(json.exitCode).toBe(2);
    expect(jsonl.exitCode).toBe(2);
  });
});
