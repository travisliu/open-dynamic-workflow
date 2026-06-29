import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { NormalizedResourceDiscovery } from "../../../src/config/types.js";
import { compileResourceDiscovery } from "../../../src/discovery/compile-patterns.js";
import { normalizeResourceDiscovery } from "../../../src/config/path-discovery.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";

const cwd = "/root/projects/cadecli";

function createDiscoveryFixture(
  overrides: Partial<NormalizedResourceDiscovery & { exclude?: string[] }> = {}
): NormalizedResourceDiscovery & { exclude?: string[] } {
  const fixture: NormalizedResourceDiscovery & { exclude?: string[] } = {
    resource: "workflow",
    include: ["workflows/**/*.workflow.ts"],
    exclude: ["out/**"],
    source: "new",
    includeSource: "new",
    excludeSource: "new",
    compatibilityMode: "new-suffix-specific",
    sourcePaths: ["workflow.include"],
    rawInclude: ["workflows/**/*.workflow.ts"],
    rawExclude: ["out/**"],
    diagnostics: [],
    ...overrides,
  };
  return fixture;
}

describe("compileResourceDiscovery", () => {
  it("compiles includes with correct metadata, config paths, and absolute base directory", () => {
    const fixture = createDiscoveryFixture({
      resource: "workflow",
      include: ["workflows/sub-folder/**/*.workflow.ts"],
      rawInclude: ["./workflows/sub-folder/**/*.workflow.ts"],
      includeSource: "new",
    });

    const result = compileResourceDiscovery({ cwd, discovery: fixture });

    expect(result.diagnostics).toEqual([]);
    expect(result.discovery.resource).toBe("workflow");
    expect(result.discovery.listResourceType).toBe("workflow");
    expect(result.discovery.compatibilityMode).toBe("new-suffix-specific");

    const compiledInclude = result.discovery.include[0];
    expect(compiledInclude).toBeDefined();
    expect(compiledInclude.kind).toBe("include");
    expect(compiledInclude.resource).toBe("workflow");
    expect(compiledInclude.rawValue).toBe("./workflows/sub-folder/**/*.workflow.ts");
    expect(compiledInclude.normalizedPattern).toBe("workflows/sub-folder/**/*.workflow.ts");
    expect(compiledInclude.diagnosticLabel).toBe("./workflows/sub-folder/**/*.workflow.ts");
    expect(compiledInclude.configPath).toBe("workflow.include[0]");
    expect(compiledInclude.source).toBe("new");
    expect(compiledInclude.compatibilityMode).toBe("new-suffix-specific");
    expect(compiledInclude.index).toBe(0);
    expect(compiledInclude.hasGlob).toBe(true);
    expect(compiledInclude.classification).toBe("glob");
    expect(compiledInclude.baseDir).toBe("workflows/sub-folder");
    expect(compiledInclude.absoluteBaseDir).toBe(resolve(cwd, "workflows/sub-folder"));
    expect(compiledInclude.marker).toBe(".workflow.");
    expect(compiledInclude.markerPolicy).toBe("required");
  });

  it("handles literal-file classification and base directory", () => {
    const fixture = createDiscoveryFixture({
      include: ["workflows/literal-file.workflow.ts"],
      rawInclude: ["workflows/literal-file.workflow.ts"],
    });

    const result = compileResourceDiscovery({ cwd, discovery: fixture });
    const compiledInclude = result.discovery.include[0];
    expect(compiledInclude.hasGlob).toBe(false);
    expect(compiledInclude.classification).toBe("literal-file");
    expect(compiledInclude.baseDir).toBe("workflows/literal-file.workflow.ts");
    expect(compiledInclude.absoluteBaseDir).toBe(resolve(cwd, "workflows/literal-file.workflow.ts"));
  });

  it("maps resource types correctly", () => {
    const workflowFixture = createDiscoveryFixture({ resource: "workflow" });
    const agentsFixture = createDiscoveryFixture({ resource: "sharedAgents" });
    const toolsFixture = createDiscoveryFixture({ resource: "tools" });

    expect(compileResourceDiscovery({ cwd, discovery: workflowFixture }).discovery.listResourceType).toBe("workflow");
    expect(compileResourceDiscovery({ cwd, discovery: agentsFixture }).discovery.listResourceType).toBe("agent");
    expect(compileResourceDiscovery({ cwd, discovery: toolsFixture }).discovery.listResourceType).toBe("tool");

    expect(compileResourceDiscovery({ cwd, discovery: workflowFixture }).discovery.include[0].marker).toBe(".workflow.");
    expect(compileResourceDiscovery({ cwd, discovery: agentsFixture }).discovery.include[0].marker).toBe(".agent.");
    expect(compileResourceDiscovery({ cwd, discovery: toolsFixture }).discovery.include[0].marker).toBe(".tool.");
  });

  it("compiles omitted excludes to an empty array and returns no diagnostics", () => {
    const fixture = createDiscoveryFixture();
    delete fixture.exclude;

    const result = compileResourceDiscovery({ cwd, discovery: fixture });
    expect(result.discovery.exclude).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("compiles explicit empty excludes to an empty array", () => {
    const fixture = createDiscoveryFixture({ exclude: [] });

    const result = compileResourceDiscovery({ cwd, discovery: fixture });
    expect(result.discovery.exclude).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("compiles exclude patterns with correct metadata and config path", () => {
    const fixture = createDiscoveryFixture({
      resource: "workflow",
      exclude: ["out/dist/**/*.js"],
      rawExclude: ["./out/dist/**/*.js"],
      excludeSource: "new",
    });

    const result = compileResourceDiscovery({ cwd, discovery: fixture });
    const compiledExclude = result.discovery.exclude[0];

    expect(compiledExclude.kind).toBe("exclude");
    expect(compiledExclude.source).toBe("new");
    expect(compiledExclude.rawValue).toBe("./out/dist/**/*.js");
    expect(compiledExclude.normalizedPattern).toBe("out/dist/**/*.js");
    expect(compiledExclude.configPath).toBe("workflow.exclude[0]");
    expect(compiledExclude.hasGlob).toBe(true);
    expect(compiledExclude.classification).toBe("glob");
  });

  it("sets markerPolicy to optional-for-generic-runtime-pattern for generic runtime extensions without resource marker", () => {
    const extensions = [".js", ".ts", ".mjs", ".cjs"];
    for (const ext of extensions) {
      const fixture = createDiscoveryFixture({
        include: [`workflows/app${ext}`],
      });
      const result = compileResourceDiscovery({ cwd, discovery: fixture });
      expect(result.discovery.include[0].markerPolicy).toBe("optional-for-generic-runtime-pattern");
    }
  });

  it("sets markerPolicy to required for patterns targeting specific marker or non-generic extensions", () => {
    const withMarker = createDiscoveryFixture({
      resource: "workflow",
      include: ["workflows/app.workflow.ts"],
    });
    expect(compileResourceDiscovery({ cwd, discovery: withMarker }).discovery.include[0].markerPolicy).toBe("required");

    const otherExt = createDiscoveryFixture({
      resource: "workflow",
      include: ["workflows/app.json"],
    });
    expect(compileResourceDiscovery({ cwd, discovery: otherExt }).discovery.include[0].markerPolicy).toBe("required");
  });

  it("sets markerPolicy to optional-for-generic-runtime-pattern for generic runtime brace extensions", () => {
    const fixture1 = createDiscoveryFixture({
      resource: "workflow",
      include: ["workflows/**/*.{js,ts}"],
    });
    expect(compileResourceDiscovery({ cwd, discovery: fixture1 }).discovery.include[0].markerPolicy).toBe("optional-for-generic-runtime-pattern");

    const fixture2 = createDiscoveryFixture({
      resource: "workflow",
      include: ["workflows/**/*.workflow.{js,ts}"],
    });
    expect(compileResourceDiscovery({ cwd, discovery: fixture2 }).discovery.include[0].markerPolicy).toBe("required");

    const fixture3 = createDiscoveryFixture({
      resource: "workflow",
      include: ["workflows/**/*.{ts,json}"],
    });
    expect(compileResourceDiscovery({ cwd, discovery: fixture3 }).discovery.include[0].markerPolicy).toBe("required");
  });

  it("sets markerPolicy to optional-for-generic-runtime-pattern for legacy-compatible and cli-dir-compatible", () => {
    const legacyFixture = createDiscoveryFixture({
      compatibilityMode: "legacy-compatible",
      include: ["workflows/app.workflow.ts"],
    });
    expect(compileResourceDiscovery({ cwd, discovery: legacyFixture }).discovery.include[0].markerPolicy).toBe("optional-for-generic-runtime-pattern");

    const cliDirFixture = createDiscoveryFixture({
      compatibilityMode: "cli-dir-compatible",
      include: ["workflows/app.workflow.ts"],
    });
    expect(compileResourceDiscovery({ cwd, discovery: cliDirFixture }).discovery.include[0].markerPolicy).toBe("optional-for-generic-runtime-pattern");
  });

  it("recognizes non-asterisk glob syntax supported by tinyglobby", () => {
    const patterns = [
      { pat: "workflows/file?.ts", base: "workflows" },
      { pat: "workflows/*.{ts,js}", base: "workflows" },
      { pat: "workflows/[ab].ts", base: "workflows" },
      { pat: "workflows/**/x.ts", base: "workflows" },
      { pat: "workflows/+(a).ts", base: "workflows" },
    ];

    for (const { pat, base } of patterns) {
      const fixture = createDiscoveryFixture({ include: [pat] });
      const result = compileResourceDiscovery({ cwd, discovery: fixture });
      expect(result.discovery.include[0].hasGlob).toBe(true);
      expect(result.discovery.include[0].classification).toBe("glob");
      expect(result.discovery.include[0].baseDir).toBe(base);
    }
  });

  it("normalizes Windows-style separators to POSIX", () => {
    const fixture = createDiscoveryFixture({
      include: ["workflows\\sub\\*.workflow.ts"],
      rawInclude: ["workflows\\sub\\*.workflow.ts"],
    });
    const result = compileResourceDiscovery({ cwd, discovery: fixture });
    expect(result.discovery.include[0].normalizedPattern).toBe("workflows/sub/*.workflow.ts");
    expect(result.discovery.include[0].baseDir).toBe("workflows/sub");
  });

  describe("configPath calculation variations", () => {
    it("handles legacy-discovery source", () => {
      const fixture = createDiscoveryFixture({
        resource: "workflow",
        includeSource: "legacy-discovery",
      });
      const result = compileResourceDiscovery({ cwd, discovery: fixture });
      expect(result.discovery.include[0].configPath).toBe("workflow.discovery.include[0]");
    });

    it("handles legacy-dir source", () => {
      const fixture = createDiscoveryFixture({
        resource: "sharedAgents",
        includeSource: "legacy-dir",
      });
      const result = compileResourceDiscovery({ cwd, discovery: fixture });
      expect(result.discovery.include[0].configPath).toBe("sharedAgents.dir");
    });

    it("handles cli-override source with matching sourcePaths", () => {
      const fixture = createDiscoveryFixture({
        resource: "workflow",
        includeSource: "cli-override",
        sourcePaths: ["cli.workflowsDir"],
      });
      const result = compileResourceDiscovery({ cwd, discovery: fixture });
      expect(result.discovery.include[0].configPath).toBe("cli.workflowsDir");
    });

    it("handles default source", () => {
      const fixture = createDiscoveryFixture({
        resource: "tools",
        includeSource: "default",
      });
      const result = compileResourceDiscovery({ cwd, discovery: fixture });
      expect(result.discovery.include[0].configPath).toBe("tools.include[0]");
    });

    it("preserves specific CLI override configPaths through the normalized-to-compiled handoff", () => {
      // 1. workflow override
      const normWorkflow = normalizeResourceDiscovery({
        resource: "workflow",
        config: DEFAULT_CONFIG,
        cwd,
        cliOverrides: {
          workflowsDir: "custom-workflows",
        },
      });
      const compWorkflow = compileResourceDiscovery({ cwd, discovery: normWorkflow });
      expect(compWorkflow.discovery.include[0].configPath).toBe("cli.workflowsDir");

      // 2. agents override
      const normAgents = normalizeResourceDiscovery({
        resource: "sharedAgents",
        config: DEFAULT_CONFIG,
        cwd,
        cliOverrides: {
          agentsDir: "custom-agents",
        },
      });
      const compAgents = compileResourceDiscovery({ cwd, discovery: normAgents });
      expect(compAgents.discovery.include[0].configPath).toBe("cli.agentsDir");

      // 3. tools override
      const normTools = normalizeResourceDiscovery({
        resource: "tools",
        config: DEFAULT_CONFIG,
        cwd,
        cliOverrides: {
          toolsDir: "custom-tools",
        },
      });
      const compTools = compileResourceDiscovery({ cwd, discovery: normTools });
      expect(compTools.discovery.include[0].configPath).toBe("cli.toolsDir");

      // 4. fallback override
      const normFallback = normalizeResourceDiscovery({
        resource: "workflow",
        config: DEFAULT_CONFIG,
        cwd,
        cliOverrides: {
          resourceType: "workflow",
          dir: "custom-dir",
        },
      });
      const compFallback = compileResourceDiscovery({ cwd, discovery: normFallback });
      expect(compFallback.discovery.include[0].configPath).toBe("cli.dir");
    });
  });
});
