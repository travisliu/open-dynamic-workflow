import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "../../src/cli/index.js";

let projectDir: string;
let externalRoot: string;

async function runCli(args: string[]) {
  const stdout: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    stdout.push(String(chunk));
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  let error: any;
  try {
    await main(["node", "odw", ...args]);
  } catch (caught) {
    error = caught;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return { error, stdout: stdout.join("") };
}

async function runDirectories(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function assertRunProvenance(root: string, id: string, expected: Record<string, unknown>) {
  await expect(fs.stat(path.join(root, id, id))).rejects.toThrow();
  const resolved = await readJson(path.join(root, id, "config.resolved.json"));
  const input = await readJson(path.join(root, id, "run-input.json"));
  expect(resolved.outDir).toBe(root);
  expect(resolved._resolution).toBeUndefined();
  expect(input.output).toMatchObject({ effectiveRunsRoot: root, ...expected });
}

async function writeProject(config: string) {
  await fs.mkdir(path.join(projectDir, "workflows"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "workflows", "demo.workflow.js"), `
export const meta = { name: "configured-artifacts", description: "configured artifact root test" };
export default async () => agent({ id: "demo", prompt: "hello" });
`);
  await fs.writeFile(path.join(projectDir, "config.yaml"), config);
}

function baseConfig(extra = "") {
  return `
defaultProvider: mock
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
${extra}`;
}

function command(extra: string[] = []) {
  return ["run", "workflows/demo.workflow.js", "--cwd", projectDir, "--config", path.join(projectDir, "config.yaml"), "--report", "json", ...extra];
}

describe("configured artifact run paths", () => {
  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-configured-runs-"));
    externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "odw-external-runs-"));
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(externalRoot, { recursive: true, force: true });
  });

  it("creates exactly one run directory under configured relative and external roots with persisted provenance", async () => {
    await writeProject(baseConfig("outDir: configured-runs"));

    const configured = await runCli(command());
    expect(configured.error).toBeUndefined();
    const configuredRoot = path.join(projectDir, "configured-runs");
    const [configuredId] = await runDirectories(configuredRoot);
    expect(configuredId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(fs.stat(path.join(configuredRoot, configuredId!, configuredId!))).rejects.toThrow();

    const resolved = JSON.parse(await fs.readFile(path.join(configuredRoot, configuredId!, "config.resolved.json"), "utf8"));
    const input = JSON.parse(await fs.readFile(path.join(configuredRoot, configuredId!, "run-input.json"), "utf8"));
    expect(resolved.outDir).toBe(configuredRoot);
    expect(resolved._resolution).toBeUndefined();
    expect(input.output).toMatchObject({ effectiveRunsRoot: configuredRoot, source: "config" });

    const external = await runCli(command(["--out", externalRoot]));
    expect(external.error).toBeUndefined();
    const [externalId] = await runDirectories(externalRoot);
    const externalInput = JSON.parse(await fs.readFile(path.join(externalRoot, externalId!, "run-input.json"), "utf8"));
    expect(externalInput.output).toMatchObject({ effectiveRunsRoot: externalRoot, source: "cli", explicitCliOut: externalRoot });
  });

  it("applies CLI, profile, config, and built-in roots in precedence order with v2 provenance", async () => {
    await writeProject(baseConfig(`
outDir: global-runs
profiles:
  profile-root-base:
    outDir: profile-runs
  inherited:
    extends: profile-root-base
  no-root:
    args:
      profile: no-root`));

    const globalRoot = path.join(projectDir, "global-runs");
    const profileRoot = path.join(projectDir, "profile-runs");
    expect((await runCli(command())).error).toBeUndefined();
    const [globalId] = await runDirectories(globalRoot);
    await assertRunProvenance(globalRoot, globalId!, { source: "config" });

    expect((await runCli(command(["--profile", "inherited"]))).error).toBeUndefined();
    const [profileId] = await runDirectories(profileRoot);
    await assertRunProvenance(profileRoot, profileId!, { source: "profile", selectedProfile: "inherited" });

    expect((await runCli(command(["--profile", "inherited", "--out", externalRoot]))).error).toBeUndefined();
    const [cliId] = await runDirectories(externalRoot);
    await assertRunProvenance(externalRoot, cliId!, { source: "cli", selectedProfile: "inherited", explicitCliOut: externalRoot });

    expect((await runCli(command(["--profile", "no-root"]))).error).toBeUndefined();
    const idsAfterNoRoot = await runDirectories(globalRoot);
    const noRootId = idsAfterNoRoot.find(id => id !== globalId);
    await assertRunProvenance(globalRoot, noRootId!, { source: "config", selectedProfile: "no-root" });

    await writeProject(baseConfig());
    const builtInRoot = path.join(projectDir, ".open-dynamic-workflow", "runs");
    expect((await runCli(command())).error).toBeUndefined();
    const [builtInId] = await runDirectories(builtInRoot);
    await assertRunProvenance(builtInRoot, builtInId!, { source: "built-in-default" });
  });

  it("uses the current profile root for standalone resume and keeps explicit paths from falling back", async () => {
    await writeProject(baseConfig(`
outDir: base-runs
profiles:
  retained:
    args:
      profile: retained`));

    const baseRoot = path.join(projectDir, "base-runs");
    const profileRoot = path.join(projectDir, "profile-runs");
    // The recorded profile initially inherits the configured global root.
    expect((await runCli(command(["--profile", "retained"]))).error).toBeUndefined();
    const [sourceId] = await runDirectories(baseRoot);
    expect(sourceId).toBeDefined();
    const sourceInputPath = path.join(baseRoot, sourceId!, "run-input.json");
    const sourceInput = await fs.readFile(sourceInputPath, "utf8");

    // The current catalog now gives the same recorded profile an inherited
    // root. Lookup still starts at the global root, while continuation uses
    // this current profile root.
    await writeProject(baseConfig(`
outDir: base-runs
profiles:
  profile-root-base:
    outDir: profile-runs
  retained:
    extends: profile-root-base
    args:
      profile: retained`));

    expect((await runCli(["resume", sourceId!, "--cwd", projectDir, "--config", path.join(projectDir, "config.yaml"), "--report", "json"])).error).toBeUndefined();
    const profileRuns = await runDirectories(profileRoot);
    expect(profileRuns).toHaveLength(1);
    expect(profileRuns[0]).not.toBe(sourceId);
    expect(await runDirectories(baseRoot)).toEqual([sourceId]);
    expect(await fs.readFile(sourceInputPath, "utf8")).toBe(sourceInput);

    // An explicit relative path must not fall back to the eligible bare-ID
    // candidate beneath the effective root.
    const bareIdCandidate = path.join(baseRoot, "missing-run");
    await fs.cp(path.join(baseRoot, sourceId!), bareIdCandidate, { recursive: true });
    const candidateInputPath = path.join(bareIdCandidate, "run-input.json");
    const candidateInput = await fs.readFile(candidateInputPath, "utf8");
    const baseRunsBeforeExplicit = await runDirectories(baseRoot);
    const before = await runDirectories(profileRoot);
    const missingExplicit = await runCli(["resume", "./missing-run", "--cwd", projectDir, "--config", path.join(projectDir, "config.yaml")]);
    expect(missingExplicit.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(await runDirectories(profileRoot)).toEqual(before);
    expect(await runDirectories(baseRoot)).toEqual(baseRunsBeforeExplicit);
    expect(await fs.readFile(candidateInputPath, "utf8")).toBe(candidateInput);
  });

  it("prefers effective bare-ID lookup and always creates continuations beneath the current effective root", async () => {
    await writeProject(baseConfig("outDir: effective-runs"));
    const effectiveRoot = path.join(projectDir, "effective-runs");
    const legacyRoot = path.join(projectDir, ".open-dynamic-workflow", "runs");

    expect((await runCli(command(["--arg", "origin=effective"]))).error).toBeUndefined();
    const [effectiveId] = await runDirectories(effectiveRoot);
    const effectiveInputPath = path.join(effectiveRoot, effectiveId!, "run-input.json");
    const effectiveInput = await fs.readFile(effectiveInputPath, "utf8");
    await fs.mkdir(legacyRoot, { recursive: true });
    await fs.cp(path.join(effectiveRoot, effectiveId!), path.join(legacyRoot, effectiveId!), { recursive: true });
    const legacyInput = await readJson(path.join(legacyRoot, effectiveId!, "run-input.json"));
    // A legacy selection would fail identity validation; success proves that
    // the same bare ID was resolved from the effective root first.
    legacyInput.workflowFile = path.join(projectDir, "workflows", "legacy-only.workflow.js");
    await fs.writeFile(path.join(legacyRoot, effectiveId!, "run-input.json"), JSON.stringify(legacyInput));

    expect((await runCli(command(["--resume", effectiveId!]))).error).toBeUndefined();
    const afterEffective = await runDirectories(effectiveRoot);
    const effectiveContinuation = afterEffective.find(id => id !== effectiveId);
    expect(effectiveContinuation).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await fs.stat(path.join(effectiveRoot, effectiveId!))).toBeDefined();
    expect(await fs.readFile(effectiveInputPath, "utf8")).toBe(effectiveInput);

    expect((await runCli(command(["--arg", "origin=fallback"]))).error).toBeUndefined();
    const fallbackId = (await runDirectories(effectiveRoot)).find(id => id !== effectiveId && id !== effectiveContinuation);
    await fs.cp(path.join(effectiveRoot, fallbackId!), path.join(legacyRoot, fallbackId!), { recursive: true });
    await fs.rm(path.join(effectiveRoot, fallbackId!), { recursive: true, force: true });

    expect((await runCli(command(["--resume", fallbackId!]))).error).toBeUndefined();
    const finalIds = await runDirectories(effectiveRoot);
    const fallbackContinuation = finalIds.find(id => id !== effectiveId && id !== effectiveContinuation);
    expect(fallbackContinuation).toMatch(/^[0-9a-f-]{36}$/i);
    expect(fallbackContinuation).not.toBe(fallbackId);
    expect(await fs.stat(path.join(legacyRoot, fallbackId!))).toBeDefined();
  });

  it("does not fall back from explicit absolute targets and creates no run for profile or target failures", async () => {
    await writeProject(baseConfig(`
outDir: effective-runs
profiles:
  valid:
    outDir: profile-runs`));
    const effectiveRoot = path.join(projectDir, "effective-runs");
    const missingAbsolute = path.join(projectDir, "missing-absolute-run");
    const fileAbsolute = path.join(projectDir, "not-a-run.txt");
    await fs.writeFile(fileAbsolute, "not a directory");

    for (const target of [missingAbsolute, fileAbsolute]) {
      const result = await runCli(["resume", target, "--cwd", projectDir, "--config", path.join(projectDir, "config.yaml")]);
      expect(result.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
      expect(await runDirectories(effectiveRoot)).toEqual([]);
    }
    const profileFailure = await runCli(["resume", "missing-id", "--cwd", projectDir, "--config", path.join(projectDir, "config.yaml"), "--profile", "missing"]);
    expect(profileFailure.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    const targetFailure = await runCli(["resume", "missing-id", "--cwd", projectDir, "--config", path.join(projectDir, "config.yaml")]);
    expect(targetFailure.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(await runDirectories(effectiveRoot)).toEqual([]);
  });

  it("reuses a valid cache from a run stored under an external root", async () => {
    await writeProject(baseConfig());
    expect((await runCli(command(["--out", externalRoot]))).error).toBeUndefined();
    const [previousId] = await runDirectories(externalRoot);

    expect((await runCli(command(["--out", externalRoot, "--resume", previousId!]))).error).toBeUndefined();
    const ids = await runDirectories(externalRoot);
    const continuationId = ids.find(id => id !== previousId);
    expect(continuationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await fs.stat(path.join(externalRoot, continuationId!, "agents", "demo", "cache-hit.json"))).toBeDefined();
  });

  it("rejects cache result paths that escape an externally rooted previous run", async () => {
    await writeProject(baseConfig());
    const sentinel = path.join(projectDir, "outside-sentinel.txt");
    await fs.writeFile(sentinel, "unchanged");
    expect((await runCli(command(["--out", externalRoot]))).error).toBeUndefined();
    const [runId] = await runDirectories(externalRoot);
    const indexPath = path.join(externalRoot, runId!, "cache-index.json");
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    index.entries[0].resultPath = "../../outside-sentinel.txt";
    await fs.writeFile(indexPath, JSON.stringify(index));

    const resumed = await runCli(command(["--out", externalRoot, "--resume", runId!]));
    expect(resumed.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(await fs.readFile(sentinel, "utf8")).toBe("unchanged");
  });

  it("validates incompatible retry flags before any previous-run lookup or artifact creation", async () => {
    await writeProject(baseConfig("outDir: configured-runs"));
    const result = await runCli([
      "resume",
      "missing-run",
      "--cwd", projectDir,
      "--config", path.join(projectDir, "config.yaml"),
      "--no-retry",
      "--retry-delay-ms", "1",
    ]);

    expect(result.error).toMatchObject({ code: "CLI_USAGE_ERROR" });
    expect(result.error.message).toContain("Cannot combine --no-retry");
    expect(await runDirectories(path.join(projectDir, "configured-runs"))).toEqual([]);
  });
});
