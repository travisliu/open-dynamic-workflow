import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Load Config", () => {
  it("56. no-config defaults include all new providers without changing default provider", async () => {
    // Arrange
    const emptyDir = join(tmpdir(), "openflow-test-empty-" + Date.now());
    mkdirSync(emptyDir, { recursive: true });

    // Act
    const config = await loadConfig({ cwd: emptyDir, cli: {} });

    // Assert
    expect(config.defaultProvider).toBe("mock");
    expect(config.providers.opencode.command).toBe("opencode");
    expect(config.providers.antigravity.command).toBe("agy");
    expect(config.providers.pi.command).toBe("pi");

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("57. YAML overrides provider-specific fields and keeps unspecified defaults", async () => {
    // Arrange
    const tempDir = join(tmpdir(), "openflow-test-yaml-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
providers:
  opencode:
    permissionPolicy: passthrough
  antigravity:
    promptFlag: --prompt
  pi:
    safeTools: [read, grep]
`;
    const configDir = join(tempDir, ".openflow");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.yaml");
    writeFileSync(configPath, configContent);

    // Act
    const config = await loadConfig({ cwd: tempDir, cli: {} });

    // Assert
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
    const tempDir = join(tmpdir(), "openflow-test-aav2-t005-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configContent = `
providers:
  pi:
    executionMode: print
`;
    const configDir = join(tempDir, ".openflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), configContent);

    // Act
    const config = await loadConfig({ cwd: tempDir, cli: {} });

    // Assert
    expect(config.providers.pi.executionMode).toBe("print");
    expect(config.providers.pi.args).toBeUndefined();

    rmSync(tempDir, { recursive: true, force: true });
  });

  // Keep some core existing tests to ensure no regressions
  it("loads config from .openflow/config.yaml", async () => {
    const tempDir = join(tmpdir(), "openflow-test-base-" + Date.now());
    const configDir = join(tempDir, ".openflow");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), "defaultProvider: codex");
    const config = await loadConfig({ cwd: tempDir, cli: {} });
    expect(config.defaultProvider).toBe("codex");
    rmSync(tempDir, { recursive: true, force: true });
  });
});
