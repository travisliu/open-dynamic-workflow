import { describe, expect, it, vi } from "vitest";

// Mock the provider-alias error codes in ErrorCode
vi.mock("../../../src/errors/codes.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../src/errors/codes.js")>();
  return {
    ...actual,
    ErrorCode: {
      ...actual.ErrorCode,
      PROVIDER_ALIAS_INVALID_DEFINITION: "PROVIDER_ALIAS_INVALID_DEFINITION",
      PROVIDER_ALIAS_DUPLICATE_DEFINITION: "PROVIDER_ALIAS_DUPLICATE_DEFINITION",
      PROVIDER_ALIAS_NAMESPACE_CONFLICT: "PROVIDER_ALIAS_NAMESPACE_CONFLICT",
      PROVIDER_ALIAS_PARENT_NOT_FOUND: "PROVIDER_ALIAS_PARENT_NOT_FOUND",
      PROVIDER_ALIAS_CYCLE_DETECTED: "PROVIDER_ALIAS_CYCLE_DETECTED",
      PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED: "PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED",
      PROVIDER_ALIAS_PROVIDER_REQUIRED: "PROVIDER_ALIAS_PROVIDER_REQUIRED",
      PROVIDER_ALIAS_PROVIDER_REPLACEMENT: "PROVIDER_ALIAS_PROVIDER_REPLACEMENT",
      PROVIDER_ALIAS_PROVIDER_NOT_FOUND: "PROVIDER_ALIAS_PROVIDER_NOT_FOUND",
    }
  };
});

// Mock resolver and built-in names
vi.mock("../../../src/config/provider-aliases.js", () => {
  return {
    resolveProviderAliases: vi.fn((input: any) => {
      const raw = input.rawAliases;
      if (!raw || Object.keys(raw).length === 0) {
        return { aliases: {} };
      }

      if (raw.aliasWithMissingParent) {
        const err = new Error("Parent not found");
        (err as any).code = "PROVIDER_ALIAS_PARENT_NOT_FOUND";
        throw err;
      }
      if (raw.aliasWithUnknownProvider) {
        const err = new Error("Provider not found");
        (err as any).code = "PROVIDER_ALIAS_PROVIDER_NOT_FOUND";
        throw err;
      }
      if (raw.aliasWithCycle) {
        const err = new Error("Cycle detected");
        (err as any).code = "PROVIDER_ALIAS_CYCLE_DETECTED";
        throw err;
      }
      if (raw.aliasWithMaxDepthExceeded) {
        const err = new Error("Max depth exceeded");
        (err as any).code = "PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED";
        throw err;
      }
      if (raw.aliasWithNamespaceConflict) {
        const err = new Error("Namespace conflict");
        (err as any).code = "PROVIDER_ALIAS_NAMESPACE_CONFLICT";
        throw err;
      }
      if (raw.aliasWithProviderReplacement) {
        const err = new Error("Provider replacement");
        (err as any).code = "PROVIDER_ALIAS_PROVIDER_REPLACEMENT";
        throw err;
      }
      if (raw.aliasWithProviderRequired) {
        const err = new Error("Provider required");
        (err as any).code = "PROVIDER_ALIAS_PROVIDER_REQUIRED";
        throw err;
      }
      if (raw.aliasWithInvalidDefinition) {
        const err = new Error("Invalid definition");
        (err as any).code = "PROVIDER_ALIAS_INVALID_DEFINITION";
        throw err;
      }

      // Default mock behavior
      const aliases: any = {};
      for (const [name, val] of Object.entries(raw)) {
        const aliasVal = val as any;
        aliases[name] = {
          name,
          inheritanceChain: aliasVal.extends ? [aliasVal.extends, name] : [name],
          provider: aliasVal.provider || "mock",
          digest: `sha256:${name}-digest`,
          origins: { provider: name },
          ...(aliasVal.model !== undefined ? { model: aliasVal.model } : {}),
          ...(aliasVal.thinkingEffort !== undefined ? { thinkingEffort: aliasVal.thinkingEffort } : {}),
          ...(aliasVal.timeoutMs !== undefined ? { timeoutMs: aliasVal.timeoutMs } : {}),
          ...(aliasVal.retry !== undefined ? { retry: aliasVal.retry } : {}),
        };
      }
      return { aliases };
    }),
    toResolvedProviderAliasArtifactRegistry: vi.fn((registry: any) => {
      const result: any = {};
      for (const [key, value] of Object.entries(registry)) {
        const { origins, ...rest } = value as any;
        result[key] = rest;
      }
      return result;
    })
  };
});

vi.mock("../../../src/agents/provider-names.js", () => {
  return {
    BUILT_IN_PROVIDER_NAMES: ["mock", "codex", "gemini", "copilot", "opencode", "antigravity", "pi", "cursor"]
  };
});

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

  it("rejects invalid retry config before merge resolution in loadConfig", async () => {
    // Arrange
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-retry-load-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.yaml");

    const cases = [
      {
        label: "invalid retry.maxAttempts",
        content: "retry:\n  maxAttempts: abc\n",
        message: "Config value 'retry.maxAttempts' must be a positive integer."
      },
      {
        label: "invalid retry.delayMs",
        content: "retry:\n  delayMs: -1\n",
        message: "Config value 'retry.delayMs' must be a non-negative integer."
      },
      {
        label: "invalid retry.maxDelayMs",
        content: "retry:\n  maxDelayMs: -1\n",
        message: "Config value 'retry.maxDelayMs' must be a non-negative integer."
      },
      {
        label: "invalid retry.backoff",
        content: "retry:\n  backoff: linear\n",
        message: "Config value 'retry.backoff' must be 'fixed' or 'exponential'."
      },
      {
        label: "banned retryOn field",
        content: "retry:\n  retryOn:\n    - provider_error\n",
        message:
          "retryOn is not supported in experimental retry v1. Retry eligibility is runtime-defined; configure maxAttempts and delay behavior only."
      }
    ];

    // Act & Assert
    for (const testCase of cases) {
      writeFileSync(configPath, testCase.content);

      try {
        await loadConfig({ cwd: tempDir, configPath, cli: {} });
        throw new Error(`Expected ${testCase.label} to fail`);
      } catch (error: any) {
        expect(error).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(error.code).toBe(ErrorCode.CONFIG_VALIDATION_ERROR);
        expect(error.message).toBe(testCase.message);
      }
    }

    rmSync(tempDir, { recursive: true, force: true });
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

  it("loads config and carries resolved retry policy through", async () => {
    // Arrange
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-load-retry-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
retry:
  maxAttempts: 4
  delayMs: 250
`;
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    // Act - config only
    const configWithFile = await loadConfig({ cwd: tempDir, cli: {} });
    expect(configWithFile.retry).toBeDefined();
    expect(configWithFile.retry?.enabled).toBe(true);
    expect(configWithFile.retry?.policy.maxAttempts).toBe(4);
    expect(configWithFile.retry?.policy.delayMs).toBe(250);
    expect(configWithFile.retry?.source).toBe("config");

    // Act - with CLI overrides
    const configWithCli = await loadConfig({
      cwd: tempDir,
      cli: {
        retryMaxAttempts: 8,
        retryBackoff: "fixed"
      }
    });
    expect(configWithCli.retry?.enabled).toBe(true);
    expect(configWithCli.retry?.policy.maxAttempts).toBe(8);
    expect(configWithCli.retry?.policy.delayMs).toBe(250);
    expect(configWithCli.retry?.policy.backoff).toBe("fixed");
    expect(configWithCli.retry?.source).toBe("cli");

    // Clean up
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig provider alias: omitted aliases yield empty registry and max depth 8", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-alias-empty-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    
    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config.providerAliases).toEqual({});
    expect(config.providerAliasMaxDepth).toBe(8);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig provider alias: resolves aliases at load time without executing a workflow", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-alias-valid-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    
    const configContent = `
providerAliases:
  aliasA:
    provider: mock
    extends: parentAlias
    model: gpt-4
`;
    writeFileSync(join(configDir, "config.yaml"), configContent);

    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config.providerAliases).toBeDefined();
    expect(config.providerAliases.aliasA).toBeDefined();
    expect(config.providerAliases.aliasA.name).toBe("aliasA");
    expect(config.providerAliases.aliasA.inheritanceChain).toEqual(["parentAlias", "aliasA"]);
    expect(config.providerAliases.aliasA.provider).toBe("mock");
    expect(config.providerAliases.aliasA.digest).toBe("sha256:aliasA-digest");
    expect(config.providerAliases.aliasA.model).toBe("gpt-4");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig provider alias: rejects loading if resolveProviderAliases throws an error", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-alias-failures-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });

    const cases = [
      {
        content: "providerAliases:\n  aliasWithMissingParent:\n    extends: missing-parent\n",
        code: "PROVIDER_ALIAS_PARENT_NOT_FOUND"
      },
      {
        content: "providerAliases:\n  aliasWithUnknownProvider:\n    provider: unknown\n",
        code: "PROVIDER_ALIAS_PROVIDER_NOT_FOUND"
      },
      {
        content: "providerAliases:\n  aliasWithCycle:\n    extends: aliasWithCycle\n",
        code: "PROVIDER_ALIAS_CYCLE_DETECTED"
      },
      {
        content: "providerAliases:\n  aliasWithMaxDepthExceeded:\n    extends: parent\n",
        code: "PROVIDER_ALIAS_MAX_DEPTH_EXCEEDED"
      },
      {
        content: "providerAliases:\n  aliasWithNamespaceConflict:\n    extends: parent\n",
        code: "PROVIDER_ALIAS_NAMESPACE_CONFLICT"
      },
      {
        content: "providerAliases:\n  aliasWithProviderReplacement:\n    extends: parent\n",
        code: "PROVIDER_ALIAS_PROVIDER_REPLACEMENT"
      },
      {
        content: "providerAliases:\n  aliasWithProviderRequired:\n    extends: parent\n",
        code: "PROVIDER_ALIAS_PROVIDER_REQUIRED"
      },
      {
        content: "providerAliases:\n  aliasWithInvalidDefinition:\n    extends: parent\n",
        code: "PROVIDER_ALIAS_INVALID_DEFINITION"
      }
    ];

    for (const testCase of cases) {
      writeFileSync(join(configDir, "config.yaml"), testCase.content);
      await expect(
        loadConfig({ cwd: tempDir, cli: {} })
      ).rejects.toThrow();
    }

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig provider alias: defaultProvider can be an alias name and loads successfully", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-alias-default-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });

    const configContent = `
defaultProvider: aliasA
providerAliases:
  aliasA:
    provider: mock
`;
    writeFileSync(join(configDir, "config.yaml"), configContent);

    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config.defaultProvider).toBe("aliasA");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig provider alias: defaultProvider can be an alias name via CLI override and loads successfully", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-alias-cli-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });

    const configContent = `
providerAliases:
  aliasA:
    provider: mock
`;
    writeFileSync(join(configDir, "config.yaml"), configContent);

    const config = await loadConfig({ cwd: tempDir, cli: { provider: "aliasA" } });
    expect(config.defaultProvider).toBe("aliasA");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig: unknown defaultProvider throws PROVIDER_REFERENCE_NOT_FOUND with requestedProvider details", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-alias-unknown-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });

    const configContent = `
defaultProvider: unknownAlias
`;
    writeFileSync(join(configDir, "config.yaml"), configContent);

    let error: any;
    try {
      await loadConfig({ cwd: tempDir, cli: {} });
    } catch (e: any) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe(ErrorCode.PROVIDER_REFERENCE_NOT_FOUND);
    expect(error.requestedProvider).toBe("unknownAlias");
    expect(error.details?.requestedProvider).toBe("unknownAlias");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig: default-config file malformed and duplicate keys are surfaced, not silently ignored", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-default-malformed-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });

    // case 1: malformed YAML
    writeFileSync(join(configDir, "config.yaml"), "providerAliases:\n  aliasA\n    provider: : : :");
    await expect(
      loadConfig({ cwd: tempDir, cli: {} })
    ).rejects.toThrow(/Invalid YAML in config file/);

    // case 2: duplicate key
    writeFileSync(join(configDir, "config.yaml"), "providerAliases:\n  aliasA:\n    provider: mock\n  aliasA:\n    provider: codex");
    await expect(
      loadConfig({ cwd: tempDir, cli: {} })
    ).rejects.toThrow(/Duplicate provider alias definition/);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig: missing default config is ignored, empty YAML normalized to {}", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-default-empty-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    
    // Genuinely missing config file
    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config.defaultProvider).toBe("mock");

    // Empty YAML document config file
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), "");
    const configEmpty = await loadConfig({ cwd: tempDir, cli: {} });
    expect(configEmpty.defaultProvider).toBe("mock");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig: preserves presence and exact absence of options in _executionDefaultLayers", async () => {
    const tempDir = join(tmpdir(), "open-dynamic-workflow-test-layers-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });

    // 1. Omitted case (no file config, no CLI options)
    const configOmitted = await loadConfig({ cwd: tempDir, cli: {} });
    expect(configOmitted._executionDefaultLayers).toBeDefined();
    expect(configOmitted._executionDefaultLayers.cli).toEqual({});
    expect(configOmitted._executionDefaultLayers.config).toEqual({});
    expect(configOmitted._executionDefaultLayers.builtIn).toEqual({
      defaultProvider: "mock",
      timeoutMs: 900000,
    });

    // 2. Explicit null/false and presence of various layers
    const configContent = `
defaultProvider: aliasA
defaultModel: null
timeoutMs: 5000
retry: false
providerAliases:
  aliasA:
    provider: mock
`;
    writeFileSync(join(configDir, "config.yaml"), configContent);

    const configPresent = await loadConfig({
      cwd: tempDir,
      cli: {
        provider: "aliasA",
        model: "cli-model",
        thinkingEffort: "high",
        retryMaxAttempts: 3,
        noRetry: false,
      }
    });

    expect(configPresent._executionDefaultLayers.cli).toEqual({
      provider: "aliasA",
      model: "cli-model",
      thinkingEffort: "high",
      retry: {
        maxAttempts: 3,
        noRetry: false,
      }
    });

    expect(configPresent._executionDefaultLayers.config).toEqual({
      defaultProvider: "aliasA",
      defaultModel: null,
      timeoutMs: 5000,
      retry: false,
    });

    expect(configPresent._executionDefaultLayers.builtIn).toEqual({
      defaultProvider: "mock",
      timeoutMs: 900000,
    });

    rmSync(tempDir, { recursive: true, force: true });
  });
});
