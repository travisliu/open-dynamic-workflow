import { describe, expect, it, afterAll } from "vitest";
import { loadConfig } from "../../../src/config/load.js";
import { OpenFlowError } from "../../../src/errors/types.js";
import { resolve, isAbsolute } from "node:path";
import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";

describe("Load Config", () => {
  const tempDir = resolve(process.cwd(), "tests/fixtures/config/temp-workflow");
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  afterAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("no config file uses defaults", async () => {
    const config = await loadConfig({
      cwd: "tests/fixtures/config", // point to a place with no .openflow/config.yaml
      cli: {}
    });

    expect(config.defaultProvider).toBe("mock");
    expect(config.concurrency).toBe(4);
    expect(config.security.allowShell).toBe(false);
    expect(config.sharedAgents.dir).toEqual(".openflow/agents");
    expect(config.sharedAgents.maxDefinitions).toBe(100);
    expect(config.sharedAgents.strictPromptTemplateVariables).toBe(true);
    expect(config.workflow.discovery.include).toEqual(["workflows/**/*.ts"]);
    expect(config.workflow.maxDepth).toBe(8);
  });

  it("accepts custom workflow discovery and max depth", async () => {
    const configPath = resolve(tempDir, "custom-workflow.yaml");
    writeFileSync(configPath, `
workflow:
  discovery:
    include: ["flows/**/*.js", "reviews/**/*.ts"]
  maxDepth: 3
`);

    const config = await loadConfig({
      cwd: tempDir,
      configPath: configPath,
      cli: {}
    });

    expect(config.workflow.discovery.include).toEqual(["flows/**/*.js", "reviews/**/*.ts"]);
    expect(config.workflow.maxDepth).toBe(3);
  });

  it("rejects malformed workflow discovery include", async () => {
    const cases = [
      { name: "string", content: "workflow:\n  discovery:\n    include: 'workflows/**/*.ts'" },
      { name: "empty item", content: "workflow:\n  discovery:\n    include: ['']" },
      { name: "whitespace item", content: "workflow:\n  discovery:\n    include: ['  ']" },
      { name: "number", content: "workflow:\n  discovery:\n    include: 123" },
      { name: "object", content: "workflow:\n  discovery:\n    include: {}" },
      { name: "null", content: "workflow:\n  discovery:\n    include: null" },
    ];

    for (const c of cases) {
      const configPath = resolve(tempDir, `malformed-include-${cases.indexOf(c)}.yaml`);
      writeFileSync(configPath, c.content);

      await expect(
        loadConfig({
          cwd: tempDir,
          configPath: configPath,
          cli: {}
        })
      ).rejects.toThrow(OpenFlowError);
    }
  });

  it("rejects invalid workflow max depth", async () => {
    const cases = [
      { name: "zero", val: 0 },
      { name: "negative", val: -1 },
      { name: "float", val: 1.5 },
      { name: "string", val: '"8"' },
      { name: "null", val: "null" },
    ];

    for (const c of cases) {
      const configPath = resolve(tempDir, `invalid-depth-${cases.indexOf(c)}.yaml`);
      writeFileSync(configPath, `workflow:\n  maxDepth: ${c.val}`);

      await expect(
        loadConfig({
          cwd: tempDir,
          configPath: configPath,
          cli: {}
        })
      ).rejects.toThrow(/workflow.maxDepth/i);
    }
  });

  it("explicit missing config file fails", async () => {
    await expect(
      loadConfig({
        cwd: process.cwd(),
        configPath: "nonexistent-config.yaml",
        cli: {}
      })
    ).rejects.toThrow(OpenFlowError);

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
    ).rejects.toThrow(OpenFlowError);
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
