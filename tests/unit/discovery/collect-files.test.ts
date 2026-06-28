import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectCandidateFiles, collectResourceCandidateFiles } from "../../../src/discovery/collect-files.js";
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

  describe("pattern-based discovery", () => {
    it("discovers files and handles excludes using patterns", async () => {
      await fs.writeFile(join(tempDir, "workflows/w_pattern.workflow.ts"), "export const meta = {}");
      await fs.writeFile(join(tempDir, "workflows/w_excluded.workflow.ts"), "export const meta = {}");

      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["workflow"],
        patterns: {
          workflow: {
            include: ["workflows/**/*.ts"],
            exclude: ["workflows/w_excluded.workflow.ts"],
            compatibilityMode: "new-suffix-specific",
          },
          agent: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
          tool: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
        },
        strict: false,
      });

      const relPaths = result.files.map(f => f.relativePath);
      expect(relPaths).toContain("workflows/w_pattern.workflow.ts");
      expect(relPaths).not.toContain("workflows/w_excluded.workflow.ts");
    });

    it("keeps suffix-specific include patterns limited to resource marker files", async () => {
      await fs.writeFile(join(tempDir, "workflows/generic.ts"), "test");
      await fs.writeFile(join(tempDir, "workflows/specific.workflow.ts"), "test");

      const resultSpecific = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["workflow"],
        patterns: {
          workflow: {
            include: ["workflows/**/*.workflow.ts"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
          },
          agent: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
          tool: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
        },
        strict: false,
      });

      const specificPaths = resultSpecific.files.map(f => f.relativePath);
      expect(specificPaths).toContain("workflows/specific.workflow.ts");
      expect(specificPaths).not.toContain("workflows/generic.ts");
    });

    it("accepts generic runtime include patterns in new flat configuration", async () => {
      await fs.writeFile(join(tempDir, "workflows/generic-flat.js"), "test");
      await fs.writeFile(join(tempDir, "workflows/specific-flat.workflow.js"), "test");

      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["workflow"],
        patterns: {
          workflow: {
            include: ["workflows/**/*.js"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
          },
          agent: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
          tool: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
        },
        strict: false,
      });

      const paths = result.files.map(f => f.relativePath);
      expect(paths).toContain("workflows/generic-flat.js");
      expect(paths).toContain("workflows/specific-flat.workflow.js");
      expect(result.configDiagnostics?.some(d => d.path === "workflow.include[0]" && d.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING")).not.toBe(true);
    });

    it("accepts generic files in legacy-compatible mode", async () => {
      await fs.writeFile(join(tempDir, "workflows/generic-legacy.ts"), "test");
      await fs.writeFile(join(tempDir, "workflows/specific-legacy.workflow.ts"), "test");

      const resultLegacy = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["workflow"],
        patterns: {
          workflow: {
            include: ["workflows/**/*.ts"],
            exclude: [],
            compatibilityMode: "legacy-compatible",
          },
          agent: { include: [], exclude: [], compatibilityMode: "legacy-compatible" },
          tool: { include: [], exclude: [], compatibilityMode: "legacy-compatible" },
        },
        strict: false,
      });

      const legacyPaths = resultLegacy.files.map(f => f.relativePath);
      expect(legacyPaths).toContain("workflows/specific-legacy.workflow.ts");
      expect(legacyPaths).toContain("workflows/generic-legacy.ts");
    });

    it("reports unused exclude and zero-match include diagnostics", async () => {
      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["workflow"],
        patterns: {
          workflow: {
            include: ["workflows/nonexistent/**/*.ts", "workflows/w_pattern.workflow.ts"],
            exclude: ["workflows/nonexistent-exclude.ts"],
            compatibilityMode: "new-suffix-specific",
          },
          agent: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
          tool: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
        },
        strict: false,
      });

      expect(result.configDiagnostics).toBeDefined();
      const codes = result.configDiagnostics!.map(d => d.code);
      expect(codes).toContain("CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
      expect(codes).toContain("CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
    });

    it("suppresses default suffix-specific include and exclude zero-match warnings", async () => {
      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["agent", "tool"],
        patterns: {
          workflow: { include: [], exclude: [], compatibilityMode: "default-suffix-specific" },
          agent: {
            include: ["agents/**/*.agent.js"],
            exclude: ["**/*.test.*"],
            compatibilityMode: "default-suffix-specific",
            includeSource: "default",
            excludeSource: "default",
          },
          tool: {
            include: ["tools/**/*.tool.js"],
            exclude: ["**/*.spec.*"],
            compatibilityMode: "default-suffix-specific",
            includeSource: "default",
            excludeSource: "default",
          },
        },
        strict: false,
      });

      expect(result.configDiagnostics).toEqual([]);
    });

    it("keeps user-authored suffix-specific include warning labels exact", async () => {
      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["agent"],
        patterns: {
          workflow: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
          agent: {
            include: ["agents/**/*.agent.js"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
            includeSource: "new",
            excludeSource: "default",
          },
          tool: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
        },
        strict: false,
      });

      const agentDiag = result.configDiagnostics?.find(d => d.resource === "sharedAgents" && d.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
      expect(agentDiag?.message).toContain("agents/**/*.agent.js");
      expect(agentDiag?.value).toBe("agents/**/*.agent.js");
    });

    it("deduplicates default missing directories per resource base", async () => {
      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["workflow", "agent", "tool"],
        patterns: {
          workflow: {
            include: ["missing-workflows/**/*.workflow.ts", "missing-workflows/**/*.workflow.js"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
          },
          agent: {
            include: ["missing-agents/**/*.agent.ts", "missing-agents/**/*.agent.js"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
          },
          tool: {
            include: ["missing-tools/**/*.tool.ts", "missing-tools/**/*.tool.js"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
          },
        },
        strict: false,
      });

      expect(result.files).toHaveLength(0);
      
      const missingWorkflowsDiags = result.diagnostics.filter(
        d => d.resourceType === "workflow" && d.code === "LIST_DIRECTORY_NOT_FOUND"
      );
      const missingAgentsDiags = result.diagnostics.filter(
        d => d.resourceType === "agent" && d.code === "LIST_DIRECTORY_NOT_FOUND"
      );
      const missingToolsDiags = result.diagnostics.filter(
        d => d.resourceType === "tool" && d.code === "LIST_DIRECTORY_NOT_FOUND"
      );

      expect(missingWorkflowsDiags).toHaveLength(1);
      expect(missingAgentsDiags).toHaveLength(1);
      expect(missingToolsDiags).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(3);
    });

    it("does not suppress safe files when one symlink escapes", async () => {
      const unitTempDir = await fs.mkdtemp(join(tmpdir(), "symlink-base-suppression-"));
      const outsideDir = await fs.mkdtemp(join(tmpdir(), "symlink-base-outside-"));
      
      const workflowsDir = join(unitTempDir, "workflows");
      await fs.mkdir(workflowsDir, { recursive: true });

      // Create safe.workflow.ts
      await fs.writeFile(join(workflowsDir, "safe.workflow.ts"), "export const meta = {}");

      // Create outside file
      const outsideFile = join(outsideDir, "escaped.workflow.ts");
      await fs.writeFile(outsideFile, "export const meta = {}");

      // Create symlink
      let symlinksSupported = true;
      try {
        await fs.symlink(outsideFile, join(workflowsDir, "escaped.workflow.ts"));
      } catch {
        symlinksSupported = false;
      }

      if (!symlinksSupported) {
        await fs.rm(unitTempDir, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
        return; // skip if platform doesn't support symlinks in tests
      }

      const result = await collectResourceCandidateFiles({
        cwd: unitTempDir,
        resourceType: "workflow",
        include: ["workflows/**/*.workflow.ts"],
        exclude: [],
        compatibilityMode: "new-suffix-specific",
        strict: false,
      });

      const relPaths = result.files.map(f => f.relativePath);
      expect(relPaths).toContain("workflows/safe.workflow.ts");
      expect(relPaths).not.toContain("workflows/escaped.workflow.ts");
      
      expect(result.configDiagnostics).toBeDefined();
      const codes = result.configDiagnostics.map(d => d.code);
      expect(codes).toContain("CONFIG_PATH_SYMLINK_ESCAPE");

      await fs.rm(unitTempDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    });

    it("checks resource suffix markers against file basename only", async () => {
      const unitTempDir = await fs.mkdtemp(join(tmpdir(), "resource-marker-basename-"));
      const toolHelpersDir = join(unitTempDir, "my.tool.helpers");
      await fs.mkdir(toolHelpersDir, { recursive: true });

      // Create my.tool.helpers/helper.ts (should be ignored since it lacks .tool.)
      await fs.writeFile(join(toolHelpersDir, "helper.ts"), "export const meta = {}");

      // Create my.tool.helpers/real.tool.ts (positive control, should be collected)
      await fs.writeFile(join(toolHelpersDir, "real.tool.ts"), "export const meta = {}");

      const result = await collectResourceCandidateFiles({
        cwd: unitTempDir,
        resourceType: "tool",
        include: ["**/*.ts"],
        exclude: [],
        compatibilityMode: "new-suffix-specific",
        strict: false,
      });

      const relPaths = result.files.map(f => f.relativePath);
      expect(relPaths).not.toContain("my.tool.helpers/helper.ts");
      expect(relPaths).toContain("my.tool.helpers/real.tool.ts");

      await fs.rm(unitTempDir, { recursive: true, force: true });
    });
  });
});
