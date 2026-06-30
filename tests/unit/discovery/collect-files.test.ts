import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { collectCandidateFiles, collectResourceCandidateFiles, isExcludedByDiscoveryPolicy } from "../../../src/discovery/collect-files.js";
import { compileResourceDiscovery } from "../../../src/discovery/compile-patterns.js";
import { DiscoveryDirectories, PatternMatchMetrics } from "../../../src/discovery/types.js";
import { ConfigDiagnostic } from "../../../src/config/types.js";

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
      await fs.writeFile(join(tempDir, "agents/generic-agent.js"), "test");
      await fs.writeFile(join(tempDir, "agents/specific-agent.agent.js"), "test");
      await fs.writeFile(join(tempDir, "tools/generic-tool.js"), "test");
      await fs.writeFile(join(tempDir, "tools/specific-tool.tool.js"), "test");

      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["workflow", "agent", "tool"],
        patterns: {
          workflow: {
            include: ["workflows/**/*.js"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
          },
          agent: {
            include: ["agents/**/*.js"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
          },
          tool: {
            include: ["tools/**/*.js"],
            exclude: [],
            compatibilityMode: "new-suffix-specific",
          },
        },
        strict: false,
      });

      const paths = result.files.map(f => f.relativePath);
      expect(paths).toContain("workflows/generic-flat.js");
      expect(paths).toContain("workflows/specific-flat.workflow.js");
      expect(paths).toContain("agents/generic-agent.js");
      expect(paths).toContain("agents/specific-agent.agent.js");
      expect(paths).toContain("tools/generic-tool.js");
      expect(paths).toContain("tools/specific-tool.tool.js");
      expect(result.configDiagnostics?.some(d => d.path === "workflow.include[0]" && d.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING")).not.toBe(true);
      expect(result.configDiagnostics?.some(d => d.path === "sharedAgents.include[0]" && d.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING")).not.toBe(true);
      expect(result.configDiagnostics?.some(d => d.path === "tools.include[0]" && d.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING")).not.toBe(true);
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

    it("reports unused exclude and suppresses zero-match include diagnostics when another include matches", async () => {
      await fs.mkdir(join(tempDir, "workflows/nonexistent"), { recursive: true });
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
      expect(codes).not.toContain("CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
      expect(codes).toContain("CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
    });

    it("suppresses default include and exclude zero-match warnings", async () => {
      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["agent", "tool"],
        patterns: {
          workflow: { include: [], exclude: [], compatibilityMode: "default-suffix-specific" },
          agent: {
            include: ["agents/**/*.js"],
            exclude: ["**/*.test.*"],
            compatibilityMode: "default-suffix-specific",
            includeSource: "default",
            excludeSource: "default",
          },
          tool: {
            include: ["tools/**/*.js"],
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
      await fs.mkdir(join(tempDir, "label-agents"), { recursive: true });

      const result = await collectCandidateFiles({
        cwd: tempDir,
        resourceTypes: ["agent"],
        patterns: {
          workflow: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
          agent: {
            include: ["label-agents/**/*.agent.js"],
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
      expect(agentDiag?.message).toContain("label-agents/**/*.agent.js");
      expect(agentDiag?.value).toBe("label-agents/**/*.agent.js");
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

    it("accepts plain tool files from generic runtime include patterns", async () => {
      const unitTempDir = await fs.mkdtemp(join(tmpdir(), "resource-marker-basename-"));
      const toolHelpersDir = join(unitTempDir, "my.tool.helpers");
      await fs.mkdir(toolHelpersDir, { recursive: true });

      await fs.writeFile(join(toolHelpersDir, "helper.ts"), "export const meta = {}");
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
      expect(relPaths).toContain("my.tool.helpers/helper.ts");
      expect(relPaths).toContain("my.tool.helpers/real.tool.ts");

      await fs.rm(unitTempDir, { recursive: true, force: true });
    });

    it("isExcludedByDiscoveryPolicy follows discovery glob semantics for compiled excludes", async () => {
      const compiled = compileResourceDiscovery({
        cwd: tempDir,
        discovery: {
          resource: "tools",
          include: [],
          exclude: [
            "tools/helpers/*.{ts,js}",
            "tools/private/tool.ts",
          ],
          source: "new",
          includeSource: "new",
          excludeSource: "new",
          compatibilityMode: "new-suffix-specific",
          sourcePaths: ["tools.exclude"],
          rawInclude: [],
          rawExclude: [
            "tools/helpers/*.{ts,js}",
            "tools/private/tool.ts",
          ],
          diagnostics: [],
        },
      });

      expect(isExcludedByDiscoveryPolicy("tools\\helpers\\secret.ts", compiled.discovery.exclude)).toBe(true);
      expect(isExcludedByDiscoveryPolicy("tools/helpers/secret.js", compiled.discovery.exclude)).toBe(true);
      expect(isExcludedByDiscoveryPolicy("tools/private/tool.ts", compiled.discovery.exclude)).toBe(true);
      expect(isExcludedByDiscoveryPolicy("tools/private/other.ts", compiled.discovery.exclude)).toBe(false);
    });
  });

  describe("source-aware candidate collection", () => {
    async function getTempDir() {
      return await fs.mkdtemp(join(tmpdir(), "collect-files-source-aware-"));
    }

    async function writeFile(root: string, relativePath: string, contents = "export const meta = {};") {
      const filePath = join(root, relativePath);
      await fs.mkdir(join(filePath, ".."), { recursive: true });
      await fs.writeFile(filePath, contents);
      return filePath;
    }

    function relativePaths(result: { files: Array<{ relativePath: string }> }) {
      return result.files.map((file) => file.relativePath);
    }

    function metricFor(result: { metrics: PatternMatchMetrics[] }, pattern: string) {
      return result.metrics.find((m) => m.pattern === pattern || m.configPath === pattern);
    }

    function configDiagnosticsWithCode(result: { configDiagnostics: ConfigDiagnostic[] }, code: string) {
      return result.configDiagnostics.filter((d) => d.code === code);
    }

    it("1. Generic workflow runtime include accepts plain and marker files", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "workflows/plain.ts");
        await writeFile(root, "workflows/marked.workflow.ts");
        await writeFile(root, "workflows/readme.md");

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          excludeSource: "new",
          strict: false,
        });

        const paths = relativePaths(result);
        expect(paths.sort()).toEqual(["workflows/marked.workflow.ts", "workflows/plain.ts"]);

        const metric = metricFor(result, "workflows/**/*.ts");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(2);
        expect(metric!.acceptedCandidateCount).toBe(2);
        expect(metric!.rejectedByMarkerCount).toBe(0);

        for (const file of result.files) {
          expect(file.sourcePattern).toBe("workflows/**/*.ts");
          expect(file.sourceConfigPath).toBeDefined();
          expect(file.source).toBe("new");
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("2. Generic shared-agent and tool runtime includes accept plain and marker files", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "agents/plain-agent.js");
        await writeFile(root, "agents/marked.agent.js");
        await writeFile(root, "tools/plain-tool.js");
        await writeFile(root, "tools/marked.tool.js");

        const result = await collectCandidateFiles({
          cwd: root,
          resourceTypes: ["agent", "tool"],
          patterns: {
            workflow: { include: [], exclude: [], compatibilityMode: "new-suffix-specific" },
            agent: {
              include: ["agents/**/*.js"],
              exclude: [],
              compatibilityMode: "new-suffix-specific",
            },
            tool: {
              include: ["tools/**/*.js"],
              exclude: [],
              compatibilityMode: "new-suffix-specific",
            },
          },
          strict: false,
        });

        const paths = relativePaths(result);
        expect(paths.sort()).toEqual([
          "agents/marked.agent.js",
          "agents/plain-agent.js",
          "tools/marked.tool.js",
          "tools/plain-tool.js",
        ]);

        const agentMetric = metricFor(result, "agents/**/*.js");
        expect(agentMetric).toBeDefined();
        expect(agentMetric!.matchedPathCount).toBe(2);
        expect(agentMetric!.acceptedCandidateCount).toBe(2);
        expect(agentMetric!.rejectedByMarkerCount).toBe(0);

        const toolMetric = metricFor(result, "tools/**/*.js");
        expect(toolMetric).toBeDefined();
        expect(toolMetric!.matchedPathCount).toBe(2);
        expect(toolMetric!.acceptedCandidateCount).toBe(2);
        expect(toolMetric!.rejectedByMarkerCount).toBe(0);

        for (const file of result.files) {
          expect(file.sourcePattern).toBeDefined();
          expect(file.sourceConfigPath).toBeDefined();
          expect(file.source).toBeDefined();
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("3. Suffix-specific patterns stay marker-specific", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "workflows/plain.ts");
        await writeFile(root, "workflows/marked.workflow.ts");
        await writeFile(root, "agents/plain.js");
        await writeFile(root, "agents/marked.agent.js");
        await writeFile(root, "tools/plain.js");
        await writeFile(root, "tools/marked.tool.js");

        const result = await collectCandidateFiles({
          cwd: root,
          resourceTypes: ["workflow", "agent", "tool"],
          patterns: {
            workflow: {
              include: ["workflows/**/*.workflow.ts"],
              exclude: [],
              compatibilityMode: "new-suffix-specific",
            },
            agent: {
              include: ["agents/**/*.agent.js"],
              exclude: [],
              compatibilityMode: "new-suffix-specific",
            },
            tool: {
              include: ["tools/**/*.tool.js"],
              exclude: [],
              compatibilityMode: "new-suffix-specific",
            },
          },
          strict: false,
        });

        const paths = relativePaths(result);
        expect(paths.sort()).toEqual([
          "agents/marked.agent.js",
          "tools/marked.tool.js",
          "workflows/marked.workflow.ts",
        ]);

        const wfMetric = metricFor(result, "workflows/**/*.workflow.ts");
        expect(wfMetric).toBeDefined();
        expect(wfMetric!.matchedPathCount).toBe(1);
        expect(wfMetric!.acceptedCandidateCount).toBe(1);
        expect(wfMetric!.rejectedByMarkerCount).toBe(0);

        const agentMetric = metricFor(result, "agents/**/*.agent.js");
        expect(agentMetric).toBeDefined();
        expect(agentMetric!.matchedPathCount).toBe(1);
        expect(agentMetric!.acceptedCandidateCount).toBe(1);
        expect(agentMetric!.rejectedByMarkerCount).toBe(0);

        const toolMetric = metricFor(result, "tools/**/*.tool.js");
        expect(toolMetric).toBeDefined();
        expect(toolMetric!.matchedPathCount).toBe(1);
        expect(toolMetric!.acceptedCandidateCount).toBe(1);
        expect(toolMetric!.rejectedByMarkerCount).toBe(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("4. Broad non-generic patterns require markers and count marker rejections", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "workflows/plain.ts");
        await writeFile(root, "workflows/marked.workflow.ts");
        await writeFile(root, "agents/plain.js");
        await writeFile(root, "agents/marked.agent.js");
        await writeFile(root, "tools/plain.js");
        await writeFile(root, "tools/marked.tool.js");

        const result = await collectCandidateFiles({
          cwd: root,
          resourceTypes: ["workflow", "agent", "tool"],
          patterns: {
            workflow: {
              include: ["workflows/**/*"],
              exclude: [],
              compatibilityMode: "new-suffix-specific",
            },
            agent: {
              include: ["agents/**/*"],
              exclude: [],
              compatibilityMode: "new-suffix-specific",
            },
            tool: {
              include: ["tools/**/*"],
              exclude: [],
              compatibilityMode: "new-suffix-specific",
            },
          },
          strict: false,
        });

        const paths = relativePaths(result);
        expect(paths.sort()).toEqual([
          "agents/marked.agent.js",
          "tools/marked.tool.js",
          "workflows/marked.workflow.ts",
        ]);

        const wfMetric = metricFor(result, "workflows/**/*");
        expect(wfMetric).toBeDefined();
        expect(wfMetric!.matchedPathCount).toBe(2);
        expect(wfMetric!.acceptedCandidateCount).toBe(1);
        expect(wfMetric!.rejectedByMarkerCount).toBe(1);

        const agentMetric = metricFor(result, "agents/**/*");
        expect(agentMetric).toBeDefined();
        expect(agentMetric!.matchedPathCount).toBe(2);
        expect(agentMetric!.acceptedCandidateCount).toBe(1);
        expect(agentMetric!.rejectedByMarkerCount).toBe(1);

        const toolMetric = metricFor(result, "tools/**/*");
        expect(toolMetric).toBeDefined();
        expect(toolMetric!.matchedPathCount).toBe(2);
        expect(toolMetric!.acceptedCandidateCount).toBe(1);
        expect(toolMetric!.rejectedByMarkerCount).toBe(1);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("5. Non-runtime matches are ignored without marker rejection", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "workflows/notes.md", "content");
        await writeFile(root, "workflows/data.json", "{}");

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        expect(result.files).toHaveLength(0);

        const metric = metricFor(result, "workflows/**/*");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(2);
        expect(metric!.acceptedCandidateCount).toBe(0);
        expect(metric!.rejectedByMarkerCount).toBe(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("6. Excluded candidates are counted separately", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "tools/keep.tool.ts");
        await writeFile(root, "tools/drop.tool.ts");

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "tool",
          include: ["tools/**/*.tool.ts"],
          exclude: ["tools/drop.tool.ts"],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          excludeSource: "new",
          strict: false,
        });

        expect(relativePaths(result)).toEqual(["tools/keep.tool.ts"]);

        const metric = metricFor(result, "tools/**/*.tool.ts");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(2);
        expect(metric!.acceptedCandidateCount).toBe(1);
        expect(metric!.excludedCandidateCount).toBe(1);
        expect(metric!.rejectedByMarkerCount).toBe(0);

        const unusedExcludeDiags = configDiagnosticsWithCode(result, "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
        expect(unusedExcludeDiags).toHaveLength(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("7. Safety rejection increments metrics and keeps safe files", async () => {
      const root = await getTempDir();
      const outsideDir = await fs.mkdtemp(join(tmpdir(), "collect-files-outside-"));
      try {
        await writeFile(root, "workflows/safe.workflow.ts");
        const outsideFile = join(outsideDir, "outside.workflow.ts");
        await fs.writeFile(outsideFile, "export const meta = {};");

        const symlinkPath = join(root, "workflows/escaped.workflow.ts");
        let symlinksSupported = true;
        try {
          await fs.symlink(outsideFile, symlinkPath);
        } catch {
          symlinksSupported = false;
        }

        if (!symlinksSupported) return;

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        expect(relativePaths(result)).toEqual(["workflows/safe.workflow.ts"]);

        const safetyDiags = configDiagnosticsWithCode(result, "CONFIG_PATH_SYMLINK_ESCAPE");
        expect(safetyDiags.length).toBeGreaterThan(0);

        const metric = metricFor(result, "workflows/**/*.workflow.ts");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(2);
        expect(metric!.acceptedCandidateCount).toBe(1);
        expect(metric!.rejectedBySafetyCount).toBe(1);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("8. Unmatched symlink under glob base is not inspected", async () => {
      const root = await getTempDir();
      const outsideDir = await fs.mkdtemp(join(tmpdir(), "collect-files-outside-"));
      try {
        const outsideFile = join(outsideDir, "outside.ts");
        await fs.writeFile(outsideFile, "export const meta = {};");

        const symlinkPath = join(root, "workflows/escaped.other.ts");
        await fs.mkdir(join(symlinkPath, ".."), { recursive: true });
        let symlinksSupported = true;
        try {
          await fs.symlink(outsideFile, symlinkPath);
        } catch {
          symlinksSupported = false;
        }

        if (!symlinksSupported) return;

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        const safetyDiags = configDiagnosticsWithCode(result, "CONFIG_PATH_SYMLINK_ESCAPE");
        expect(safetyDiags).toHaveLength(0);

        const metric = metricFor(result, "workflows/**/*.workflow.ts");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(0);
        expect(metric!.rejectedBySafetyCount).toBe(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("9. Excluded symlink is filtered before safety", async () => {
      const root = await getTempDir();
      const outsideDir = await fs.mkdtemp(join(tmpdir(), "collect-files-outside-"));
      try {
        const outsideFile = join(outsideDir, "outside.ts");
        await fs.writeFile(outsideFile, "export const meta = {};");

        const symlinkPath = join(root, "workflows/escaped.workflow.ts");
        await fs.mkdir(join(symlinkPath, ".."), { recursive: true });
        let symlinksSupported = true;
        try {
          await fs.symlink(outsideFile, symlinkPath);
        } catch {
          symlinksSupported = false;
        }

        if (!symlinksSupported) return;

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: ["workflows/escaped.workflow.ts"],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          excludeSource: "new",
          strict: false,
        });

        const safetyDiags = configDiagnosticsWithCode(result, "CONFIG_PATH_SYMLINK_ESCAPE");
        expect(safetyDiags).toHaveLength(0);

        const metric = metricFor(result, "workflows/**/*.workflow.ts");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(1);
        expect(metric!.excludedCandidateCount).toBe(1);
        expect(metric!.rejectedBySafetyCount).toBe(0);

        const unusedExcludeDiags = configDiagnosticsWithCode(result, "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
        expect(unusedExcludeDiags).toHaveLength(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("9b. Glob excluded symlink is filtered before safety", async () => {
      const root = await getTempDir();
      const outsideDir = await fs.mkdtemp(join(tmpdir(), "collect-files-outside-"));
      try {
        const outsideFile = join(outsideDir, "outside.ts");
        await fs.writeFile(outsideFile, "export const meta = {};");

        const symlinkPath = join(root, "workflows/escaped.workflow.ts");
        await fs.mkdir(join(symlinkPath, ".."), { recursive: true });
        let symlinksSupported = true;
        try {
          await fs.symlink(outsideFile, symlinkPath);
        } catch {
          symlinksSupported = false;
        }

        if (!symlinksSupported) return;

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: ["workflows/escaped.*.ts"],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          excludeSource: "new",
          strict: false,
        });

        const safetyDiags = configDiagnosticsWithCode(result, "CONFIG_PATH_SYMLINK_ESCAPE");
        expect(safetyDiags).toHaveLength(0);

        const metric = metricFor(result, "workflows/**/*.workflow.ts");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(1);
        expect(metric!.excludedCandidateCount).toBe(1);
        expect(metric!.rejectedBySafetyCount).toBe(0);

        const unusedExcludeDiags = configDiagnosticsWithCode(result, "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
        expect(unusedExcludeDiags).toHaveLength(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("9c. Symlinked include candidate honors tinyglobby-supported glob syntax", async () => {
      const root = await getTempDir();
      const outsideDir = await fs.mkdtemp(join(tmpdir(), "collect-files-outside-"));
      try {
        const outsideFile = join(outsideDir, "outside.ts");
        await fs.writeFile(outsideFile, "export const meta = {};");

        const symlinkPath = join(root, "workflows/escaped.workflow.ts");
        await fs.mkdir(join(symlinkPath, ".."), { recursive: true });
        let symlinksSupported = true;
        try {
          await fs.symlink(outsideFile, symlinkPath);
        } catch {
          symlinksSupported = false;
        }

        if (!symlinksSupported) return;

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/*.{workflow.ts,agent.ts}"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          excludeSource: "new",
          strict: false,
        });

        const safetyDiags = configDiagnosticsWithCode(result, "CONFIG_PATH_SYMLINK_ESCAPE");
        expect(safetyDiags.length).toBeGreaterThan(0);

        const metric = metricFor(result, "workflows/*.{workflow.ts,agent.ts}");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(1);
        expect(metric!.rejectedBySafetyCount).toBe(1);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("10. Marker and runtime rejections happen before safety", async () => {
      const root = await getTempDir();
      const outsideDir = await fs.mkdtemp(join(tmpdir(), "collect-files-outside-"));
      try {
        const outsideFile = join(outsideDir, "outside.ts");
        await fs.writeFile(outsideFile, "export const meta = {};");

        // Subcase 1: Marker case
        const plainSymlink = join(root, "workflows/plain.ts");
        await fs.mkdir(join(plainSymlink, ".."), { recursive: true });
        let symlinksSupported = true;
        try {
          await fs.symlink(outsideFile, plainSymlink);
        } catch {
          symlinksSupported = false;
        }

        if (!symlinksSupported) return;

        const resultMarker = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        const safetyDiagsMarker = configDiagnosticsWithCode(resultMarker, "CONFIG_PATH_SYMLINK_ESCAPE");
        expect(safetyDiagsMarker).toHaveLength(0);

        const metricMarker = metricFor(resultMarker, "workflows/**/*");
        expect(metricMarker).toBeDefined();
        expect(metricMarker!.rejectedByMarkerCount).toBe(1);
        expect(metricMarker!.rejectedBySafetyCount).toBe(0);

        // Subcase 2: Runtime case
        try {
          await fs.unlink(plainSymlink);
        } catch {}
        const mdOutsideFile = join(outsideDir, "outside.md");
        await fs.writeFile(mdOutsideFile, "markdown");
        const mdSymlink = join(root, "workflows/escaped.workflow.md");
        await fs.symlink(mdOutsideFile, mdSymlink);

        const resultRuntime = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*"],
          exclude: ["workflows/plain.ts"],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        const safetyDiagsRuntime = configDiagnosticsWithCode(resultRuntime, "CONFIG_PATH_SYMLINK_ESCAPE");
        expect(safetyDiagsRuntime).toHaveLength(0);

        const metricRuntime = metricFor(resultRuntime, "workflows/**/*");
        expect(metricRuntime).toBeDefined();
        expect(metricRuntime!.rejectedByMarkerCount).toBe(0);
        expect(metricRuntime!.rejectedBySafetyCount).toBe(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("11. User-authored include with no accepted candidates warns", async () => {
      const root = await getTempDir();
      try {
        await fs.mkdir(join(root, "workflows"), { recursive: true });
        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          strict: false,
        });

        const diags = configDiagnosticsWithCode(result, "CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
        expect(diags).toHaveLength(1);
        expect(diags[0].resource).toBe("workflow");
        expect(diags[0].path).toBe("workflow.include[0]");
        expect(diags[0].value).toBe("workflows/**/*.workflow.ts");
        expect(diags[0].fatalInStrictContext).toBe(false);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("12. Default include with no accepted candidates is quiet", async () => {
      const root = await getTempDir();
      try {
        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.ts"],
          exclude: [],
          compatibilityMode: "default-suffix-specific",
          includeSource: "default",
          strict: false,
        });

        const diags = configDiagnosticsWithCode(result, "CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
        expect(diags).toHaveLength(0);

        const metric = metricFor(result, "workflows/**/*.ts");
        expect(metric).toBeDefined();
        expect(metric!.acceptedCandidateCount).toBe(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("13. CLI and legacy include zero-match warnings are preserved", async () => {
      const root = await getTempDir();
      try {
        await fs.mkdir(join(root, "workflows"), { recursive: true });
        const sources: Array<"cli-override" | "legacy-dir" | "legacy-discovery"> = [
          "cli-override",
          "legacy-dir",
          "legacy-discovery",
        ];

        for (const src of sources) {
          const result = await collectResourceCandidateFiles({
            cwd: root,
            resourceType: "workflow",
            include: ["workflows/**/*.workflow.ts"],
            exclude: [],
            compatibilityMode: src === "legacy-dir" ? "cli-dir-compatible" : "new-suffix-specific",
            includeSource: src,
            strict: false,
          });

          const diags = configDiagnosticsWithCode(result, "CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
          expect(diags.length).toBeGreaterThan(0);
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("14. Include matched files but accepted none has accurate warning wording", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "workflows/plain.ts");

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          strict: false,
        });

        const metric = metricFor(result, "workflows/**/*");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(1);
        expect(metric!.acceptedCandidateCount).toBe(0);
        expect(metric!.rejectedByMarkerCount).toBe(1);

        const diags = configDiagnosticsWithCode(result, "CONFIG_PATH_INCLUDE_MATCHED_NOTHING");
        expect(diags).toHaveLength(1);
        expect(diags[0].message).not.toContain("did not match any files");
        expect(diags[0].message.toLowerCase()).toContain("candidate");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("15. Exclude zero-match source policy", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "workflows/keep.workflow.ts");

        const testCases = [
          { source: "new" as const, expectedDiagCount: 1 },
          { source: "legacy-discovery" as const, expectedDiagCount: 1 },
          { source: "default" as const, expectedDiagCount: 0 },
          { source: "legacy-dir" as const, expectedDiagCount: 0 },
          { source: "cli-override" as const, expectedDiagCount: 0 },
        ];

        for (const tc of testCases) {
          const result = await collectResourceCandidateFiles({
            cwd: root,
            resourceType: "workflow",
            include: ["workflows/**/*.workflow.ts"],
            exclude: ["workflows/unused.workflow.ts"],
            compatibilityMode: "new-suffix-specific",
            includeSource: "new",
            excludeSource: tc.source,
            strict: false,
          });

          const diags = configDiagnosticsWithCode(result, "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
          expect(diags).toHaveLength(tc.expectedDiagCount);
          if (tc.expectedDiagCount > 0) {
            expect(diags[0].code).toBe("CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
            expect(diags[0].resource).toBe("workflow");
            expect(diags[0].value).toBe("workflows/unused.workflow.ts");
          }
        }

        // exclude: [] should be quiet
        const resultEmpty = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          excludeSource: "new",
          strict: false,
        });
        const diagsEmpty = configDiagnosticsWithCode(resultEmpty, "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
        expect(diagsEmpty).toHaveLength(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("16. Exclude usage means actual candidate filtering", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "docs/ignored.workflow.ts");
        await writeFile(root, "workflows/keep.workflow.ts");

        // Subcase 1: exclude matches outside include set
        const result1 = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: ["docs/**/*.workflow.ts"],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          excludeSource: "new",
          strict: false,
        });

        expect(relativePaths(result1)).toEqual(["workflows/keep.workflow.ts"]);
        const diags1 = configDiagnosticsWithCode(result1, "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
        expect(diags1).toHaveLength(1);

        const metric1 = metricFor(result1, "workflows/**/*.workflow.ts");
        expect(metric1).toBeDefined();
        expect(metric1!.excludedCandidateCount).toBe(0);

        // Subcase 2: exclude actually filters a candidate
        await writeFile(root, "workflows/drop.workflow.ts");
        const result2 = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: ["workflows/drop.workflow.ts"],
          compatibilityMode: "new-suffix-specific",
          includeSource: "new",
          excludeSource: "new",
          strict: false,
        });

        expect(relativePaths(result2)).toEqual(["workflows/keep.workflow.ts"]);
        const diags2 = configDiagnosticsWithCode(result2, "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING");
        expect(diags2).toHaveLength(0);

        const metric2 = metricFor(result2, "workflows/**/*.workflow.ts");
        expect(metric2).toBeDefined();
        expect(metric2!.excludedCandidateCount).toBe(1);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("17. Real-path dedupe keeps one candidate", async () => {
      const root = await getTempDir();
      try {
        const realPath = await writeFile(root, "workflows/real.workflow.ts");
        const linkPath = join(root, "workflows/link.workflow.ts");

        let symlinksSupported = true;
        try {
          await fs.symlink(realPath, linkPath);
        } catch {
          symlinksSupported = false;
        }

        if (!symlinksSupported) return;

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        expect(result.files).toHaveLength(1);
        expect(result.files[0].realPath).toBe(resolve(realPath));

        const metric = metricFor(result, "workflows/**/*.workflow.ts");
        expect(metric).toBeDefined();
        expect(metric!.matchedPathCount).toBe(2);
        expect(metric!.acceptedCandidateCount).toBe(1);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("18. Returned candidates are sorted", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "workflows/z.workflow.ts");
        await writeFile(root, "workflows/a.workflow.ts");
        await writeFile(root, "workflows/m.workflow.ts");

        const result = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["workflows/**/*.workflow.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        const paths = relativePaths(result);
        const sortedPaths = [...paths].sort((a, b) => a.localeCompare(b));
        expect(paths).toEqual(sortedPaths);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("19. Legacy directory fallback returns source metadata and metrics", async () => {
      const root = await getTempDir();
      try {
        await writeFile(root, "workflows/w1.ts");
        await writeFile(root, "agents/a1.js");
        await writeFile(root, "tools/t1.js");

        const result = await collectCandidateFiles({
          cwd: root,
          resourceTypes: ["workflow", "agent", "tool"],
          directories: {
            workflowInclude: ["workflows/**/*.ts"],
            agentsDir: "agents",
            toolsDir: "tools",
          },
          strict: false,
        });

        expect(result.files.length).toBeGreaterThan(0);
        for (const file of result.files) {
          expect(file).toHaveProperty("sourcePattern");
          expect(file).toHaveProperty("sourceConfigPath");
          expect(file).toHaveProperty("source");
        }

        expect(result).toHaveProperty("metrics");
        expect(Array.isArray(result.metrics)).toBe(true);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("20. Missing and unreadable include-base diagnostics remain stable", async () => {
      const root = await getTempDir();
      try {
        // Missing directory case
        const resultMissing = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["missing-dir/**/*.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        expect(resultMissing.diagnostics).toHaveLength(1);
        expect(resultMissing.diagnostics[0].code).toBe("LIST_DIRECTORY_NOT_FOUND");
        const hasZeroMatchMissing = resultMissing.configDiagnostics.some(
          d => d.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING"
        );
        expect(hasZeroMatchMissing).toBe(false);

        // Unreadable (is file instead of directory) case
        await writeFile(root, "file-instead-of-dir.ts");
        const resultUnreadable = await collectResourceCandidateFiles({
          cwd: root,
          resourceType: "workflow",
          include: ["file-instead-of-dir.ts/**/*.ts"],
          exclude: [],
          compatibilityMode: "new-suffix-specific",
          strict: false,
        });

        expect(resultUnreadable.diagnostics).toHaveLength(1);
        expect(resultUnreadable.diagnostics[0].code).toBe("LIST_FILE_UNREADABLE");
        const hasZeroMatchUnreadable = resultUnreadable.configDiagnostics.some(
          d => d.code === "CONFIG_PATH_INCLUDE_MATCHED_NOTHING"
        );
        expect(hasZeroMatchUnreadable).toBe(false);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });
});
