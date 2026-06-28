import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { mergeConfig } from "../../../src/config/merge.js";
import { validateConfig } from "../../../src/config/schema.js";

describe("Tools Config", () => {
  it("should have default tools configuration", () => {
    expect(DEFAULT_CONFIG.tools).toBeDefined();
    expect(DEFAULT_CONFIG.tools.dir).toBe(".open-dynamic-workflow/tools");
    expect(DEFAULT_CONFIG.tools.concurrency).toBe(4);
    expect(DEFAULT_CONFIG.tools.maxDefinitions).toBe(100);
  });

  it("should deep merge tools configuration", () => {
    const fileConfig = {
      tools: {
        concurrency: 8
      }
    };
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig as any, {});
    expect(merged.tools.concurrency).toBe(8);
    expect(merged.tools.dir).toBe(".open-dynamic-workflow/tools"); // preserved default
    expect(merged.tools.maxDefinitions).toBe(100); // preserved default
  });

  it("should validate tools configuration (Case 20)", () => {
    const config = {
      ...DEFAULT_CONFIG,
      tools: {
        dir: "",
        concurrency: 0,
        maxDefinitions: -1
      }
    };
    // Should NOT throw for empty dir, but should throw for invalid concurrency
    expect(() => validateConfig(config as any)).toThrow(/Config value 'tools.concurrency' must be a positive integer/);

    config.tools.concurrency = 4;
    expect(() => validateConfig(config as any)).toThrow(/Config value 'tools.maxDefinitions' must be a positive integer/);
  });

  it("should keep tool concurrency independent from agent concurrency (Case 21)", () => {
    const fileConfig = {
      concurrency: 1,
      tools: {
        concurrency: 10
      }
    };
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig as any, {});
    expect(merged.concurrency).toBe(1);
    expect(merged.tools.concurrency).toBe(10);
  });
  it("should allow old config lacking tools block (Issue 5)", () => {
    const configWithoutTools: any = { ...DEFAULT_CONFIG };
    delete configWithoutTools.tools;

    expect(() => validateConfig(configWithoutTools)).not.toThrow();
  });

  it("should fail validation for invalid tools config (Issue 5)", () => {
    const baseConfig = { ...DEFAULT_CONFIG };

    expect(() => validateConfig({ ...baseConfig, tools: null } as any)).toThrow();
    // { dir: "", concurrency: 4, maxDefinitions: 100 } should NOT throw anymore in Phase 1
    expect(() => validateConfig({ ...baseConfig, tools: { dir: ".open-dynamic-workflow/tools", concurrency: 0, maxDefinitions: 100 } } as any)).toThrow();
    expect(() => validateConfig({ ...baseConfig, tools: { dir: ".open-dynamic-workflow/tools", concurrency: 4, maxDefinitions: 0 } } as any)).toThrow();
  });

  it("should reject unknown keys in tools configuration (WORKSTREAM-002)", () => {
    const config = {
      ...DEFAULT_CONFIG,
      tools: {
        ...DEFAULT_CONFIG.tools,
        unexpected: true
      }
    };
    expect(() => validateConfig(config as any)).toThrow(/Config value 'tools.unexpected' is not a supported key/);
  });
});
