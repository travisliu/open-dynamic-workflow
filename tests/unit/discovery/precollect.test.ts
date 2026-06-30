import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { precollectResourceForLoad, precollectAllResourcesForLoad } from "../../../src/discovery/precollect.js";
import type { NormalizedResourceDiscovery, NormalizedDiscoveryConfig } from "../../../src/config/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

let compileCount = 0;
vi.mock("../../../src/discovery/compile-patterns.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/discovery/compile-patterns.js")>();
  return {
    ...original,
    compileResourceDiscovery: (input: any) => {
      compileCount++;
      return original.compileResourceDiscovery(input);
    }
  };
});

describe("Precollect Unit Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), "temp-precollect-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createMockResourceDiscovery(overrides: Partial<NormalizedResourceDiscovery> = {}): NormalizedResourceDiscovery {
    return {
      resource: "workflow",
      include: ["**/*.js"],
      exclude: ["**/exclude.js"],
      source: "project-config",
      includeSource: "project-config",
      excludeSource: "project-config",
      compatibilityMode: "default-suffix-specific",
      sourcePaths: [],
      rawInclude: ["**/*.js"],
      rawExclude: ["**/exclude.js"],
      diagnostics: [],
      ...overrides
    };
  }

  it("precollectResourceForLoad returns correct structure", async () => {
    // Create some files
    fs.mkdirSync(path.join(tempDir, "workflows"), { recursive: true });
    const targetFile = path.join(tempDir, "workflows", "target.js");
    const excludedFile = path.join(tempDir, "workflows", "exclude.js");
    fs.writeFileSync(targetFile, "console.log('target')");
    fs.writeFileSync(excludedFile, "console.log('exclude')");

    const discovery = createMockResourceDiscovery({
      include: ["workflows/**/*.js"],
      exclude: ["workflows/exclude.js"]
    });

    const result = await precollectResourceForLoad({
      cwd: tempDir,
      resourceType: "workflow",
      discovery,
      strict: true
    });

    expect(result.loadInput).toBeDefined();
    expect(result.loadInput.candidateFiles.length).toBe(1);
    expect(result.loadInput.candidateFiles[0].relativePath).toBe("workflows/target.js");
    expect(result.loadInput.discoveryPolicy.exclude.length).toBe(1);
    expect(result.loadInput.discoveryPolicy.exclude[0].absoluteBaseDir).toBe(
      path.resolve(tempDir, "workflows/exclude.js")
    );
    expect(result.collectionResult).toBeDefined();
    expect(result.collectionResult.files.length).toBe(1);
    expect(result.collectionResult.files[0].relativePath).toBe("workflows/target.js");
  });

  it("stale/missing includes preserve collection/config diagnostics and do not throw", async () => {
    // Specify inclusion of a file that does not exist
    const discovery = createMockResourceDiscovery({
      include: ["non-existent-folder/**/*.js"]
    });

    // Should not throw even in strict mode
    const result = await precollectResourceForLoad({
      cwd: tempDir,
      resourceType: "workflow",
      discovery,
      strict: true
    });

    expect(result.loadInput.candidateFiles).toEqual([]);
    expect(result.collectionResult.diagnostics).toBeDefined();

    // Assert a diagnostic such as LIST_DIRECTORY_NOT_FOUND is present
    const hasDirNotFound = result.collectionResult.diagnostics.some(
      d => d.code === "LIST_DIRECTORY_NOT_FOUND"
    );
    expect(hasDirNotFound).toBe(true);
  });

  it("exclude pattern that matches nothing preserves config diagnostics when the source should warn", async () => {
    fs.mkdirSync(path.join(tempDir, "workflows"), { recursive: true });
    const targetFile = path.join(tempDir, "workflows", "target.js");
    fs.writeFileSync(targetFile, "console.log('target')");

    const discovery = createMockResourceDiscovery({
      include: ["workflows/**/*.js"],
      exclude: ["workflows/non-existent-exclude.js"],
      excludeSource: "new"
    });

    const result = await precollectResourceForLoad({
      cwd: tempDir,
      resourceType: "workflow",
      discovery,
      strict: true
    });

    // Assert CONFIG_PATH_EXCLUDE_MATCHED_NOTHING is present
    const hasExcludeWarning = result.collectionResult.configDiagnostics.some(
      d => d.code === "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING"
    );
    expect(hasExcludeWarning).toBe(true);
  });

  it("symlink escape preservation", async () => {
    // Create a target file outside tempDir
    const outsideDir = fs.mkdtempSync(path.join(process.cwd(), "temp-outside-"));
    const outsideFile = path.join(outsideDir, "outside.js");
    fs.writeFileSync(outsideFile, "console.log('outside')");

    // Create workflow dir inside tempDir
    const workflowDir = path.join(tempDir, "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });

    // Create a symlink pointing outside
    const symlinkPath = path.join(workflowDir, "escape.js");
    try {
      fs.symlinkSync(outsideFile, symlinkPath);
    } catch {
      // Guard for platforms/filesystems where symlink creation is not allowed (e.g. Windows without admin privileges)
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return; // Skip test
    }

    try {
      const discovery = createMockResourceDiscovery({
        include: ["workflows/**/*.js"]
      });

      const result = await precollectResourceForLoad({
        cwd: tempDir,
        resourceType: "workflow",
        discovery,
        strict: true
      });

      // assert no unsafe candidate is accepted
      const candidatePaths = result.loadInput.candidateFiles.map(f => f.relativePath);
      expect(candidatePaths).not.toContain("workflows/escape.js");

      // assert configDiagnostics contains CONFIG_PATH_SYMLINK_ESCAPE
      const hasEscapeDiag = result.collectionResult.configDiagnostics.some(
        d => d.code === "CONFIG_PATH_SYMLINK_ESCAPE"
      );
      expect(hasEscapeDiag).toBe(true);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("direct import of collectCompiledResourceCandidateFiles works", async () => {
    const { collectCompiledResourceCandidateFiles } = await import("../../../src/discovery/collect-files.js");
    expect(collectCompiledResourceCandidateFiles).toBeTypeOf("function");
  });

  it("collectResourceCandidateFiles compatibility wrapper works", async () => {
    const { collectResourceCandidateFiles } = await import("../../../src/discovery/collect-files.js");
    fs.mkdirSync(path.join(tempDir, "workflows"), { recursive: true });
    const targetFile = path.join(tempDir, "workflows", "target.js");
    fs.writeFileSync(targetFile, "console.log('target')");

    const result = await collectResourceCandidateFiles({
      cwd: tempDir,
      resourceType: "workflow",
      include: ["workflows/**/*.js"],
      exclude: ["workflows/exclude.js"],
      compatibilityMode: "default-suffix-specific",
      strict: true
    });

    expect(result.files.length).toBe(1);
    expect(result.files[0].relativePath).toBe("workflows/target.js");
    expect(result.diagnostics).toBeDefined();
    expect(result.configDiagnostics).toBeDefined();
    expect(result.metrics).toBeDefined();
  });

  it("compiles discovery patterns exactly once", async () => {
    compileCount = 0;
    fs.mkdirSync(path.join(tempDir, "workflows"), { recursive: true });
    const targetFile = path.join(tempDir, "workflows", "target.js");
    fs.writeFileSync(targetFile, "console.log('target')");

    const discovery = createMockResourceDiscovery({
      include: ["workflows/**/*.js"],
      exclude: ["workflows/exclude.js"]
    });

    await precollectResourceForLoad({
      cwd: tempDir,
      resourceType: "workflow",
      discovery,
      strict: true
    });

    expect(compileCount).toBe(1);
  });

  it("precollectAllResourcesForLoad returns exactly workflow, sharedAgents, and tools", async () => {
    const discovery: NormalizedDiscoveryConfig = {
      workflow: createMockResourceDiscovery({ resource: "workflow" }),
      sharedAgents: createMockResourceDiscovery({ resource: "agent" }),
      tools: createMockResourceDiscovery({ resource: "tool" })
    };

    const result = await precollectAllResourcesForLoad({
      cwd: tempDir,
      discovery,
      strict: true
    });

    expect(result.workflow).toBeDefined();
    expect(result.sharedAgents).toBeDefined();
    expect(result.tools).toBeDefined();
    expect(Object.keys(result)).toEqual(["workflow", "sharedAgents", "tools"]);
  });
});
