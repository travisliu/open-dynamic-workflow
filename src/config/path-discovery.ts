import type {
  DiscoveryResource,
  DiscoveryConfigSource,
  DiscoveryCompatibilityMode,
  NormalizedResourceDiscovery,
  NormalizedDiscoveryConfig,
  ConfigDiagnostic,
  DiscoveryCliOverrides,
  OpenDynamicWorkflowConfig,
} from "./types.js";
import {
  normalizePatternPath,
  detectUnsupportedGlobSyntax,
  normalizePatternForMatching,
} from "./path-safety.js";

export const RUNTIME_EXTENSIONS = [".js", ".ts", ".mjs", ".cjs"] as const;

export const RESOURCE_SUFFIXES = {
  workflow: [".js", ".ts", ".mjs", ".cjs"],
  sharedAgents: [".js", ".ts", ".mjs", ".cjs"],
  tools: [".js", ".ts", ".mjs", ".cjs"],
} as const;

export const LEGACY_COMPATIBLE_SUFFIXES = {
  workflow: [".js", ".ts", ".mjs", ".cjs"],
  sharedAgents: [".js", ".ts", ".mjs", ".cjs"],
  tools: [".js", ".ts", ".mjs", ".cjs"],
} as const;

export const RESOURCE_MARKER_PATTERNS = {
  workflow: [".workflow."],
  sharedAgents: [".agent."],
  tools: [".tool."],
} as const;

export const DEFAULT_RESOURCE_DIRS = {
  workflow: ["workflows"],
  sharedAgents: [".open-dynamic-workflow/agents"],
  tools: [".open-dynamic-workflow/tools"],
} as const;

export const DEFAULT_EXCLUDE_PATTERNS = [
  "**/*.test.*",
  "**/*.spec.*",
];

/**
 * Checks if a pattern has a compatible file extension suffix based on compatibility mode.
 */
function hasCompatibleResourceFileSuffix(
  resource: DiscoveryResource,
  pattern: string,
  compatibilityMode: DiscoveryCompatibilityMode
): boolean {
  const suffixes = (compatibilityMode === "legacy-compatible" || compatibilityMode === "cli-dir-compatible")
    ? LEGACY_COMPATIBLE_SUFFIXES[resource]
    : RESOURCE_SUFFIXES[resource];
  return suffixes.some(suffix => pattern.endsWith(suffix));
}

/**
 * Classifies a pattern as glob, literal-file, unsupported-resource-suffix, or directory-only.
 */
export function classifyPathPattern(input: {
  resource: DiscoveryResource;
  pattern: string;
  compatibilityMode: DiscoveryCompatibilityMode;
}): "glob" | "literal-file" | "unsupported-resource-suffix" | "directory-only" {
  if (input.pattern.includes("*")) {
    return "glob";
  }
  if (hasCompatibleResourceFileSuffix(input.resource, input.pattern, input.compatibilityMode)) {
    return "literal-file";
  }
  const lastSegment = input.pattern.split("/").pop() || "";
  const hasDot = lastSegment.includes(".") && !lastSegment.startsWith(".");
  if (hasDot) {
    return "unsupported-resource-suffix";
  }
  return "directory-only";
}

/**
 * Expands a directory path into explicit file patterns based on resource type and compatibility mode.
 */
export function expandDirectoryToResourceGlobs(input: {
  resource: DiscoveryResource;
  dir: string;
  compatibilityMode: DiscoveryCompatibilityMode;
}): string[] {
  const suffixes = (input.compatibilityMode === "legacy-compatible" || input.compatibilityMode === "cli-dir-compatible")
    ? LEGACY_COMPATIBLE_SUFFIXES[input.resource]
    : RESOURCE_SUFFIXES[input.resource];

  const normalizedDir = normalizePatternPath(input.dir).replace(/\/$/, "");

  return suffixes.map(suffix => `${normalizedDir}/**/*${suffix}`);
}

/**
 * Validates whether the configured include/exclude value is an array of strings.
 */
function validatePathArray(
  resource: DiscoveryResource,
  pathKey: string,
  value: unknown
): { valid: boolean; diagnostics: ConfigDiagnostic[] } {
  const diags: ConfigDiagnostic[] = [];
  if (value === undefined || value === null) {
    return { valid: true, diagnostics: [] };
  }
  if (!Array.isArray(value)) {
    diags.push({
      resource,
      path: pathKey,
      severity: "error",
      code: "CONFIG_PATH_INVALID_TYPE",
      message: `Config value '${pathKey}' must be an array, got ${typeof value}.`,
      fatalInStrictContext: true,
      value,
    });
    return { valid: false, diagnostics: diags };
  }
  let allStrings = true;
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      diags.push({
        resource,
        path: `${pathKey}[${i}]`,
        severity: "error",
        code: "CONFIG_PATH_INVALID_TYPE",
        message: `Config value '${pathKey}[${i}]' must be a string, got ${typeof value[i]}.`,
        fatalInStrictContext: true,
        value: value[i],
      });
      allStrings = false;
    }
  }
  return { valid: allStrings, diagnostics: diags };
}

/**
 * Normalizes path discovery configuration for a specific resource type.
 */
export function normalizeResourceDiscovery(input: {
  resource: DiscoveryResource;
  config: OpenDynamicWorkflowConfig;
  cwd: string;
  cliOverrides?: DiscoveryCliOverrides;
  rawConfig?: unknown;
}): NormalizedResourceDiscovery {
  const { resource, config, cwd, cliOverrides, rawConfig } = input;
  const diagnostics: ConfigDiagnostic[] = [];

  // Determine CLI overrides
  let cliOverrideDir: string | undefined = undefined;
  if (cliOverrides) {
    if (resource === "workflow") {
      cliOverrideDir = cliOverrides.workflowsDir || (cliOverrides.resourceType === "workflow" ? cliOverrides.dir : undefined);
    } else if (resource === "sharedAgents") {
      cliOverrideDir = cliOverrides.agentsDir || (cliOverrides.resourceType === "agent" ? cliOverrides.dir : undefined);
    } else if (resource === "tools") {
      cliOverrideDir = cliOverrides.toolsDir || (cliOverrides.resourceType === "tool" ? cliOverrides.dir : undefined);
    }
  }

  // Detect user authored keys in rawConfig
  const rawResource = (rawConfig as any)?.[resource];
  const hasUserFlatInclude = rawResource?.include !== undefined;
  const hasUserFlatExclude = rawResource?.exclude !== undefined;
  
  let hasUserLegacyInclude = false;
  let hasUserLegacyExclude = false;
  if (rawConfig === undefined) {
    hasUserLegacyInclude = false;
    hasUserLegacyExclude = false;
  } else if (resource === "workflow") {
    if (rawResource?.discovery !== undefined) {
      const rawDiscovery = rawResource.discovery;
      if (typeof rawDiscovery !== "object" || rawDiscovery === null || Array.isArray(rawDiscovery)) {
        diagnostics.push({
          resource,
          path: "workflow.discovery",
          severity: "error",
          code: "CONFIG_PATH_INVALID_TYPE",
          message: `Config value 'workflow.discovery' must be an object, got ${Array.isArray(rawDiscovery) ? "array" : typeof rawDiscovery}.`,
          fatalInStrictContext: true,
          value: rawDiscovery,
        });
        hasUserLegacyInclude = false;
        hasUserLegacyExclude = false;
      } else {
        hasUserLegacyInclude = rawDiscovery.include !== undefined;
        hasUserLegacyExclude = rawDiscovery.exclude !== undefined;
      }
    }
  } else {
    hasUserLegacyInclude = rawResource?.dir !== undefined;
  }

  // Extract patterns safely based on the specific resource configuration type
  let rawInclude: string[] = [];
  let rawExclude: string[] = [];
  let configDir: string | undefined = undefined;

  if (resource === "workflow") {
    rawInclude = (config.workflow?.include as string[]) || [];
    rawExclude = (config.workflow?.exclude as string[]) || [];
  } else if (resource === "sharedAgents") {
    rawInclude = (config.sharedAgents?.include as string[]) || [];
    rawExclude = (config.sharedAgents?.exclude as string[]) || [];
    configDir = config.sharedAgents?.dir as string | undefined;
  } else if (resource === "tools") {
    rawInclude = (config.tools?.include as string[]) || [];
    rawExclude = (config.tools?.exclude as string[]) || [];
    configDir = config.tools?.dir as string | undefined;
  }

  // Determine include source, compatibility mode, and patterns
  let includeSource: DiscoveryConfigSource = "default";
  let compatibilityMode: DiscoveryCompatibilityMode = "default-suffix-specific";
  let sourcePaths: string[] = [];

  if (cliOverrideDir !== undefined) {
    includeSource = "cli-override";
    compatibilityMode = "cli-dir-compatible";
    rawInclude = [cliOverrideDir];
    sourcePaths = ["cli-override"];
    diagnostics.push({
      resource,
      path: cliOverrides?.workflowsDir ? "cli.workflowsDir" : cliOverrides?.agentsDir ? "cli.agentsDir" : cliOverrides?.toolsDir ? "cli.toolsDir" : "cli.dir",
      severity: "warning",
      code: "CONFIG_PATH_CLI_OVERRIDE_USED",
      message: `CLI override is used for ${resource} path discovery.`,
      fatalInStrictContext: false,
      value: cliOverrideDir,
    });
  } else if (hasUserFlatInclude) {
    includeSource = "new";
    compatibilityMode = "new-suffix-specific";
    sourcePaths = [`${resource}.include`];
    if (hasUserLegacyInclude) {
      const oldKey = resource === "workflow" ? "workflow.discovery.include" : `${resource}.dir`;
      diagnostics.push({
        resource,
        path: oldKey,
        severity: "warning",
        code: "CONFIG_PATH_NEW_OVERRIDES_LEGACY",
        message: `${resource}.include is configured, so legacy ${oldKey} is ignored.`,
        hint: `Remove legacy key or migrate it to ${resource}.include.`,
        fatalInStrictContext: false,
        migration: {
          oldKey,
          ignoredKey: oldKey,
          effectiveInclude: rawInclude,
          effectiveExclude: rawExclude,
        },
      });
    }
  } else if (hasUserLegacyInclude) {
    if (resource === "workflow") {
      includeSource = "legacy-discovery";
      compatibilityMode = "legacy-compatible";
      const legacyDiscovery = (config.workflow as any)?.discovery;
      rawInclude = (legacyDiscovery?.include as string[]) || [];
      sourcePaths = ["workflow.discovery.include"];
      if (rawConfig !== undefined) {
        diagnostics.push({
          resource,
          path: "workflow.discovery",
          severity: "warning",
          code: "CONFIG_PATH_LEGACY_KEY_USED",
          message: `Legacy key workflow.discovery is used.`,
          hint: `Migrate to the new flat workflow.include configuration.`,
          fatalInStrictContext: false,
        });
      }
    } else {
      includeSource = "legacy-dir";
      compatibilityMode = "legacy-compatible";
      rawInclude = configDir ? [configDir] : [];
      sourcePaths = [`${resource}.dir`];
      if (rawConfig !== undefined) {
        diagnostics.push({
          resource,
          path: `${resource}.dir`,
          severity: "warning",
          code: "CONFIG_PATH_LEGACY_KEY_USED",
          message: `Legacy key ${resource}.dir is used.`,
          hint: `Migrate to the new flat ${resource}.include configuration.`,
          fatalInStrictContext: false,
        });
      }
    }
  } else {
    // Defaults
    includeSource = "default";
    compatibilityMode = "default-suffix-specific";
    sourcePaths = ["default"];
  }

  // Determine exclude source and patterns
  let excludeSource: DiscoveryConfigSource = "default";

  if (hasUserFlatExclude) {
    excludeSource = "new";
    if (resource === "workflow" && hasUserLegacyExclude) {
      diagnostics.push({
        resource,
        path: "workflow.discovery.exclude",
        severity: "warning",
        code: "CONFIG_PATH_NEW_OVERRIDES_LEGACY",
        message: `workflow.exclude is configured, so legacy workflow.discovery.exclude is ignored.`,
        hint: `Remove legacy key or migrate it to workflow.exclude.`,
        fatalInStrictContext: false,
      });
    }
  } else if (resource === "workflow" && hasUserLegacyExclude) {
    excludeSource = "legacy-discovery";
    const legacyDiscovery = (config.workflow as any)?.discovery;
    rawExclude = (legacyDiscovery?.exclude as string[]) || [];
    if (includeSource !== "legacy-discovery") {
      diagnostics.push({
        resource,
        path: "workflow.discovery",
        severity: "warning",
        code: "CONFIG_PATH_LEGACY_KEY_USED",
        message: `Legacy key workflow.discovery is used.`,
        hint: `Migrate to the new flat workflow.include configuration.`,
        fatalInStrictContext: false,
      });
    }
  } else {
    excludeSource = "default";
  }

  // Validate array formats
  const includeValidationPath = includeSource === "legacy-dir" ? `${resource}.dir` : (includeSource === "legacy-discovery" ? "workflow.discovery.include" : `${resource}.include`);
  const excludeValidationPath = excludeSource === "legacy-discovery" ? "workflow.discovery.exclude" : `${resource}.exclude`;

  let includePatternsToProcess: string[] = [];
  if (includeSource === "legacy-dir") {
    // legacy dir is a string, not an array in config
    const dirVal = configDir;
    if (typeof dirVal !== "string" || dirVal.trim() === "") {
      diagnostics.push({
        resource,
        path: `${resource}.dir`,
        severity: "error",
        code: "CONFIG_PATH_INVALID_TYPE",
        message: `Legacy directory path must be a non-empty string, got ${typeof dirVal}.`,
        fatalInStrictContext: true,
        value: dirVal,
      });
    } else {
      includePatternsToProcess = expandDirectoryToResourceGlobs({ resource, dir: dirVal, compatibilityMode });
    }
  } else if (includeSource === "cli-override") {
    includePatternsToProcess = expandDirectoryToResourceGlobs({ resource, dir: cliOverrideDir!, compatibilityMode });
  } else {
    // Normal array fields
    const validation = validatePathArray(resource, includeValidationPath, rawInclude);
    diagnostics.push(...validation.diagnostics);
    if (validation.valid) {
      includePatternsToProcess = [...rawInclude];
    }
  }

  const excludeValidation = validatePathArray(resource, excludeValidationPath, rawExclude);
  diagnostics.push(...excludeValidation.diagnostics);
  let excludePatternsToProcess: string[] = [];
  if (excludeValidation.valid) {
    excludePatternsToProcess = [...rawExclude];
  }

  // Process and normalize include patterns
  const resolvedIncludes: string[] = [];
  for (let i = 0; i < includePatternsToProcess.length; i++) {
    const rawPattern = includePatternsToProcess[i];
    if (rawPattern === undefined) {
      continue;
    }
    const pathKey = includeSource === "cli-override"
      ? (cliOverrides?.workflowsDir ? "cli.workflowsDir" : cliOverrides?.agentsDir ? "cli.agentsDir" : cliOverrides?.toolsDir ? "cli.toolsDir" : "cli.dir")
      : (includeSource === "legacy-dir" ? `${resource}.dir` : `${includeValidationPath}[${i}]`);

    const safetyResult = normalizePatternForMatching({
      cwd,
      resource,
      path: pathKey,
      pattern: rawPattern,
      source: includeSource,
    });

    diagnostics.push(...safetyResult.diagnostics);

    if (safetyResult.pattern) {
      const normalized = safetyResult.pattern;
      const classification = classifyPathPattern({
        resource,
        pattern: normalized,
        compatibilityMode,
      });

      if (classification === "unsupported-resource-suffix") {
        diagnostics.push({
          resource,
          path: pathKey,
          severity: "error",
          code: "CONFIG_PATH_UNSUPPORTED_RESOURCE_SUFFIX",
          message: `Pattern '${rawPattern}' is a file with an unsupported resource suffix for resource '${resource}'.`,
          fatalInStrictContext: true,
          value: rawPattern,
        });
      } else if (classification === "directory-only") {
        diagnostics.push({
          resource,
          path: pathKey,
          severity: "error",
          code: "CONFIG_PATH_DIRECTORY_ONLY",
          message: `Pattern '${rawPattern}' resolves to a directory-only value but a file glob is required.`,
          fatalInStrictContext: true,
          value: rawPattern,
        });
      } else {
        // Glob or literal-file -> keep it
        resolvedIncludes.push(normalized);
      }
    }
  }

  // Process and normalize exclude patterns
  const resolvedExcludes: string[] = [];
  for (let i = 0; i < excludePatternsToProcess.length; i++) {
    const rawPattern = excludePatternsToProcess[i];
    if (rawPattern === undefined) {
      continue;
    }
    const pathKey = `${excludeValidationPath}[${i}]`;

    const safetyResult = normalizePatternForMatching({
      cwd,
      resource,
      path: pathKey,
      pattern: rawPattern,
      source: excludeSource,
    });

    diagnostics.push(...safetyResult.diagnostics);

    if (safetyResult.pattern) {
      const normalized = safetyResult.pattern;
      const classification = classifyPathPattern({
        resource,
        pattern: normalized,
        compatibilityMode,
      });

      if (classification === "unsupported-resource-suffix") {
        diagnostics.push({
          resource,
          path: pathKey,
          severity: "error",
          code: "CONFIG_PATH_UNSUPPORTED_RESOURCE_SUFFIX",
          message: `Pattern '${rawPattern}' is a file with an unsupported resource suffix for resource '${resource}'.`,
          fatalInStrictContext: true,
          value: rawPattern,
        });
      } else if (classification === "directory-only") {
        diagnostics.push({
          resource,
          path: pathKey,
          severity: "error",
          code: "CONFIG_PATH_DIRECTORY_ONLY",
          message: `Pattern '${rawPattern}' resolves to a directory-only value but a file glob is required.`,
          fatalInStrictContext: true,
          value: rawPattern,
        });
      } else {
        resolvedExcludes.push(normalized);
      }
    }
  }

  return {
    resource,
    include: resolvedIncludes,
    exclude: resolvedExcludes,
    source: includeSource,
    includeSource,
    excludeSource,
    compatibilityMode,
    sourcePaths,
    rawInclude,
    rawExclude,
    diagnostics,
  };
}

/**
 * Main entry point for path discovery configuration normalization.
 */
export function normalizeDiscoveryConfig(input: {
  config: OpenDynamicWorkflowConfig;
  cwd: string;
  cliOverrides?: DiscoveryCliOverrides;
  rawConfig?: unknown;
}): {
  discovery: NormalizedDiscoveryConfig;
  diagnostics: ConfigDiagnostic[];
} {
  const workflowDiscovery = normalizeResourceDiscovery({
    resource: "workflow",
    config: input.config,
    cwd: input.cwd,
    ...(input.cliOverrides ? { cliOverrides: input.cliOverrides } : {}),
    ...(input.rawConfig !== undefined ? { rawConfig: input.rawConfig } : {}),
  });

  const sharedAgentsDiscovery = normalizeResourceDiscovery({
    resource: "sharedAgents",
    config: input.config,
    cwd: input.cwd,
    ...(input.cliOverrides ? { cliOverrides: input.cliOverrides } : {}),
    ...(input.rawConfig !== undefined ? { rawConfig: input.rawConfig } : {}),
  });

  const toolsDiscovery = normalizeResourceDiscovery({
    resource: "tools",
    config: input.config,
    cwd: input.cwd,
    ...(input.cliOverrides ? { cliOverrides: input.cliOverrides } : {}),
    ...(input.rawConfig !== undefined ? { rawConfig: input.rawConfig } : {}),
  });

  // Gather diagnostics
  const allDiagnostics: ConfigDiagnostic[] = [
    ...workflowDiscovery.diagnostics,
    ...sharedAgentsDiscovery.diagnostics,
    ...toolsDiscovery.diagnostics,
  ];

  return {
    discovery: {
      workflow: workflowDiscovery,
      sharedAgents: sharedAgentsDiscovery,
      tools: toolsDiscovery,
    },
    diagnostics: allDiagnostics,
  };
}
