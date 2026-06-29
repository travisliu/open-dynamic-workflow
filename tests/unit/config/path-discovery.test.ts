import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import {
  normalizeDiscoveryConfig,
  normalizeResourceDiscovery,
} from "../../../src/config/path-discovery.js";

describe("Path Discovery Normalization", () => {
  const cwd = "/workspace";

  it("defaults produce runtime-extension includes and empty excludes for all resources without warnings", () => {
    const { discovery, diagnostics } = normalizeDiscoveryConfig({
      config: DEFAULT_CONFIG,
      cwd,
      rawConfig: {}, // No user-authored keys
    });

    expect(diagnostics).toEqual([]);

    expect(discovery.workflow.include).toEqual([
      "workflows/**/*.js",
      "workflows/**/*.ts",
      "workflows/**/*.mjs",
      "workflows/**/*.cjs",
    ]);
    expect(discovery.workflow.exclude).toEqual([]);
    expect(discovery.workflow.source).toBe("default");

    expect(discovery.sharedAgents.include).toEqual([
      ".open-dynamic-workflow/agents/**/*.js",
      ".open-dynamic-workflow/agents/**/*.ts",
      ".open-dynamic-workflow/agents/**/*.mjs",
      ".open-dynamic-workflow/agents/**/*.cjs",
    ]);
    expect(discovery.sharedAgents.exclude).toEqual([]);
    expect(discovery.sharedAgents.source).toBe("default");

    expect(discovery.tools.include).toEqual([
      ".open-dynamic-workflow/tools/**/*.js",
      ".open-dynamic-workflow/tools/**/*.ts",
      ".open-dynamic-workflow/tools/**/*.mjs",
      ".open-dynamic-workflow/tools/**/*.cjs",
    ]);
    expect(discovery.tools.exclude).toEqual([]);
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

  it("unsupported glob syntax produces CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX warning for negated patterns but not for tinyglobby syntax", () => {
    const configNegated = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["workflows/!foo.js"],
      },
    };
    const rawConfigNegated = {
      workflow: {
        include: ["workflows/!foo.js"],
      },
    };

    const resNegated = normalizeResourceDiscovery({
      resource: "workflow",
      config: configNegated,
      cwd,
      rawConfig: rawConfigNegated,
    });

    expect(resNegated.diagnostics[0].code).toBe("CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX");
    expect(resNegated.diagnostics[0].message).toContain("(negated-pattern)");

    const configTiny = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["workflows/*.{js,ts}", "workflows/??.js", "workflows/foo[a-z].js", "workflows/@(foo|bar).js"],
      },
    };
    const rawConfigTiny = {
      workflow: {
        include: ["workflows/*.{js,ts}", "workflows/??.js", "workflows/foo[a-z].js", "workflows/@(foo|bar).js"],
      },
    };

    const resTiny = normalizeResourceDiscovery({
      resource: "workflow",
      config: configTiny,
      cwd,
      rawConfig: rawConfigTiny,
    });

    expect(resTiny.diagnostics).toEqual([]);
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
      "workflows/**/*.js",
      "workflows/**/*.ts",
      "workflows/**/*.mjs",
      "workflows/**/*.cjs",
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
      "workflows/**/*.js",
      "workflows/**/*.ts",
      "workflows/**/*.mjs",
      "workflows/**/*.cjs",
    ]);
    expect(res.exclude).toEqual(["custom-exclude/*.ts"]);
    expect(res.source).toBe("default"); // includeSource is default
    expect(res.excludeSource).toBe("legacy-discovery");
    expect(res.diagnostics.length).toBe(1);
    expect(res.diagnostics[0].code).toBe("CONFIG_PATH_LEGACY_KEY_USED");
    expect(res.diagnostics[0].path).toBe("workflow.discovery");
  });

  it("a raw config that omits all resource exclude keys normalizes each resource exclude to empty array", () => {
    const { discovery, diagnostics } = normalizeDiscoveryConfig({
      config: DEFAULT_CONFIG,
      cwd,
      rawConfig: {
        workflow: { include: ["workflows/*.ts"] },
        sharedAgents: { include: ["agents/*.ts"] },
        tools: { include: ["tools/*.ts"] }
      },
    });

    expect(diagnostics).toEqual([]);
    expect(discovery.workflow.exclude).toEqual([]);
    expect(discovery.workflow.excludeSource).toBe("default");
    expect(discovery.sharedAgents.exclude).toEqual([]);
    expect(discovery.sharedAgents.excludeSource).toBe("default");
    expect(discovery.tools.exclude).toEqual([]);
    expect(discovery.tools.excludeSource).toBe("default");
  });

  it("explicit empty exclude: [] normalizes to [] and produces no diagnostics", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        exclude: [],
      },
    };
    const rawConfig = {
      workflow: {
        exclude: [],
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics).toEqual([]);
    expect(res.exclude).toEqual([]);
    expect(res.excludeSource).toBe("new");
  });

  it("explicit user excludes are preserved with excludeSource new", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        exclude: ["foo/**/*.ts"],
      },
    };
    const rawConfig = {
      workflow: {
        exclude: ["foo/**/*.ts"],
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics).toEqual([]);
    expect(res.exclude).toEqual(["foo/**/*.ts"]);
    expect(res.excludeSource).toBe("new");
  });

  it("legacy workflow.discovery.exclude is preserved with excludeSource legacy-discovery", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        discovery: {
          exclude: ["legacy-exclude/**/*.ts"],
        } as any,
      },
    };
    const rawConfig = {
      workflow: {
        discovery: {
          exclude: ["legacy-exclude/**/*.ts"],
        } as any,
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.exclude).toEqual(["legacy-exclude/**/*.ts"]);
    expect(res.excludeSource).toBe("legacy-discovery");
  });

  it("workflow.exclude overrides workflow.discovery.exclude and generates warning", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        exclude: ["new-exclude/**/*.ts"],
        discovery: {
          exclude: ["legacy-exclude/**/*.ts"],
        } as any,
      },
    };
    const rawConfig = {
      workflow: {
        exclude: ["new-exclude/**/*.ts"],
        discovery: {
          exclude: ["legacy-exclude/**/*.ts"],
        } as any,
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.exclude).toEqual(["new-exclude/**/*.ts"]);
    expect(res.excludeSource).toBe("new");
    expect(res.diagnostics.some(d => d.code === "CONFIG_PATH_NEW_OVERRIDES_LEGACY")).toBe(true);
  });

  it("CLI overrides preserve user-authored excludes and do not invent excludes", () => {
    // 1. With user exclude
    const configWithExclude = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        exclude: ["user-exclude/**/*.ts"],
      },
    };
    const rawConfigWithExclude = {
      workflow: {
        exclude: ["user-exclude/**/*.ts"],
      },
    };

    const resWithExclude = normalizeResourceDiscovery({
      resource: "workflow",
      config: configWithExclude,
      cwd,
      cliOverrides: {
        resourceType: "workflow",
        dir: "cli-workflows-override",
      },
      rawConfig: rawConfigWithExclude,
    });

    expect(resWithExclude.exclude).toEqual(["user-exclude/**/*.ts"]);
    expect(resWithExclude.excludeSource).toBe("new");

    // 2. Without user exclude
    const resWithoutExclude = normalizeResourceDiscovery({
      resource: "workflow",
      config: DEFAULT_CONFIG,
      cwd,
      cliOverrides: {
        resourceType: "workflow",
        dir: "cli-workflows-override",
      },
      rawConfig: {},
    });

    expect(resWithoutExclude.exclude).toEqual([]);
    expect(resWithoutExclude.excludeSource).toBe("default");
  });

  it("invalid present exclude values produce CONFIG_PATH_INVALID_TYPE", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        exclude: "not-array" as any,
      },
    };
    const rawConfig = {
      workflow: {
        exclude: "not-array" as any,
      },
    };

    const res = normalizeResourceDiscovery({
      resource: "workflow",
      config,
      cwd,
      rawConfig,
    });

    expect(res.diagnostics.some(d => d.code === "CONFIG_PATH_INVALID_TYPE")).toBe(true);
  });

  it("allows extglob negation patterns like workflows/!(draft).js but warns for true negated patterns like workflows/!draft.js in both include and exclude", () => {
    // Include testing
    const configInc = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        include: ["workflows/!(draft).js", "workflows/!draft.js"],
      },
    };
    const rawConfigInc = {
      workflow: {
        include: ["workflows/!(draft).js", "workflows/!draft.js"],
      },
    };
    const resInc = normalizeResourceDiscovery({
      resource: "workflow",
      config: configInc,
      cwd,
      rawConfig: rawConfigInc,
    });
    const warningsInc = resInc.diagnostics.filter(d => d.code === "CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX");
    expect(warningsInc.length).toBe(1);
    expect(warningsInc[0].message).toContain("(negated-pattern)");
    expect(warningsInc[0].value).toBe("workflows/!draft.js");

    // Exclude testing
    const configExc = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        exclude: ["workflows/!(draft).js", "workflows/!draft.js"],
      },
    };
    const rawConfigExc = {
      workflow: {
        exclude: ["workflows/!(draft).js", "workflows/!draft.js"],
      },
    };
    const resExc = normalizeResourceDiscovery({
      resource: "workflow",
      config: configExc,
      cwd,
      rawConfig: rawConfigExc,
    });
    const warningsExc = resExc.diagnostics.filter(d => d.code === "CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX");
    expect(warningsExc.length).toBe(1);
    expect(warningsExc[0].message).toContain("(negated-pattern)");
    expect(warningsExc[0].value).toBe("workflows/!draft.js");
  });

  it("normalizes CLI override source paths correctly for each resource", () => {
    // 1. workflowsDir override
    const resWorkflow = normalizeResourceDiscovery({
      resource: "workflow",
      config: DEFAULT_CONFIG,
      cwd,
      cliOverrides: {
        workflowsDir: "custom-workflows-override",
      },
    });
    expect(resWorkflow.sourcePaths).toEqual(["cli.workflowsDir"]);
    expect(resWorkflow.diagnostics[0].path).toBe("cli.workflowsDir");

    // 2. agentsDir override
    const resAgents = normalizeResourceDiscovery({
      resource: "sharedAgents",
      config: DEFAULT_CONFIG,
      cwd,
      cliOverrides: {
        agentsDir: "custom-agents-override",
      },
    });
    expect(resAgents.sourcePaths).toEqual(["cli.agentsDir"]);
    expect(resAgents.diagnostics[0].path).toBe("cli.agentsDir");

    // 3. toolsDir override
    const resTools = normalizeResourceDiscovery({
      resource: "tools",
      config: DEFAULT_CONFIG,
      cwd,
      cliOverrides: {
        toolsDir: "custom-tools-override",
      },
    });
    expect(resTools.sourcePaths).toEqual(["cli.toolsDir"]);
    expect(resTools.diagnostics[0].path).toBe("cli.toolsDir");

    // 4. Fallback dir override
    const resFallback = normalizeResourceDiscovery({
      resource: "workflow",
      config: DEFAULT_CONFIG,
      cwd,
      cliOverrides: {
        resourceType: "workflow",
        dir: "custom-dir-override",
      },
    });
    expect(resFallback.sourcePaths).toEqual(["cli.dir"]);
    expect(resFallback.diagnostics[0].path).toBe("cli.dir");
  });
});
