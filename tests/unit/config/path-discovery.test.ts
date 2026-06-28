import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import {
  normalizeDiscoveryConfig,
  normalizeResourceDiscovery,
} from "../../../src/config/path-discovery.js";

describe("Path Discovery Normalization", () => {
  const cwd = "/workspace";

  it("defaults produce runtime-extension includes and default excludes for all resources without warnings", () => {
    const { discovery, diagnostics } = normalizeDiscoveryConfig({
      config: DEFAULT_CONFIG,
      cwd,
      rawConfig: {}, // No user-authored keys
    });

    expect(diagnostics).toEqual([]);

    expect(discovery.workflow.include).toEqual([
      "workflows/**/*.workflow.js",
      "workflows/**/*.workflow.ts",
      "workflows/**/*.workflow.mjs",
      "workflows/**/*.workflow.cjs",
    ]);
    expect(discovery.workflow.exclude).toEqual(["**/*.test.*", "**/*.spec.*"]);
    expect(discovery.workflow.source).toBe("default");

    expect(discovery.sharedAgents.include).toEqual([
      ".open-dynamic-workflow/agents/**/*.js",
      ".open-dynamic-workflow/agents/**/*.ts",
      ".open-dynamic-workflow/agents/**/*.mjs",
      ".open-dynamic-workflow/agents/**/*.cjs",
    ]);
    expect(discovery.sharedAgents.exclude).toEqual(["**/*.test.*", "**/*.spec.*"]);
    expect(discovery.sharedAgents.source).toBe("default");

    expect(discovery.tools.include).toEqual([
      ".open-dynamic-workflow/tools/**/*.js",
      ".open-dynamic-workflow/tools/**/*.ts",
      ".open-dynamic-workflow/tools/**/*.mjs",
      ".open-dynamic-workflow/tools/**/*.cjs",
    ]);
    expect(discovery.tools.exclude).toEqual(["**/*.test.*", "**/*.spec.*"]);
    expect(discovery.tools.source).toBe("default");
  });

  it("flat include/exclude wins over legacy keys, producing CONFIG_PATH_NEW_OVERRIDES_LEGACY", () => {
    const config = {
      ...DEFAULT_CONFIG,
      sharedAgents: {
        ...DEFAULT_CONFIG.sharedAgents,
        include: ["custom-agents/**/*.agent.js"],
        dir: "legacy-dir-agents",
      },
    };
    const rawConfig = {
      sharedAgents: {
        include: ["custom-agents/**/*.agent.js"],
        dir: "legacy-dir-agents",
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "sharedAgents",
      config,
      cwd,
      rawConfig,
    });

    expect(res.include).toEqual(["custom-agents/**/*.agent.js"]);
    expect(res.source).toBe("new");
    expect(res.diagnostics.length).toBe(1);
    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_NEW_OVERRIDES_LEGACY");
    expect(res.diagnostics[0].fatalInStrictContext).toBe(false);
  });

  it("legacy sharedAgents.dir expands to generic extensions", () => {
    const config = {
      ...DEFAULT_CONFIG,
      sharedAgents: {
        ...DEFAULT_CONFIG.sharedAgents,
        dir: "custom-agents",
      },
    };
    const rawConfig = {
      sharedAgents: {
        dir: "custom-agents",
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "sharedAgents",
      config,
      cwd,
      rawConfig,
    });

    expect(res.include).toEqual([
      "custom-agents/**/*.js",
      "custom-agents/**/*.ts",
      "custom-agents/**/*.mjs",
      "custom-agents/**/*.cjs",
    ]);
    expect(res.source).toBe("legacy-dir");
    expect(res.diagnostics.length).toBe(1);
    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_LEGACY_KEY_USED");
  });

  it("legacy tools.dir expands to generic extensions", () => {
    const config = {
      ...DEFAULT_CONFIG,
      tools: {
        ...DEFAULT_CONFIG.tools,
        dir: "custom-tools",
      },
    };
    const rawConfig = {
      tools: {
        dir: "custom-tools",
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "tools",
      config,
      cwd,
      rawConfig,
    });

    expect(res.include).toEqual([
      "custom-tools/**/*.js",
      "custom-tools/**/*.ts",
      "custom-tools/**/*.mjs",
      "custom-tools/**/*.cjs",
    ]);
    expect(res.source).toBe("legacy-dir");
  });

  it("legacy workflow.discovery.include and exclude are preserved", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        discovery: {
          include: ["legacy-workflows/*.ts"],
          exclude: ["legacy-workflows/*.test.ts"],
        },
      },
    };
    const rawConfig = {
      workflow: {
        discovery: {
          include: ["legacy-workflows/*.ts"],
          exclude: ["legacy-workflows/*.test.ts"],
        },
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.include).toEqual(["legacy-workflows/*.ts"]);
    expect(res.exclude).toEqual(["legacy-workflows/*.test.ts"]);
    expect(res.source).toBe("legacy-discovery");
    expect(res.diagnostics.length).toBe(1);
    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_LEGACY_KEY_USED");
  });

  it("CLI override replaces include only and preserves configured exclude, emitting CONFIG_PATH_CLI_OVERRIDE_USED", () => {
    const config = {
      ...DEFAULT_CONFIG,
      tools: {
        ...DEFAULT_CONFIG.tools,
        exclude: ["custom-exclude/*.js"],
      },
    };
    const rawConfig = {
      tools: {
        exclude: ["custom-exclude/*.js"],
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "tools",
      config,
      cwd,
      cliOverrides: {
        resourceType: "tool",
        dir: "cli-tools-override",
      },
      rawConfig,
    });

    // cli override is toolsDir or dir
    expect(res.include).toEqual([
      "cli-tools-override/**/*.js",
      "cli-tools-override/**/*.ts",
      "cli-tools-override/**/*.mjs",
      "cli-tools-override/**/*.cjs",
    ]);
    expect(res.exclude).toEqual(["custom-exclude/*.js"]);
    expect(res.source).toBe("cli-override");
    expect(res.diagnostics.length).toBe(1);
    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_CLI_OVERRIDE_USED");
  });

  it("invalid include type produces CONFIG_PATH_INVALID_TYPE", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: 123 as any,
      },
    };
    const rawConfig = {
      workflow: {
        include: 123 as any,
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics.length).toBe(1);
    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_INVALID_TYPE");
    expect(res.diagnostics[0].fatalInStrictContext).toBe(true);
  });

  it("array entries with non-string values produce CONFIG_PATH_INVALID_TYPE", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["ok.js", null, 123] as any,
      },
    };
    const rawConfig = {
      workflow: {
        include: ["ok.js", null, 123] as any,
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics.some((d) => d.code === "CONFIG_PATH_INVALID_TYPE")).toBe(true);
  });

  it("empty patterns and directory-only patterns produce fatal diagnostics", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["", "workflows/"],
      },
    };
    const rawConfig = {
      workflow: {
        include: ["", "workflows/"],
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    const codes = res.diagnostics.map((d) => d.code);
    expect(codes).toContain("CONFIG_PATH_EMPTY_PATTERN");
    expect(codes).toContain("CONFIG_PATH_DIRECTORY_ONLY");
    expect(res.diagnostics.every((d) => d.fatalInStrictContext)).toBe(true);
  });

  it("absolute config patterns and outside workspace patterns produce fatal diagnostics", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["/absolute/workflows/*.js", "../outside-workflows/*.js"],
      },
    };
    const rawConfig = {
      workflow: {
        include: ["/absolute/workflows/*.js", "../outside-workflows/*.js"],
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    const codes = res.diagnostics.map((d) => d.code);
    expect(codes).toContain("CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN");
    expect(codes).toContain("CONFIG_PATH_OUTSIDE_WORKSPACE");
  });

  it("unsupported glob syntax produces CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX warning", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["workflows/*.{js,ts}"],
      },
    };
    const rawConfig = {
      workflow: {
        include: ["workflows/*.{js,ts}"],
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX");
    expect(res.diagnostics[0].fatalInStrictContext).toBe(false);
    expect(res.diagnostics[0].severity).toBe("warning");
  });

  it("unsupported literal suffix produces CONFIG_PATH_UNSUPPORTED_RESOURCE_SUFFIX", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["workflows/README.md"],
      },
    };
    const rawConfig = {
      workflow: {
        include: ["workflows/README.md"],
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_UNSUPPORTED_RESOURCE_SUFFIX");
    expect(res.diagnostics[0].fatalInStrictContext).toBe(true);
  });

  it("plain runtime-extension literal files are valid for shared agents and tools", () => {
    const agentConfig = {
      ...DEFAULT_CONFIG,
      sharedAgents: {
        ...DEFAULT_CONFIG.sharedAgents,
        include: ["agents/task-parser.js"],
      },
    };
    const agentRawConfig = {
      sharedAgents: {
        include: ["agents/task-parser.js"],
      },
    };

    const agentRes = normalizeResourceDiscovery({
      resource: "sharedAgents",
      config: agentConfig,
      cwd,
      rawConfig: agentRawConfig,
    });

    expect(agentRes.include).toEqual(["agents/task-parser.js"]);
    expect(agentRes.diagnostics).toEqual([]);

    const toolConfig = {
      ...DEFAULT_CONFIG,
      tools: {
        ...DEFAULT_CONFIG.tools,
        include: ["tools/deploy.ts"],
      },
    };
    const toolRawConfig = {
      tools: {
        include: ["tools/deploy.ts"],
      },
    };

    const toolRes = normalizeResourceDiscovery({
      resource: "tools",
      config: toolConfig,
      cwd,
      rawConfig: toolRawConfig,
    });

    expect(toolRes.include).toEqual(["tools/deploy.ts"]);
    expect(toolRes.diagnostics).toEqual([]);
  });

  it("suffix-wildcard patterns with the correct marker are accepted", () => {
    const config = {
      ...DEFAULT_CONFIG,
      sharedAgents: {
        ...DEFAULT_CONFIG.sharedAgents,
        include: ["**/*.agent.*"],
      },
    };
    const rawConfig = {
      sharedAgents: {
        include: ["**/*.agent.*"],
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "sharedAgents",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics).toEqual([]);
    expect(res.include).toEqual(["**/*.agent.*"]);
  });

  it("normalizeResourceDiscovery with rawConfig workflow.discovery not an object returns CONFIG_PATH_INVALID_TYPE", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        discovery: "bad" as any,
      },
    };
    const rawConfig = {
      workflow: {
        discovery: "bad" as any,
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics.length).toBe(1);
    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_INVALID_TYPE");
    expect(res.diagnostics[0].path).toBe("workflow.discovery");
    expect(res.diagnostics[0].fatalInStrictContext).toBe(true);
    // Should fallback to default include patterns
    expect(res.include).toEqual([
      "workflows/**/*.workflow.js",
      "workflows/**/*.workflow.ts",
      "workflows/**/*.workflow.mjs",
      "workflows/**/*.workflow.cjs",
    ]);
  });

  it("workflow.discovery.exclude without include emits CONFIG_PATH_LEGACY_KEY_USED and uses legacy exclude", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        discovery: {
          exclude: ["custom-exclude/*.ts"],
        } as any,
      },
    };
    const rawConfig = {
      workflow: {
        discovery: {
          exclude: ["custom-exclude/*.ts"],
        } as any,
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.include).toEqual([
      "workflows/**/*.workflow.js",
      "workflows/**/*.workflow.ts",
      "workflows/**/*.workflow.mjs",
      "workflows/**/*.workflow.cjs",
    ]);
    expect(res.exclude).toEqual(["custom-exclude/*.ts"]);
    expect(res.source).toBe("default"); // includeSource is default
    expect(res.excludeSource).toBe("legacy-discovery");
    expect(res.diagnostics.length).toBe(1);
    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_LEGACY_KEY_USED");
    expect(res.diagnostics[0].path).toBe("workflow.discovery");
  });
});
