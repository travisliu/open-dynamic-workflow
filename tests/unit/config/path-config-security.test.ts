import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

describe("Path Config Security - Unit Tests", () => {
  let tempDir: string;
  let outsideDir: string;

  beforeAll(() => {
    tempDir = resolve(tmpdir(), "odw-path-sec-unit-" + Date.now());
    mkdirSync(tempDir, { recursive: true });

    outsideDir = resolve(tmpdir(), "odw-path-sec-unit-outside-" + Date.now());
    mkdirSync(outsideDir, { recursive: true });

    // Create default config file skeleton
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  function writeConfig(content: string) {
    const configPath = join(tempDir, ".open-dynamic-workflow", "config.yaml");
    writeFileSync(configPath, content);
  }

  it("1. Relative ../ escapes are rejected for every resource and are fatal in strict context", async () => {
    writeConfig(`
workflow:
  include:
    - "../outside/**/*.workflow.js"
sharedAgents:
  include:
    - "../outside/**/*.agent.js"
tools:
  include:
    - "../outside/**/*.tool.js"
`);

    // Non-strict load returns diagnostics
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    const outsideDiags = config._configDiagnostics.filter(
      (d) => d.code === "CONFIG_PATH_OUTSIDE_WORKSPACE"
    );
    expect(outsideDiags.length).toBe(3);
    for (const d of outsideDiags) {
      expect(d.fatalInStrictContext).toBe(true);
      expect(d.severity).toBe("error");
    }

    // Strict context (run) throws
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" })
    ).rejects.toThrow(/CONFIG_PATH_OUTSIDE_WORKSPACE/);

    // Strict context (validate) throws
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "validate" })
    ).rejects.toThrow(/CONFIG_PATH_OUTSIDE_WORKSPACE/);
  });

  it("2. Absolute config patterns are rejected as CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN", async () => {
    const insideAbs = join(tempDir, "workflows", "**", "*.workflow.js").replace(/\\/g, "/");
    const outsideAbs = join(outsideDir, "tools", "**", "*.tool.js").replace(/\\/g, "/");

    writeConfig(`
workflow:
  include:
    - "${insideAbs}"
tools:
  include:
    - "${outsideAbs}"
`);

    // Non-strict load returns diagnostics
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    const absDiags = config._configDiagnostics.filter(
      (d) => d.code === "CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN"
    );
    expect(absDiags.length).toBe(2);
    for (const d of absDiags) {
      expect(d.fatalInStrictContext).toBe(true);
      expect(d.severity).toBe("error");
    }

    // Strict context (run) throws
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" })
    ).rejects.toThrow(/CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN/);
  });

  it("3. CLI directory overrides reject absolute paths outside cwd", async () => {
    writeConfig(""); // Empty config, use defaults

    const outsidePath = join(outsideDir, "cli-tools").replace(/\\/g, "/");

    // Test for each resource type
    const resources: Array<"workflow" | "agent" | "tool"> = ["workflow", "agent", "tool"];

    for (const resourceType of resources) {
      const overrides = {
        resourceType,
        dir: outsidePath,
      };

      // Non-strict list
      const config = await loadConfig({
        cwd: tempDir,
        cli: {},
        diagnosticContext: "list",
        discoveryCliOverrides: overrides,
      });

      const outsideDiags = config._configDiagnostics.filter(
        (d) => d.code === "CONFIG_PATH_OUTSIDE_WORKSPACE"
      );
      expect(outsideDiags.length).toBeGreaterThanOrEqual(1);

      // Strict context throws
      await expect(
        loadConfig({
          cwd: tempDir,
          cli: {},
          diagnosticContext: "run",
          discoveryCliOverrides: overrides,
        })
      ).rejects.toThrow(/CONFIG_PATH_OUTSIDE_WORKSPACE/);
    }
  });

  it("4. CLI directory overrides normalize absolute paths inside cwd to relative", async () => {
    writeConfig("");

    const insidePath = join(tempDir, "custom-tools").replace(/\\/g, "/");
    const overrides = {
      resourceType: "tool" as const,
      dir: insidePath,
    };

    const config = await loadConfig({
      cwd: tempDir,
      cli: {},
      diagnosticContext: "list",
      discoveryCliOverrides: overrides,
    });

    // It should normalize custom-tools and contain CONFIG_PATH_CLI_OVERRIDE_USED as warning/non-fatal
    expect(config._normalizedDiscovery.tools.include).toContain("custom-tools/**/*.js");
    const overrideDiags = config._configDiagnostics.filter(
      (d) => d.code === "CONFIG_PATH_CLI_OVERRIDE_USED"
    );
    expect(overrideDiags.length).toBeGreaterThanOrEqual(1);
    expect(overrideDiags[0].fatalInStrictContext).toBe(false);
    expect(overrideDiags[0].severity).toBe("warning");

    // Strict run context should not throw because it is warning/non-fatal
    const strictConfig = await loadConfig({
      cwd: tempDir,
      cli: {},
      diagnosticContext: "run",
      discoveryCliOverrides: overrides,
    });
    expect(strictConfig._normalizedDiscovery.tools.include).toContain("custom-tools/**/*.js");
  });

  it("5. Directory-only flat patterns are fatal in strict contexts", async () => {
    writeConfig(`
tools:
  include:
    - ".open-dynamic-workflow/tools"
`);

    // Non-strict load returns diagnostics
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    const dirOnlyDiags = config._configDiagnostics.filter(
      (d) => d.code === "CONFIG_PATH_DIRECTORY_ONLY"
    );
    expect(dirOnlyDiags.length).toBe(1);
    expect(dirOnlyDiags[0].fatalInStrictContext).toBe(true);

    // Strict context (run) throws
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" })
    ).rejects.toThrow(/CONFIG_PATH_DIRECTORY_ONLY/);

    // Strict context (validate) throws
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "validate" })
    ).rejects.toThrow(/CONFIG_PATH_DIRECTORY_ONLY/);
  });

  it("7. Directory-only flat exclude patterns are fatal in strict contexts", async () => {
    writeConfig(`
workflow:
  exclude:
    - "workflows"
sharedAgents:
  exclude:
    - ".open-dynamic-workflow/agents"
tools:
  exclude:
    - ".open-dynamic-workflow/tools"
`);

    // Non-strict load returns diagnostics
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    const dirOnlyDiags = config._configDiagnostics.filter(
      (d) => d.code === "CONFIG_PATH_DIRECTORY_ONLY"
    );
    expect(dirOnlyDiags.length).toBe(3);
    for (const d of dirOnlyDiags) {
      expect(d.fatalInStrictContext).toBe(true);
      expect(d.severity).toBe("error");
    }

    // Strict context (run) throws
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" })
    ).rejects.toThrow(/CONFIG_PATH_DIRECTORY_ONLY/);

    // Strict context (validate) throws
    await expect(
      loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "validate" })
    ).rejects.toThrow(/CONFIG_PATH_DIRECTORY_ONLY/);
  });

  it("6. Unsupported glob syntax remains warning-only", async () => {
    writeConfig(`
workflow:
  include:
    - "workflows/**/!foo.js"
`);

    // Non-strict load returns diagnostics
    const config = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "list" });
    const braceDiags = config._configDiagnostics.filter(
      (d) => d.code === "CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX"
    );
    expect(braceDiags.length).toBe(1);
    expect(braceDiags[0].fatalInStrictContext).toBe(false);
    expect(braceDiags[0].severity).toBe("warning");

    // Strict context (run) should NOT throw
    const strictConfig = await loadConfig({ cwd: tempDir, cli: {}, diagnosticContext: "run" });
    expect(strictConfig._normalizedDiscovery.workflow.include).toContain(
      "workflows/**/!foo.js"
    );
  });
});
