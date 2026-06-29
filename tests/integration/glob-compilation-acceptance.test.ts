import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expandIncludePattern } from "../../src/discovery/glob-engine.js";
import { normalizeDiscoveryConfig } from "../../src/config/path-discovery.js";
import { compileResourceDiscovery } from "../../src/discovery/compile-patterns.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { DiscoveryCliOverrides } from "../../src/config/types.js";

describe("Glob Engine and Pattern Compilation Acceptance Tests (Phase 1)", () => {
  let tempDir: string;
  let symlinkCreated = false;
  let symlinkTargetDir: string;
  let symlinkPath: string;

  // Arrange: Set up temporary directories with files (including workflows, agents, tools, dot-folders, and symlinked paths)
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "glob-compilation-acceptance-"));

    // Create workflow, agent, tools, and dot-folders
    await fs.mkdir(join(tempDir, "workflows/nested"), { recursive: true });
    await fs.mkdir(join(tempDir, ".open-dynamic-workflow/agents"), { recursive: true });
    await fs.mkdir(join(tempDir, "tools"), { recursive: true });
    await fs.mkdir(join(tempDir, "parent"), { recursive: true });

    // Write file fixtures
    await fs.writeFile(join(tempDir, "workflows/a.workflow.ts"), "content");
    await fs.writeFile(join(tempDir, "workflows/nested/b.workflow.ts"), "content");
    await fs.writeFile(join(tempDir, "workflows/readme.md"), "content");
    await fs.writeFile(join(tempDir, ".open-dynamic-workflow/agents/a.agent.ts"), "content");
    await fs.writeFile(join(tempDir, "tools/deploy.tool.ts"), "content");

    // Symlinked path setup
    symlinkTargetDir = join(tempDir, "outside-target");
    await fs.mkdir(symlinkTargetDir, { recursive: true });
    await fs.writeFile(join(symlinkTargetDir, "linked.workflow.ts"), "content");

    symlinkPath = join(tempDir, "parent/workflows-symlink");
    try {
      await fs.symlink(symlinkTargetDir, symlinkPath, "dir");
      symlinkCreated = true;
    } catch (e) {
      symlinkCreated = false;
    }
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const toPosix = (p: string) => p.replace(/\\/g, "/");

  describe("Glob Engine Wrapper (Act & Assert)", () => {
    it("successfully lists files matching include glob, returns sorted POSIX absolute paths", async () => {
      // Act
      const results = await expandIncludePattern({
        cwd: tempDir,
        pattern: "workflows/**/*.workflow.ts",
      });

      // Assert
      expect(results).toEqual([
        toPosix(resolve(join(tempDir, "workflows/a.workflow.ts"))),
        toPosix(resolve(join(tempDir, "workflows/nested/b.workflow.ts"))),
      ]);
    });

    it("includes dot-folders, proving dot: true", async () => {
      // Act
      const results = await expandIncludePattern({
        cwd: tempDir,
        pattern: ".open-dynamic-workflow/agents/**/*.agent.ts",
      });

      // Assert
      expect(results).toEqual([
        toPosix(resolve(join(tempDir, ".open-dynamic-workflow/agents/a.agent.ts"))),
      ]);
    });

    it("ignores symlinks, proving followSymbolicLinks: false", async () => {
      if (!symlinkCreated) {
        return; // Skip if symlink creation is not supported on this platform/run
      }

      // Act
      const results = await expandIncludePattern({
        cwd: tempDir,
        pattern: "parent/**/*.workflow.ts",
      });

      // Assert
      expect(results).toEqual([]);
    });

    it("does not expand directory-only inputs, proving expandDirectories: false", async () => {
      // Act
      const results = await expandIncludePattern({
        cwd: tempDir,
        pattern: "workflows",
      });

      // Assert
      expect(results).toEqual([]);
    });

    it("normalizes Windows paths in input patterns", async () => {
      // Act
      const results = await expandIncludePattern({
        cwd: tempDir,
        pattern: "workflows\\*.workflow.ts",
      });

      // Assert
      expect(results).toEqual([
        toPosix(resolve(join(tempDir, "workflows/a.workflow.ts"))),
      ]);
    });
  });

  describe("Omitted Excludes Normalization and Compilation (Act & Assert)", () => {
    it("normalizes and compiles omitted excludes to empty arrays and generates no diagnostics", () => {
      // Arrange
      const rawConfig = {
        workflow: {
          include: ["workflows/**/*.workflow.ts"],
          // exclude is omitted
        },
      };

      // Act
      const { discovery, diagnostics } = normalizeDiscoveryConfig({
        config: {
          ...DEFAULT_CONFIG,
          workflow: {
            ...DEFAULT_CONFIG.workflow,
            include: ["workflows/**/*.workflow.ts"],
            exclude: undefined,
          },
        },
        cwd: tempDir,
        rawConfig,
      });

      const compiledResult = compileResourceDiscovery({
        cwd: tempDir,
        discovery: discovery.workflow,
      });

      // Assert
      expect(discovery.workflow.exclude).toEqual([]);
      expect(diagnostics.filter(d => d.path.includes("exclude"))).toEqual([]);

      expect(compiledResult.discovery.exclude).toEqual([]);
      expect(compiledResult.diagnostics).toEqual([]);
    });

    it("normalizes and compiles explicit empty excludes to empty arrays and generates no diagnostics", () => {
      // Arrange
      const rawConfig = {
        workflow: {
          include: ["workflows/**/*.workflow.ts"],
          exclude: [],
        },
      };

      // Act
      const { discovery, diagnostics } = normalizeDiscoveryConfig({
        config: {
          ...DEFAULT_CONFIG,
          workflow: {
            ...DEFAULT_CONFIG.workflow,
            include: ["workflows/**/*.workflow.ts"],
            exclude: [],
          },
        },
        cwd: tempDir,
        rawConfig,
      });

      const compiledResult = compileResourceDiscovery({
        cwd: tempDir,
        discovery: discovery.workflow,
      });

      // Assert
      expect(discovery.workflow.exclude).toEqual([]);
      expect(diagnostics).toEqual([]);

      expect(compiledResult.discovery.exclude).toEqual([]);
      expect(compiledResult.diagnostics).toEqual([]);
    });
  });

  describe("Compiled Patterns (Act & Assert)", () => {
    it("correctly computes classification, baseDir, absoluteBaseDir, marker, markerPolicy, and preserves metadata", () => {
      // Arrange
      const rawConfig = {
        workflow: {
          include: ["workflows/**/*.workflow.ts"],
        },
      };

      const { discovery } = normalizeDiscoveryConfig({
        config: {
          ...DEFAULT_CONFIG,
          workflow: {
            ...DEFAULT_CONFIG.workflow,
            include: ["workflows/**/*.workflow.ts"],
          },
        },
        cwd: tempDir,
        rawConfig,
      });

      // Act
      const compiledResult = compileResourceDiscovery({
        cwd: tempDir,
        discovery: discovery.workflow,
      });

      // Assert
      const compiled = compiledResult.discovery.include[0];
      expect(compiled).toBeDefined();
      expect(compiled.kind).toBe("include");
      expect(compiled.resource).toBe("workflow");
      expect(compiled.rawValue).toBe("workflows/**/*.workflow.ts");
      expect(compiled.normalizedPattern).toBe("workflows/**/*.workflow.ts");
      expect(compiled.configPath).toBe("workflow.include[0]");
      expect(compiled.source).toBe("new");
      expect(compiled.index).toBe(0);
      expect(compiled.hasGlob).toBe(true);
      expect(compiled.classification).toBe("glob");
      expect(compiled.baseDir).toBe("workflows");
      expect(compiled.absoluteBaseDir).toBe(toPosix(resolve(tempDir, "workflows")));
      expect(compiled.marker).toBe(".workflow.");
      expect(compiled.markerPolicy).toBe("required");
    });

    it("correctly computes classification and baseDir for literal files", () => {
      // Arrange
      const rawConfig = {
        workflow: {
          include: ["workflows/a.workflow.ts"],
        },
      };

      const { discovery } = normalizeDiscoveryConfig({
        config: {
          ...DEFAULT_CONFIG,
          workflow: {
            ...DEFAULT_CONFIG.workflow,
            include: ["workflows/a.workflow.ts"],
          },
        },
        cwd: tempDir,
        rawConfig,
      });

      // Act
      const compiledResult = compileResourceDiscovery({
        cwd: tempDir,
        discovery: discovery.workflow,
      });

      // Assert
      const compiled = compiledResult.discovery.include[0];
      expect(compiled.hasGlob).toBe(false);
      expect(compiled.classification).toBe("literal-file");
      expect(compiled.baseDir).toBe("workflows/a.workflow.ts");
      expect(compiled.absoluteBaseDir).toBe(toPosix(resolve(tempDir, "workflows/a.workflow.ts")));
    });

    it("correctly computes baseDir as '.' for root-level globs", () => {
      // Arrange
      const rawConfig = {
        workflow: {
          include: ["**/*.workflow.ts"],
        },
      };

      const { discovery } = normalizeDiscoveryConfig({
        config: {
          ...DEFAULT_CONFIG,
          workflow: {
            ...DEFAULT_CONFIG.workflow,
            include: ["**/*.workflow.ts"],
          },
        },
        cwd: tempDir,
        rawConfig,
      });

      // Act
      const compiledResult = compileResourceDiscovery({
        cwd: tempDir,
        discovery: discovery.workflow,
      });

      // Assert
      const compiled = compiledResult.discovery.include[0];
      expect(compiled.baseDir).toBe(".");
      expect(compiled.absoluteBaseDir).toBe(toPosix(resolve(tempDir, ".")));
    });

    it("assigns optional-for-generic-runtime-pattern markerPolicy for generic extensions", () => {
      // Arrange
      const rawConfig = {
        workflow: {
          include: ["workflows/**/*.ts"],
        },
      };

      const { discovery } = normalizeDiscoveryConfig({
        config: {
          ...DEFAULT_CONFIG,
          workflow: {
            ...DEFAULT_CONFIG.workflow,
            include: ["workflows/**/*.ts"],
          },
        },
        cwd: tempDir,
        rawConfig,
      });

      // Act
      const compiledResult = compileResourceDiscovery({
        cwd: tempDir,
        discovery: discovery.workflow,
      });

      // Assert
      const compiled = compiledResult.discovery.include[0];
      expect(compiled.markerPolicy).toBe("optional-for-generic-runtime-pattern");
    });
  });

  describe("Dependency and Import Isolation", () => {
    it("ensures that no production source file other than src/discovery/glob-engine.ts imports tinyglobby", async () => {
      const srcDir = resolve(__dirname, "../../src");
      
      const violatingFiles: string[] = [];

      async function scanDirectory(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
            if (fullPath.replace(/\\/g, "/").endsWith("src/discovery/glob-engine.ts")) {
              continue;
            }
            const content = await fs.readFile(fullPath, "utf-8");
            // Check for direct tinyglobby imports
            if (
              content.includes('from "tinyglobby"') ||
              content.includes("from 'tinyglobby'") ||
              content.includes('import "tinyglobby"') ||
              content.includes("import 'tinyglobby'")
            ) {
              violatingFiles.push(fullPath);
            }
          }
        }
      }

      await scanDirectory(srcDir);

      expect(violatingFiles).toEqual([]);
    });
  });

  describe("Comprehensive AAA Integration Test", () => {
    let workspaceDir: string;
    let symlinkTarget: string;
    let symlinkPath: string;
    let hasSymlink = false;

    // 1. Arrange: Create a temporary workspace directory and write mock files
    // including workflows/my-workflow.ts, workflows/.dot-dir/nested.ts, and a directory workflows/only-dir.
    beforeEach(async () => {
      workspaceDir = await fs.mkdtemp(join(tmpdir(), "glob-compilation-aaa-workspace-"));

      // Setup directories
      await fs.mkdir(join(workspaceDir, "workflows/.dot-dir"), { recursive: true });
      await fs.mkdir(join(workspaceDir, "workflows/only-dir"), { recursive: true });
      await fs.mkdir(join(workspaceDir, "outside-target"), { recursive: true });

      // Write mock files
      await fs.writeFile(join(workspaceDir, "workflows/my-workflow.ts"), "mock-workflow-content");
      await fs.writeFile(join(workspaceDir, "workflows/.dot-dir/nested.ts"), "mock-nested-content");
      await fs.writeFile(join(workspaceDir, "workflows/only-dir/file.ts"), "mock-only-dir-content");
      await fs.writeFile(join(workspaceDir, "outside-target/linked.workflow.ts"), "mock-linked-content");

      // Setup mock configurations mimicking defaults, omitted excludes, explicit excludes, and CLI overrides:
      // Symlink directory setup: workflows/symlinked-dir -> outside-target
      symlinkPath = join(workspaceDir, "workflows/symlinked-dir");
      symlinkTarget = join(workspaceDir, "outside-target");
      try {
        await fs.symlink(symlinkTarget, symlinkPath, "dir");
        hasSymlink = true;
      } catch (e) {
        hasSymlink = false;
      }
    });

    afterEach(async () => {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    });

    it("verifies the integrated behavior of the glob engine wrapper, pattern compiler, and config normalization", async () => {
      // Setup mock configurations mimicking defaults, omitted excludes, explicit excludes, and CLI overrides
      const configDefault = { ...DEFAULT_CONFIG };

      const configOmittedExcludes = {
        ...DEFAULT_CONFIG,
        workflow: {
          ...DEFAULT_CONFIG.workflow,
          include: ["workflows/**/*.ts"],
          exclude: undefined,
        },
      };

      const configExplicitExcludes = {
        ...DEFAULT_CONFIG,
        workflow: {
          ...DEFAULT_CONFIG.workflow,
          include: ["workflows/**/*.ts"],
          exclude: ["workflows/**/*.test.ts"],
        },
      };

      const cliOverrides: DiscoveryCliOverrides = {
        resourceType: "workflow",
        dir: "workflows",
      };

      // 2. Act:
      // - Normalize the configurations using normalizeDiscoveryConfig()
      const normalizedDefault = normalizeDiscoveryConfig({
        config: configDefault,
        cwd: workspaceDir,
        rawConfig: {},
      });

      const normalizedOmitted = normalizeDiscoveryConfig({
        config: configOmittedExcludes,
        cwd: workspaceDir,
        rawConfig: {
          workflow: {
            include: ["workflows/**/*.ts"],
          },
        },
      });

      const normalizedExplicit = normalizeDiscoveryConfig({
        config: configExplicitExcludes,
        cwd: workspaceDir,
        rawConfig: {
          workflow: {
            include: ["workflows/**/*.ts"],
            exclude: ["workflows/**/*.test.ts"],
          },
        },
      });

      const normalizedCliOverride = normalizeDiscoveryConfig({
        config: configDefault,
        cwd: workspaceDir,
        cliOverrides,
        rawConfig: {},
      });

      // - Pass the output to compileResourceDiscovery()
      const compiledDefault = compileResourceDiscovery({
        cwd: workspaceDir,
        discovery: normalizedDefault.discovery.workflow,
      });

      const compiledOmitted = compileResourceDiscovery({
        cwd: workspaceDir,
        discovery: normalizedOmitted.discovery.workflow,
      });

      const compiledExplicit = compileResourceDiscovery({
        cwd: workspaceDir,
        discovery: normalizedExplicit.discovery.workflow,
      });

      const compiledCliOverride = compileResourceDiscovery({
        cwd: workspaceDir,
        discovery: normalizedCliOverride.discovery.workflow,
      });

      // - Pass the compiled include patterns to expandIncludePattern() from the glob-engine
      // Expand include patterns for the Omitted Excludes config (which is workflows/**/*.ts)
      const expandedOmittedFiles = await Promise.all(
        compiledOmitted.discovery.include.map((inc) =>
          expandIncludePattern({ cwd: workspaceDir, pattern: inc.normalizedPattern })
        )
      ).then((res) => res.flat());

      // Expand a directory-only path "workflows/only-dir" to verify it is not expanded
      const expandedDirOnly = await expandIncludePattern({
        cwd: workspaceDir,
        pattern: "workflows/only-dir",
      });



      // 3. Assert:
      // - Assert that omitted excludes normalize and compile to empty arrays with no diagnostics
      expect(normalizedOmitted.discovery.workflow.exclude).toEqual([]);
      expect(normalizedOmitted.diagnostics.filter((d) => d.path.includes("exclude"))).toEqual([]);
      expect(compiledOmitted.discovery.exclude).toEqual([]);
      expect(compiledOmitted.diagnostics).toEqual([]);

      // - Assert that default includes compile to broad runtime-extension patterns
      const defaultPatterns = compiledDefault.discovery.include.map((inc) => inc.normalizedPattern);
      expect(defaultPatterns).toContain("workflows/**/*.js");
      expect(defaultPatterns).toContain("workflows/**/*.ts");
      expect(defaultPatterns).toContain("workflows/**/*.mjs");
      expect(defaultPatterns).toContain("workflows/**/*.cjs");

      // - Assert that expandIncludePattern resolves files correctly (absolute POSIX paths, sorted order),
      //   includes dot-directory files, does not expand directory-only paths, and does not follow symlinked directories.
      const expectedOmittedFiles = [
        toPosix(resolve(workspaceDir, "workflows/.dot-dir/nested.ts")),
        toPosix(resolve(workspaceDir, "workflows/my-workflow.ts")),
        toPosix(resolve(workspaceDir, "workflows/only-dir/file.ts")),
      ];
      expect(expandedOmittedFiles).toEqual(expectedOmittedFiles);

      // does not expand directory-only paths
      expect(expandedDirOnly).toEqual([]);

      // does not follow symlinked directories
      if (hasSymlink) {
        expect(expandedOmittedFiles).not.toContain(
          toPosix(resolve(workspaceDir, "workflows/symlinked-dir/linked.workflow.ts"))
        );
      }

      // Additional verify compilation on other outputs:
      expect(compiledExplicit.discovery.exclude.map(e => e.normalizedPattern)).toContain("workflows/**/*.test.ts");
      expect(compiledCliOverride.discovery.include.length).toBeGreaterThan(0);
    });
  });
});
