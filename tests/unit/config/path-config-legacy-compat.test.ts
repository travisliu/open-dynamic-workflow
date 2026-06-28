import { describe, expect, it, afterEach } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Path Config Legacy Compatibility Unit Tests", () => {
  let tempDirs: string[] = [];

  function createTempDir(prefix: string) {
    const dir = join(tmpdir(), `odw-legacy-compat-unit-${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  function writeConfig(dir: string, content: string) {
    const configDir = join(dir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), content, "utf8");
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tempDirs = [];
  });

  it("1. sharedAgents.dir expands to generic runtime extension include patterns", async () => {
    const tempDir = createTempDir("agents-dir");
    writeConfig(tempDir, `
sharedAgents:
  dir: custom-agents
`);

    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config._normalizedDiscovery.sharedAgents.include).toEqual([
      "custom-agents/**/*.js",
      "custom-agents/**/*.ts",
      "custom-agents/**/*.mjs",
      "custom-agents/**/*.cjs",
    ]);
    expect(config._normalizedDiscovery.sharedAgents.source).toBe("legacy-dir");

    const diag = config._configDiagnostics.find(d => d.path === "sharedAgents.dir");
    expect(diag).toBeDefined();
    expect(diag?.code).toBe("CONFIG_PATH_LEGACY_KEY_USED");
    expect(diag?.severity).toBe("warning");
    expect(diag?.fatalInStrictContext).toBe(false);
  });

  it("2. tools.dir expands to generic runtime extension include patterns", async () => {
    const tempDir = createTempDir("tools-dir");
    writeConfig(tempDir, `
tools:
  dir: custom-tools
`);

    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config._normalizedDiscovery.tools.include).toEqual([
      "custom-tools/**/*.js",
      "custom-tools/**/*.ts",
      "custom-tools/**/*.mjs",
      "custom-tools/**/*.cjs",
    ]);
    expect(config._normalizedDiscovery.tools.source).toBe("legacy-dir");

    const diag = config._configDiagnostics.find(d => d.path === "tools.dir");
    expect(diag).toBeDefined();
    expect(diag?.code).toBe("CONFIG_PATH_LEGACY_KEY_USED");
    expect(diag?.severity).toBe("warning");
    expect(diag?.fatalInStrictContext).toBe(false);
  });

  it("3. workflow.discovery.include is preserved exactly", async () => {
    const tempDir = createTempDir("workflow-include");
    writeConfig(tempDir, `
workflow:
  discovery:
    include:
      - "legacy-workflows/**/*.js"
      - "legacy-workflows/**/*.ts"
`);

    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config._normalizedDiscovery.workflow.include).toEqual([
      "legacy-workflows/**/*.js",
      "legacy-workflows/**/*.ts",
    ]);
    expect(config._normalizedDiscovery.workflow.source).toBe("legacy-discovery");

    const diag = config._configDiagnostics.find(d => d.path === "workflow.discovery");
    expect(diag).toBeDefined();
    expect(diag?.code).toBe("CONFIG_PATH_LEGACY_KEY_USED");
    expect(diag?.severity).toBe("warning");
    expect(diag?.fatalInStrictContext).toBe(false);
  });

  it("4. workflow.discovery.exclude is preserved when workflow.exclude is absent", async () => {
    const tempDir = createTempDir("workflow-exclude");
    writeConfig(tempDir, `
workflow:
  discovery:
    exclude:
      - "legacy-workflows/**/*.test.js"
`);

    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config._normalizedDiscovery.workflow.exclude).toEqual([
      "legacy-workflows/**/*.test.js",
    ]);
    expect(config._normalizedDiscovery.workflow.excludeSource).toBe("legacy-discovery");
  });

  it("5. Flat new keys override legacy keys for the same dimension", async () => {
    const tempDir = createTempDir("new-override-legacy");
    writeConfig(tempDir, `
sharedAgents:
  include:
    - "custom-agents/**/*.agent.ts"
  dir: "legacy-dir-agents"
tools:
  include:
    - "custom-tools/**/*.tool.ts"
  dir: "legacy-dir-tools"
workflow:
  include:
    - "new-workflows/**/*.workflow.ts"
  discovery:
    include:
      - "legacy-workflows/**/*.js"
`);

    const config = await loadConfig({ cwd: tempDir, cli: {} });
    
    // sharedAgents override
    expect(config._normalizedDiscovery.sharedAgents.include).toEqual(["custom-agents/**/*.agent.ts"]);
    expect(config._normalizedDiscovery.sharedAgents.source).toBe("new");
    const agentDiag = config._configDiagnostics.find(d => d.path === "sharedAgents.dir");
    expect(agentDiag).toBeDefined();
    expect(agentDiag?.code).toBe("CONFIG_PATH_NEW_OVERRIDES_LEGACY");

    // tools override
    expect(config._normalizedDiscovery.tools.include).toEqual(["custom-tools/**/*.tool.ts"]);
    expect(config._normalizedDiscovery.tools.source).toBe("new");
    const toolsDiag = config._configDiagnostics.find(d => d.path === "tools.dir");
    expect(toolsDiag).toBeDefined();
    expect(toolsDiag?.code).toBe("CONFIG_PATH_NEW_OVERRIDES_LEGACY");

    // workflow override
    expect(config._normalizedDiscovery.workflow.include).toEqual(["new-workflows/**/*.workflow.ts"]);
    expect(config._normalizedDiscovery.workflow.source).toBe("new");
    const workflowDiag = config._configDiagnostics.find(d => d.path === "workflow.discovery.include");
    expect(workflowDiag).toBeDefined();
    expect(workflowDiag?.code).toBe("CONFIG_PATH_NEW_OVERRIDES_LEGACY");
  });

  it("6. Flat workflow.exclude overrides nested workflow.discovery.exclude", async () => {
    const tempDir = createTempDir("exclude-override");
    writeConfig(tempDir, `
workflow:
  exclude:
    - "new-workflows/**/*.test.ts"
  discovery:
    exclude:
      - "legacy-workflows/**/*.test.js"
`);

    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config._normalizedDiscovery.workflow.exclude).toEqual([
      "new-workflows/**/*.test.ts",
    ]);
    expect(config._normalizedDiscovery.workflow.excludeSource).toBe("new");

    const excludeDiag = config._configDiagnostics.find(d => d.path === "workflow.discovery.exclude");
    expect(excludeDiag).toBeDefined();
    expect(excludeDiag?.code).toBe("CONFIG_PATH_NEW_OVERRIDES_LEGACY");
  });

  it("7. Legacy-key warnings do not cause strict config loading to throw", async () => {
    const tempDir = createTempDir("strict-loading");
    writeConfig(tempDir, `
sharedAgents:
  dir: custom-agents
tools:
  dir: custom-tools
workflow:
  discovery:
    include:
      - "legacy-workflows/**/*.js"
`);

    // Run context
    const configRun = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" });
    expect(configRun).toBeDefined();
    expect(configRun._configDiagnostics.some(d => d.code === "CONFIG_PATH_LEGACY_KEY_USED")).toBe(true);

    // Validate context
    const configValidate = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "validate" });
    expect(configValidate).toBeDefined();
    expect(configValidate._configDiagnostics.some(d => d.code === "CONFIG_PATH_LEGACY_KEY_USED")).toBe(true);
  });

  it("8. Existing legacy fixture configs load without CONFIG_VALIDATION_ERROR", async () => {
    const workspaceRoot = "/root/projects/cadecli";
    const fixtures = [
      "tests/fixtures/config/provider-adapters.config.yaml",
      "tests/fixtures/config/run-by-name.config.yaml",
      "tests/fixtures/config/bad-discovery.config.yaml",
      "tests/fixtures/config/loop-integration.config.yaml",
    ];

    for (const fixture of fixtures) {
      const configPath = join(workspaceRoot, fixture);
      const config = await loadConfig({
        cwd: workspaceRoot,
        configPath,
        cli: {},
        diagnosticContext: "list", // non-strict context so match warnings don't cause noise
      });
      expect(config).toBeDefined();
      expect(config.defaultProvider).toBe("mock");
    }
  });
});
