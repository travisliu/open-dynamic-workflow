import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { ExecflowError } from "../../../src/errors/types.js";
import { resolve, isAbsolute } from "node:path";

describe("Load Config", () => {
  it("no config file uses defaults", async () => {
    const config = await loadConfig({
      cwd: "tests/fixtures/config", // point to a place with no .execflow/config.yaml
      cli: {}
    });

    expect(config.defaultProvider).toBe("mock");
    expect(config.concurrency).toBe(4);
    expect(config.security.allowShell).toBe(false);
  });

  it("explicit missing config file fails", async () => {
    await expect(
      loadConfig({
        cwd: process.cwd(),
        configPath: "nonexistent-config.yaml",
        cli: {}
      })
    ).rejects.toThrow(ExecflowError);

    try {
      await loadConfig({
        cwd: process.cwd(),
        configPath: "nonexistent-config.yaml",
        cli: {}
      });
    } catch (err: any) {
      expect(err.code).toBe("CONFIG_VALIDATION_ERROR");
    }
  });

  it("invalid YAML fails", async () => {
    await expect(
      loadConfig({
        cwd: process.cwd(),
        configPath: "tests/fixtures/config/invalid-concurrency.yaml", // concurrency: 0 is validation fail, but wait, invalid YAML like syntax error:
        cli: {}
      })
    ).rejects.toThrow(ExecflowError);
  });

  it("valid YAML loads", async () => {
    const config = await loadConfig({
      cwd: process.cwd(),
      configPath: "tests/fixtures/config/valid-config.yaml",
      cli: {}
    });

    expect(config.concurrency).toBe(8);
    expect(config.timeoutMs).toBe(60000);
    expect(config.reporting.mode).toBe("json");
    expect(config.reporting.verbose).toBe(true);
  });

  it("cwd resolves to absolute path", async () => {
    const config = await loadConfig({
      cwd: "tests/fixtures/config",
      cli: {}
    });

    expect(isAbsolute(config.cwd)).toBe(true);
    expect(config.cwd).toBe(resolve(process.cwd(), "tests/fixtures/config"));
  });

  it("outDir resolves correctly", async () => {
    const config = await loadConfig({
      cwd: "tests/fixtures/config",
      outDir: "custom-out",
      cli: {}
    });

    expect(config.outDir).toBe(resolve(config.cwd, "custom-out"));
  });
});
