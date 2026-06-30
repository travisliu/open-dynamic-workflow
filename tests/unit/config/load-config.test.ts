import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";


describe("Load Config", () => {
  it("56. no-config defaults include all new providers without changing default provider", async () => {
    // Arrange
    const emptyDir = join(tmpdir(), "open-dynamic-workflow-test-empty-" + Date.now());
    mkdirSync(emptyDir, { recursive: true });

    // Act
    const config = await loadConfig({ cwd: emptyDir, cli: {} });

    // Assert
    expect(config.defaultProvider).toBe("mock");
    expect(config.providers.copilot.command).toBe("copilot");
    expect(config.providers.opencode.command).toBe("opencode");
    expect(config.providers.antigravity.command).toBe("agy");
    expect(config.providers.pi.command).toBe("pi");

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("57. YAML overrides provider-specific fields and keeps unspecified defaults", async () => {
    // Arrange
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-yaml-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
providers:
  copilot:
    permissionPolicy: passthrough
  opencode:
    permissionPolicy: passthrough
  antigravity:
    promptFlag: --prompt
  pi:
    safeTools: [read, grep]
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.yaml");
    writeFileSync(configPath, configContent);

    // Act
    const config = await loadConfig({ cwd: tempDir, cli: {} });

    // Assert
    expect(config.providers.copilot.permissionPolicy).toBe("passthrough");
    expect(config.providers.opencode.permissionPolicy).toBe("passthrough");
    expect(config.providers.antigravity.promptFlag).toBe("--prompt");
    expect(config.providers.pi.safeTools).toEqual(["read", "grep"]);
    
    // Check preserved defaults
    expect(config.providers.pi.noSession).toBe(true);
    expect(config.providers.antigravity.useSandboxByDefault).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("AAV2-T005: executionMode: print should not be overridden by default args", async () => {
    // Arrange
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-aav2-t005-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
providers:
  pi:
    executionMode: print
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    // Act
    const config = await loadConfig({ cwd: tempDir, cli: {} });

    // Assert
    expect(config.providers.pi.executionMode).toBe("print");
    expect(config.providers.pi.args).toBeUndefined();

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("36. Copilot can be configured as default provider explicitly", async () => {
    // Arrange
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-default-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = "defaultProvider: copilot";
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    // Act
    const config = await loadConfig({ cwd: tempDir, cli: {} });

    // Assert
    expect(config.defaultProvider).toBe("copilot");
    expect(config.providers.copilot.command).toBe("copilot");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("37. security defaults do not pass Copilot tokens automatically", async () => {
    // Arrange
    const emptyDir = join(tmpdir(), "open-dynamic-workflow-test-security-" + Date.now());
    mkdirSync(emptyDir, { recursive: true });

    // Act
    const config = await loadConfig({ cwd: emptyDir, cli: {} });

    // Assert
    expect(config.security.passEnv).not.toContain("COPILOT_GITHUB_TOKEN");
    expect(config.security.passEnv).not.toContain("GH_TOKEN");
    expect(config.security.passEnv).not.toContain("GITHUB_TOKEN");

    rmSync(emptyDir, { recursive: true, force: true });
  });

  // Keep some core existing tests to ensure no regressions
  it("loads config from .open-dynamic-workflow/config.yaml", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-base-" + Date.now());
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), "defaultProvider: codex");
    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config.defaultProvider).toBe("codex");
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returned config includes _normalizedDiscovery and _configDiagnostics", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-d1-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    expect(config._normalizedDiscovery).toBeDefined();
    expect(config._configDiagnostics).toBeDefined();
    expect(config._normalizedDiscovery.workflow.source).toBe("default");
    
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("new flat config yields normalized include/exclude", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-d2-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
workflow:
  include:
    - workflows/**/*.workflow.js
  exclude:
    - workflows/**/*.test.js
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    expect(config._normalizedDiscovery.workflow.include).toEqual(["workflows/**/*.workflow.js"]);
    expect(config._normalizedDiscovery.workflow.exclude).toEqual(["workflows/**/*.test.js"]);
    expect(config._normalizedDiscovery.workflow.source).toBe("new");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("legacy config yields normalized discovery plus migration diagnostics", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-d3-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
sharedAgents:
  dir: custom-agents
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    expect(config._normalizedDiscovery.sharedAgents.include).toContain("custom-agents/**/*.js");
    expect(config._normalizedDiscovery.sharedAgents.source).toBe("legacy-dir");
    expect(config._configDiagnostics.some(d => d.code === "CONFIG_PATH_LEGACY_KEY_USED")).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("non-strict load allows fatal-in-strict diagnostics to be returned, while strict throws", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-d4-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
workflow:
  include:
    - ../outside/**/*.workflow.js
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    // Non-strict load does not throw, returns diagnostic
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    expect(config._configDiagnostics.some(d => d.code === "CONFIG_PATH_OUTSIDE_WORKSPACE")).toBe(true);

    // Non-strict run/validate contexts do not throw
    const runConfig = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" });
    expect(runConfig._configDiagnostics.some(d => d.code === "CONFIG_PATH_OUTSIDE_WORKSPACE")).toBe(true);
    const validateConfig = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "validate" });
    expect(validateConfig._configDiagnostics.some(d => d.code === "CONFIG_PATH_OUTSIDE_WORKSPACE")).toBe(true);

    // Strict run context throws CONFIG_VALIDATION_ERROR
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run-strict" })
    ).rejects.toThrow(/Invalid path configuration/);

    // Strict validate context throws CONFIG_VALIDATION_ERROR
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "validate-strict" })
    ).rejects.toThrow(/Invalid path configuration/);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("strict context does not throw for warning-only diagnostics", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-d5-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
workflow:
  include:
    - workflows/!foo.js
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    // Warnings like negated patterns are non-fatal and should load without throwing
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run-strict" });
    expect(config._configDiagnostics.some(d => d.code === "CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX")).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("discoveryCliOverrides normalize and do not mutate unrelated resource includes", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-d6-" + Date.now());
    mkdirSync(tempDir, { recursive: true });

    const config = await loadConfig({
      cwd: tempDir,
      cli: {},
      diagnosticContext: "list",
      discoveryCliOverrides: {
        resourceType: "tool",
        dir: "cli-tools-override"
      }
    });

    // tools includes should be replaced by override
    expect(config._normalizedDiscovery.tools.include).toContain("cli-tools-override/**/*.js");
    expect(config._normalizedDiscovery.tools.source).toBe("cli-override");

    // workflow includes should remain default
    expect(config._normalizedDiscovery.workflow.include).toContain("workflows/**/*.js");
    expect(config._normalizedDiscovery.workflow.source).toBe("default");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Verify Phase 1 integration with out-of-cwd path pattern and legacy key warning", async () => {
    // Arrange
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-acceptance-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    
    // Create a mock configuration file with:
    // - an invalid out-of-cwd path pattern under workflow.include
    // - a legacy key warning (tools.dir: 'legacy-tools')
    const configContent = `
workflow:
  include:
    - ../outside/**/*.workflow.js
tools:
  dir: legacy-tools
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    // Act
    // Call loadConfig() with diagnosticContext set to 'list' (non-strict)
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });

    // Assert non-strict case
    expect(config).toBeDefined();
    expect(config._normalizedDiscovery).toBeDefined();
    expect(config._configDiagnostics).toBeDefined();
    
    const codes = config._configDiagnostics.map(d => d.code);
    expect(codes).toContain("CONFIG_PATH_OUTSIDE_WORKSPACE");
    expect(codes).toContain("CONFIG_PATH_LEGACY_KEY_USED");

    // Act & Assert non-strict run case does not throw
    const nonStrictRunConfig = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" });
    expect(nonStrictRunConfig).toBeDefined();

    // Act & Assert strict case
    let thrownError: any = null;
    try {
      await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run-strict" });
    } catch (err: any) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(OpenDynamicWorkflowError);
    expect(thrownError.code).toBe(ErrorCode.CONFIG_VALIDATION_ERROR);
    expect(thrownError.message).toContain("CONFIG_PATH_OUTSIDE_WORKSPACE");

    // Now test that it does not throw for the legacy key warning alone
    // Arrange (warning-only config)
    const warningOnlyConfigContent = `
tools:
  dir: legacy-tools
`;
    writeFileSync(join(configDir, "config.yaml"), warningOnlyConfigContent);

    // Act & Assert (should not throw for warning alone in strict context)
    const warningOnlyConfig = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run-strict" });
    expect(warningOnlyConfig).toBeDefined();
    expect(warningOnlyConfig._configDiagnostics.map(d => d.code)).toContain("CONFIG_PATH_LEGACY_KEY_USED");

    // Clean up
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig returns diagnostic for malformed workflow.discovery in non-strict context, and throws in strict context", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-malformed-discovery-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    
    const configContent = `
workflow:
  discovery: "malformed-string"
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    // Non-strict load does not throw, returns diagnostic
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    expect(config._configDiagnostics.some(d => d.code === "CONFIG_PATH_INVALID_TYPE")).toBe(true);

    // Non-strict run context does not throw
    const runConfig = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" });
    expect(runConfig._configDiagnostics.some(d => d.code === "CONFIG_PATH_INVALID_TYPE")).toBe(true);

    // Strict run context throws CONFIG_VALIDATION_ERROR
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run-strict" })
    ).rejects.toThrow(/Invalid path configuration/);

    rmSync(tempDir, { recursive: true, force: true });
  });
});

