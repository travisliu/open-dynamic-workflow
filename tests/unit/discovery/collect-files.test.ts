import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectCandidateFiles } from "../../../src/discovery/collect-files.js";
import { DiscoveryDirectories } from "../../../src/discovery/types.js";

describe("collect-files", () => {
  let tempDir: string;
  let directories: DiscoveryDirectories;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "collect-files-test-"));
    directories = {
      workflowInclude: ["workflows/**/*.ts", "workflows/**/*.js"],
      agentsDir: "agents",
      toolsDir: "tools"
    };
    await fs.mkdir(join(tempDir, "workflows"), { recursive: true });
    await fs.mkdir(join(tempDir, "agents"), { recursive: true });
    await fs.mkdir(join(tempDir, "tools"), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("collects files from directories", async () => {
    await fs.writeFile(join(tempDir, "workflows/w1.ts"), "export const meta = {}");
    await fs.writeFile(join(tempDir, "workflows/w2.js"), "export const meta = {}");
    await fs.writeFile(join(tempDir, "agents/a1.mjs"), "export default {}");
    await fs.writeFile(join(tempDir, "tools/t1.cjs"), "module.exports = {}");
    await fs.writeFile(join(tempDir, "workflows/ignore.txt"), "ignored");

    const result = await collectCandidateFiles({
      cwd: tempDir,
      resourceTypes: ["workflow", "agent", "tool"],
      directories,
      strict: false
    });

    // We use a set because order within directories might vary depending on OS readdir, 
    // although we sort them at the end of collectCandidateFiles.
    expect(result.files).toHaveLength(4);
    expect(result.files.map(f => f.relativePath)).toEqual([
      "agents/a1.mjs",
      "tools/t1.cjs",
      "workflows/w1.ts",
      "workflows/w2.js"
    ]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports missing directory", async () => {
    const result = await collectCandidateFiles({
      cwd: tempDir,
      resourceTypes: ["workflow"],
      directories: { ...directories, workflowInclude: ["missing/**/*.ts"] },
      strict: false
    });

    expect(result.files).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("LIST_DIRECTORY_NOT_FOUND");
    expect(result.diagnostics[0].severity).toBe("warning");
  });

  it("reports file unreadable when path is a file instead of a directory", async () => {
    const filePath = join(tempDir, "file-instead-of-dir.ts");
    await fs.writeFile(filePath, "test");
    
    const result = await collectCandidateFiles({
      cwd: tempDir,
      resourceTypes: ["workflow"],
      directories: { ...directories, workflowInclude: ["file-instead-of-dir.ts"] },
      strict: false
    });

    expect(result.files).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("LIST_FILE_UNREADABLE");
  });

  it("handles symlinks within cwd", async () => {
    const targetPath = join(tempDir, "workflows/target.ts");
    await fs.writeFile(targetPath, "export const meta = {}");
    const linkPath = join(tempDir, "workflows/link.ts");
    try {
      await fs.symlink(targetPath, linkPath);
    } catch (e) {
      // Symlinks might fail on some platforms/environments (e.g. Windows without dev mode)
      return;
    }

    const result = await collectCandidateFiles({
      cwd: tempDir,
      resourceTypes: ["workflow"],
      directories,
      strict: false
    });

    const filePaths = result.files.map(f => f.relativePath);
    expect(filePaths).toContain("workflows/link.ts");
    expect(filePaths).toContain("workflows/target.ts");
  });

  it("rejects symlinks outside cwd", async () => {
    const outsideDir = await fs.mkdtemp(join(tmpdir(), "outside-"));
    const outsideFile = join(outsideDir, "outside.ts");
    await fs.writeFile(outsideFile, "export const meta = {}");
    
    const linkPath = join(tempDir, "workflows/outside-link.ts");
    try {
      await fs.symlink(outsideFile, linkPath);
    } catch (e) {
      await fs.rm(outsideDir, { recursive: true, force: true });
      return;
    }

    const result = await collectCandidateFiles({
      cwd: tempDir,
      resourceTypes: ["workflow"],
      directories,
      strict: false
    });

    expect(result.files.map(f => f.relativePath)).not.toContain("workflows/outside-link.ts");
    expect(result.diagnostics.some(d => d.code === "LIST_FILE_UNREADABLE")).toBe(true);
    
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("keeps relative paths even when absolute directories are provided", async () => {
    const absWorkflowsDir = join(tempDir, "workflows");
    const result = await collectCandidateFiles({
      cwd: tempDir,
      resourceTypes: ["workflow"],
      directories: { ...directories, workflowInclude: [join(absWorkflowsDir, "**/*.ts")] },
      strict: false
    });

    expect(result.files.length).toBeGreaterThan(0);
    for (const file of result.files) {
      expect(file.relativePath).not.toContain(tempDir);
      // It should be something like "workflows/w1.ts"
      expect(file.relativePath).toMatch(/^workflows\//);
    }
  });

  it("uses strict mode to upgrade diagnostics to errors", async () => {
    const result = await collectCandidateFiles({
      cwd: tempDir,
      resourceTypes: ["workflow"],
      directories: { ...directories, workflowInclude: ["missing/**/*.ts"] },
      strict: true
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].severity).toBe("error");
  });
});
