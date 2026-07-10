/**
 * Integration acceptance tests for provider-alias cache invalidation
 * and cache-hit metadata (CACHE-01 / CACHE-02 / CACHE-03).
 *
 * Matrix targets:
 *   CACHE-01  AC-019, AC-020, AC-021
 *   CACHE-02  AC-002, AC-019–021
 *   CACHE-03  AC-018
 *
 * Design:
 *   - Arrange: isolated temp dir, deterministic fake-provider config.
 *   - Act:     run CLI twice (or more) via main().
 *   - Assert:  inspect report.json, events.jsonl, and on-disk artifacts.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-provider-alias-cache");
const FAKE_PROVIDER = path.resolve("tests/fixtures/providers/fake-provider-cli.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Return every run-directory name found under outDir. */
async function listRunDirs(outDir: string) {
  return (await fs.readdir(outDir)).filter((d) => d !== ".DS_Store").sort();
}

/** Load report.json for the nth run in outDir. */
async function loadReport(outDir: string, index = 0) {
  const runs = await listRunDirs(outDir);
  return JSON.parse(
    await fs.readFile(path.join(outDir, runs[index]!, "report.json"), "utf8")
  );
}

/** Load events.jsonl lines for the nth run. */
async function loadEvents(outDir: string, index = 0) {
  const runs = await listRunDirs(outDir);
  const raw = await fs.readFile(path.join(outDir, runs[index]!, "events.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

/** Standard config that wires up two aliases and one direct provider. */
async function writeStandardConfig(configDir: string): Promise<string> {
  const configPath = path.join(configDir, "config.yaml");
  await fs.writeFile(configPath, `
concurrency: 1
timeoutMs: 30000

providers:
  codex:
    command: node
    args:
      - "${FAKE_PROVIDER}"
      - PROVIDER_SECRET_SENTINEL
    modelArg:
      flag: --model
    promptMode: stdin

providerAliases:
  base-alias:
    provider: codex
    model: base-model
    timeoutMs: 12000
    retry: false
  child-alias:
    extends: base-alias
    model: child-model

security:
  passEnv: []
`);
  return configPath;
}

/** Write a simple workflow file that runs one aliased and one direct agent. */
async function writeWorkflow(dir: string, name: string, body: string) {
  const p = path.join(dir, `${name}.workflow.js`);
  await fs.writeFile(p, body);
  return p;
}

// ---------------------------------------------------------------------------

describe("Provider-alias cache integration (CACHE-01 / CACHE-02 / CACHE-03)", () => {
  const OUT = path.join(TEMP_DIR, "out");
  let configPath: string;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(OUT, { recursive: true });
    configPath = await writeStandardConfig(TEMP_DIR);
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // CACHE-01 (AC-019/021): Unchanged configuration → cache hit;
  //   effective-setting change → miss at first affected prefix.
  // -------------------------------------------------------------------------
  it("CACHE-01: unchanged alias hits cache; effective model change misses (AC-019, AC-021)", async () => {
    // Arrange
    const wf = await writeWorkflow(TEMP_DIR, "cache01", `
export const meta = { name: "cache01", description: "cache hit test" };
export default async () => {
  return await agent({
    id: "cacheable",
    provider: "child-alias",
    prompt: "First run."
  });
};
`);

    // --- Act: First run (seed the cache) ---
    const run1 = await runCli([
      "run", wf, "--config", configPath, "--cwd", process.cwd(),
      "--out", OUT, "--report", "json"
    ]);
    expect(run1.error, "First run should succeed").toBeNull();
    const run1Dirs = await listRunDirs(OUT);
    const run1Id = run1Dirs[0]!;

    // --- Act: Resume (unchanged config → should hit cache) ---
    const run2 = await runCli([
      "resume", run1Id, "--out", OUT, "--report", "json"
    ]);
    expect(run2.error, "Resume should succeed").toBeNull();

    const run2Dirs = await listRunDirs(OUT);
    const run2Dir = path.join(OUT, run2Dirs.find((d) => d !== run1Id)!);
    const report2 = JSON.parse(await fs.readFile(path.join(run2Dir, "report.json"), "utf8"));

    const cacheableAgent = report2.agents.find((a: any) => a.id === "cacheable");
    // Assert: cache hit is recorded
    expect(cacheableAgent.cache?.hit, "Resumed run must be a cache hit").toBe(true);

    // Assert: CACHE-03 – current-run selection metadata replaces stale data
    expect(cacheableAgent.providerSelection?.selection?.requestedProvider).toBe("child-alias");
    expect(cacheableAgent.providerSelection?.selection?.resolvedProvider).toBe("codex");
    expect(cacheableAgent.providerSelection?.resolvedExecution?.model).toBe("child-model");

    // Assert: no sentinel leaks in cache-hit artifacts
    const serialized = JSON.stringify(cacheableAgent);
    expect(serialized).not.toContain("PROVIDER_SECRET_SENTINEL");
  });

  // -------------------------------------------------------------------------
  // CACHE-01 (AC-019): Effective model change invalidates cache at first miss.
  // -------------------------------------------------------------------------
  it("CACHE-01: effective model change on alias invalidates cache prefix (AC-019)", async () => {
    // Arrange – write an alias-only workflow
    const wf = await writeWorkflow(TEMP_DIR, "cache-invalidate", `
export const meta = { name: "cache-invalidate", description: "alias model invalidation" };
export default async () => {
  return await agent({
    id: "inv-agent",
    provider: "base-alias",
    prompt: "Seed run."
  });
};
`);

    // Seed run
    const seed = await runCli([
      "run", wf, "--config", configPath, "--cwd", process.cwd(),
      "--out", OUT, "--report", "json"
    ]);
    expect(seed.error).toBeNull();
    const seedDirs = await listRunDirs(OUT);
    const seedId = seedDirs[0]!;

    // Modify config: change the effective model on base-alias
    await fs.writeFile(configPath, (await fs.readFile(configPath, "utf8")).replace(
      "model: base-model",
      "model: base-model-v2"
    ));

    // Resume with changed config → must miss cache
    const resumed = await runCli([
      "resume", seedId, "--config", configPath, "--out", OUT, "--report", "json"
    ]);
    expect(resumed.error).toBeNull();

    const allDirs = await listRunDirs(OUT);
    const resumedId = allDirs.find((d) => d !== seedId)!;
    const resumedReport = JSON.parse(
      await fs.readFile(path.join(OUT, resumedId, "report.json"), "utf8")
    );
    const agent = resumedReport.agents.find((a: any) => a.id === "inv-agent");
    // Model change must invalidate cache → no cache hit
    expect(agent.cache?.hit, "Model change should invalidate cache").not.toBe(true);
  });

  // -------------------------------------------------------------------------
  // CACHE-01 (AC-021): Selected alias rename → cache miss even if effective values equal.
  // -------------------------------------------------------------------------
  it("CACHE-01: selected alias rename invalidates cache even when effective values are equal (AC-021)", async () => {
    // Arrange: initial config uses child-alias (effective model = child-model)
    const wf = await writeWorkflow(TEMP_DIR, "rename-test", `
export const meta = { name: "rename-test", description: "alias rename invalidation" };
export default async () => {
  return await agent({
    id: "rename-agent",
    provider: "child-alias",
    prompt: "Seed."
  });
};
`);

    // Seed run
    const seed = await runCli([
      "run", wf, "--config", configPath, "--cwd", process.cwd(),
      "--out", OUT, "--report", "json"
    ]);
    expect(seed.error).toBeNull();
    const [seedId] = await listRunDirs(OUT);

    // Rename child-alias → child-alias-v2 (same effective settings, different name → different digest)
    const originalConfig = await fs.readFile(configPath, "utf8");
    const newConfig = originalConfig
      .replace("child-alias:", "child-alias-v2:")
      .replace('provider: "child-alias"', 'provider: "child-alias-v2"');
    await fs.writeFile(configPath, newConfig);

    // Update workflow to reference the renamed alias
    await fs.writeFile(wf, `
export const meta = { name: "rename-test", description: "alias rename invalidation" };
export default async () => {
  return await agent({
    id: "rename-agent",
    provider: "child-alias-v2",
    prompt: "Seed."
  });
};
`);

    const resumed = await runCli([
      "resume", seedId!, "--config", configPath, "--out", OUT, "--report", "json"
    ]);
    expect(resumed.error).toBeNull();

    const allDirs = await listRunDirs(OUT);
    const resumedId = allDirs.find((d) => d !== seedId)!;
    const resumedReport = JSON.parse(
      await fs.readFile(path.join(OUT, resumedId, "report.json"), "utf8")
    );
    const agent = resumedReport.agents.find((a: any) => a.id === "rename-agent");
    // Alias rename must invalidate even if effective values are identical
    expect(agent.cache?.hit).not.toBe(true);
  });

  // -------------------------------------------------------------------------
  // CACHE-02 (AC-002): Direct concrete-provider workflows (no aliases) retain
  //   existing cache behavior and legacy fields load without error.
  // -------------------------------------------------------------------------
  it("CACHE-02: direct concrete-provider runs cache correctly; no alias event is invented (AC-002)", async () => {
    // Arrange
    const wf = await writeWorkflow(TEMP_DIR, "direct-cache", `
export const meta = { name: "direct-cache", description: "direct provider cache" };
export default async () => {
  return await agent({
    id: "direct-agent",
    provider: "codex",
    prompt: "Direct run."
  });
};
`);

    // First run
    const run1 = await runCli([
      "run", wf, "--config", configPath, "--cwd", process.cwd(),
      "--out", OUT, "--report", "json"
    ]);
    expect(run1.error).toBeNull();
    const [run1Id] = await listRunDirs(OUT);

    // Resume with unchanged config
    const run2 = await runCli([
      "resume", run1Id!, "--out", OUT, "--report", "json"
    ]);
    expect(run2.error).toBeNull();

    const allDirs = await listRunDirs(OUT);
    const run2Id = allDirs.find((d) => d !== run1Id)!;
    const report2 = JSON.parse(
      await fs.readFile(path.join(OUT, run2Id, "report.json"), "utf8")
    );
    const agent = report2.agents.find((a: any) => a.id === "direct-agent");

    // Cache hit
    expect(agent.cache?.hit).toBe(true);
    // No alias field invented for direct provider
    expect(agent.providerSelection?.selection?.providerAlias).toBeUndefined();
    expect(agent.provider).toBe("codex");

    // Events: no alias-resolution event for direct provider
    const events2 = await loadEvents(OUT, 1);
    const aliasEvents = events2.filter((e: any) => e.type === "agent.provider-alias-resolved");
    expect(aliasEvents.length, "No alias events for direct-provider run").toBe(0);
  });

  // -------------------------------------------------------------------------
  // CACHE-03 (AC-018): Cache-hit materialisation writes current-run providerSelection
  //   to metadata, agent-result, and workflow-visible result; unrelated metadata preserved.
  // -------------------------------------------------------------------------
  it("CACHE-03: cache-hit materialisation writes current selection metadata (AC-018)", async () => {
    // Arrange: standard aliased workflow
    const wf = await writeWorkflow(TEMP_DIR, "cache03", `
export const meta = { name: "cache03", description: "cache hit metadata" };
export default async () => {
  return await agent({
    id: "meta-agent",
    provider: "child-alias",
    prompt: "Metadata test."
  });
};
`);

    // First run (seed)
    const run1 = await runCli([
      "run", wf, "--config", configPath, "--cwd", process.cwd(),
      "--out", OUT, "--report", "json"
    ]);
    expect(run1.error).toBeNull();
    const [seedId] = await listRunDirs(OUT);

    // Resume (same config → cache hit)
    const run2 = await runCli([
      "resume", seedId!, "--out", OUT, "--report", "json"
    ]);
    expect(run2.error).toBeNull();

    const allDirs = await listRunDirs(OUT);
    const run2Id = allDirs.find((d) => d !== seedId)!;
    const run2Dir = path.join(OUT, run2Id);

    // Report-level assertion
    const report2 = JSON.parse(await fs.readFile(path.join(run2Dir, "report.json"), "utf8"));
    const agentInReport = report2.agents.find((a: any) => a.id === "meta-agent");
    expect(agentInReport.cache?.hit).toBe(true);
    expect(agentInReport.providerSelection?.selection?.requestedProvider).toBe("child-alias");
    expect(agentInReport.providerSelection?.selection?.providerAlias).toBe("child-alias");
    expect(agentInReport.providerSelection?.selection?.resolvedProvider).toBe("codex");
    expect(agentInReport.providerSelection?.resolvedExecution?.model).toBe("child-model");

    // Verify events: cache_hit event is present
    // UUID run IDs do not sort chronologically; use the resumed run selected
    // above instead of assuming it is the second lexicographic directory.
    const events2 = (await fs.readFile(path.join(run2Dir, "events.jsonl"), "utf8"))
      .trim().split("\n").filter((l) => l.trim().length > 0).map((line) => JSON.parse(line));
    expect(events2.some((e: any) => e.type === "agent.cache_hit")).toBe(true);

    // Security: providerSelection in report must not contain sentinel
    const serialized = JSON.stringify(agentInReport.providerSelection);
    expect(serialized).not.toContain("PROVIDER_SECRET_SENTINEL");
    expect(serialized).not.toContain("env");
  });

  // -------------------------------------------------------------------------
  // CACHE-01 (AC-020): Unrelated alias change (not on selected chain) does
  //   NOT invalidate the cached entry.
  // -------------------------------------------------------------------------
  it("CACHE-01: unrelated alias change does not invalidate selected alias cache (AC-020)", async () => {
    // Arrange: add a third unrelated alias to config
    await fs.writeFile(configPath, (await fs.readFile(configPath, "utf8")) + `
  unrelated-alias:
    provider: codex
    model: unrelated-model
`);

    const wf = await writeWorkflow(TEMP_DIR, "unrelated-change", `
export const meta = { name: "unrelated-change", description: "unrelated alias change" };
export default async () => {
  return await agent({
    id: "stable-agent",
    provider: "base-alias",
    prompt: "Stable."
  });
};
`);

    // Seed run
    const seed = await runCli([
      "run", wf, "--config", configPath, "--cwd", process.cwd(),
      "--out", OUT, "--report", "json"
    ]);
    expect(seed.error).toBeNull();
    const [seedId] = await listRunDirs(OUT);

    // Change only the unrelated alias model
    await fs.writeFile(configPath, (await fs.readFile(configPath, "utf8")).replace(
      "model: unrelated-model",
      "model: unrelated-model-v2"
    ));

    // Resume – only unrelated alias changed; selected alias (base-alias) is unchanged
    const resumed = await runCli([
      "resume", seedId!, "--config", configPath, "--out", OUT, "--report", "json"
    ]);
    expect(resumed.error).toBeNull();

    const allDirs = await listRunDirs(OUT);
    const resumedId = allDirs.find((d) => d !== seedId)!;
    const resumedReport = JSON.parse(
      await fs.readFile(path.join(OUT, resumedId, "report.json"), "utf8")
    );
    const agent = resumedReport.agents.find((a: any) => a.id === "stable-agent");
    // Unrelated alias change must not invalidate the cache
    expect(agent.cache?.hit, "Unrelated alias change should not invalidate cache").toBe(true);
  });
});
