import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { precollectResourceForLoad, precollectAllResourcesForLoad } from "../../../src/discovery/precollect.js";
import type { NormalizedResourceDiscovery, NormalizedDiscoveryConfig } from "../../../src/config/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

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
