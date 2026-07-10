import { describe, expect, it, vi } from "vitest";
import { parseConfigYaml } from "../../../src/config/yaml.js";
import { loadConfig } from "../../../src/config/load.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
      return { aliases: {} };
    }),
    toResolvedProviderAliasArtifactRegistry: vi.fn((registry: any) => {
      return registry;
    })
  };
});

vi.mock("../../../src/agents/provider-names.js", () => {
  return {
    BUILT_IN_PROVIDER_NAMES: ["mock", "codex", "gemini", "copilot", "opencode", "antigravity", "pi", "cursor"]
  };
});

describe("YAML Duplicate Keys", () => {
  it("1. parseConfigYaml directly detects duplicate providerAliases key and throws PROVIDER_ALIAS_DUPLICATE_DEFINITION", () => {
    const yaml = `
providerAliases:
  aliasA:
    provider: mock
  aliasA:
    provider: codex
`;
    try {
      parseConfigYaml(yaml, "config.yaml");
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
      expect(err.code).toBe("PROVIDER_ALIAS_DUPLICATE_DEFINITION");
      expect(err.message).toContain("Duplicate provider alias definition 'aliasA'");
      expect(err.message).toContain("line 5"); // aliasA is on line 5
      expect(err.message).toContain("column 3");
      expect(err.alias).toBe("aliasA");
      expect(err.path).toBe("providerAliases.aliasA");
      expect(err.sourcePath).toBe("config.yaml");
    }
  });

  it("2. loadConfig detects duplicate alias before merging and throws PROVIDER_ALIAS_DUPLICATE_DEFINITION", async () => {
    const tempDir = join(tmpdir(), "odw-test-yaml-dup-load-" + Date.now());
    mkdirSync(tempDir, { recursive: true });
    const configDir = join(tempDir, ".open-dynamic-workflow");
    mkdirSync(configDir, { recursive: true });

    const content = `
providerAliases:
  aliasA:
    provider: mock
  aliasA:
    provider: codex
`;
    writeFileSync(join(configDir, "config.yaml"), content);

    try {
      await loadConfig({ cwd: tempDir, cli: {} });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("PROVIDER_ALIAS_DUPLICATE_DEFINITION");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("3. non-alias duplicates and repeated fields inside one alias throw CONFIG_VALIDATION_ERROR", () => {
    // case a: duplicate providers
    const yamlProviders = `
providers:
  mock:
    defaultModel: foo
  mock:
    defaultModel: bar
`;
    try {
      parseConfigYaml(yamlProviders, "config.yaml");
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("CONFIG_VALIDATION_ERROR");
      expect(err.message).toContain("Map keys must be unique");
    }

    // case b: duplicate fields inside one alias
    const yamlFields = `
providerAliases:
  aliasA:
    provider: mock
    provider: codex
`;
    try {
      parseConfigYaml(yamlFields, "config.yaml");
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("CONFIG_VALIDATION_ERROR");
      expect(err.message).toContain("Map keys must be unique");
    }
  });

  it("4. malformed YAML throws CONFIG_VALIDATION_ERROR", () => {
    const yaml = `
providerAliases:
  aliasA
    provider: : : :
`;
    try {
      parseConfigYaml(yaml, "config.yaml");
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("CONFIG_VALIDATION_ERROR");
    }
  });
});
