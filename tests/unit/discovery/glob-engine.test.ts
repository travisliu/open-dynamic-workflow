import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expandIncludePattern, TINYGLOBBY_OPTIONS, matchesDiscoveryPattern } from "../../../src/discovery/glob-engine.js";

describe("glob-engine", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "glob-engine-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const toPosix = (p: string) => p.replace(/\\/g, "/");

  it("resolves a normal glob pattern and returns matching absolute POSIX paths in sorted order", async () => {
    const workflowsDir = join(tempDir, "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    
    await fs.mkdir(join(workflowsDir, "nested"), { recursive: true });
    
    const fileA = join(workflowsDir, "a.workflow.ts");
    const fileB = join(workflowsDir, "nested", "b.workflow.ts");
    const readme = join(workflowsDir, "readme.md");
    
    await fs.writeFile(fileA, "content");
    await fs.writeFile(fileB, "content");
    await fs.writeFile(readme, "content");
    
    const results = await expandIncludePattern({
      cwd: tempDir,
      pattern: "workflows/**/*.workflow.ts",
    });
    
    expect(results).toEqual([
      toPosix(resolve(fileA)),
      toPosix(resolve(fileB)),
    ]);
  });

  it("discovers dot-directory files, proving dot: true", async () => {
    expect(TINYGLOBBY_OPTIONS.dot).toBe(true);

    const workflowsDir = join(tempDir, "workflows", ".dot-dir");
    await fs.mkdir(workflowsDir, { recursive: true });
    const hiddenFile = join(workflowsDir, "nested.workflow.ts");
    await fs.writeFile(hiddenFile, "content");

    const results = await expandIncludePattern({
      cwd: tempDir,
      pattern: "workflows/**/*.workflow.ts",
    });

    expect(results).toEqual([toPosix(resolve(hiddenFile))]);
  });

  it("does not follow symlinked directories, proving followSymbolicLinks: false", async () => {
    expect(TINYGLOBBY_OPTIONS.followSymbolicLinks).toBe(false);

    const parentDir = join(tempDir, "parent");
    const targetDir = join(tempDir, "outside-target");
    const symlinkDir = join(parentDir, "workflows-symlink");
    
    await fs.mkdir(parentDir, { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
    
    const targetFile = join(targetDir, "linked.workflow.ts");
    await fs.writeFile(targetFile, "content");
    
    try {
      await fs.symlink(targetDir, symlinkDir, "dir");
    } catch {
      // Skip symlink assertion if platform does not allow symlink creation
      return;
    }
    
    const results = await expandIncludePattern({
      cwd: tempDir,
      pattern: "parent/**/*.workflow.ts",
    });
    
    expect(results).toEqual([]);
  });

  it("does not expand directory input into files, proving expandDirectories: false", async () => {
    const workflowsDir = join(tempDir, "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    
    const fileA = join(workflowsDir, "a.workflow.ts");
    await fs.writeFile(fileA, "content");
    
    const results = await expandIncludePattern({
      cwd: tempDir,
      pattern: "workflows",
    });
    
    expect(results).toEqual([]);
  });

  it("accepts Windows-style separators in the input pattern and returns POSIX-style paths", async () => {
    const workflowsDir = join(tempDir, "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    
    const fileA = join(workflowsDir, "a.workflow.ts");
    await fs.writeFile(fileA, "content");
    
    const results = await expandIncludePattern({
      cwd: tempDir,
      pattern: "workflows\\*.workflow.ts",
    });
    
    expect(results).toEqual([
      toPosix(resolve(fileA)),
    ]);
  });

  describe("matchesDiscoveryPattern", () => {
    it("matches basic globs and respects dot option", () => {
      expect(matchesDiscoveryPattern("workflows/a.workflow.ts", "workflows/**/*.workflow.ts")).toBe(true);
      expect(matchesDiscoveryPattern(".github/workflows/escaped.workflow.ts", "**/*.workflow.ts")).toBe(true);
      expect(matchesDiscoveryPattern("workflows/escaped.workflow.ts", "workflows/*.{workflow.ts,agent.ts}")).toBe(true);
      expect(matchesDiscoveryPattern("workflows/a.js", "workflows/*.ts")).toBe(false);
    });

    it("normalizes Windows-style separators and leading ./", () => {
      expect(matchesDiscoveryPattern("workflows\\a.workflow.ts", "./workflows/**/*.workflow.ts")).toBe(true);
    });
  });
});
