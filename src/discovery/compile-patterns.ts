import { resolve } from "node:path";
import type {
  DiscoveryCompatibilityMode,
  DiscoveryConfigSource,
  DiscoveryResource,
  NormalizedResourceDiscovery,
} from "../config/types.js";
import type { ListResourceType } from "./types.js";

export type DiscoveryPatternKind = "include" | "exclude";
export type DiscoveryPatternClassification = "glob" | "literal-file";
export type DiscoveryMarkerPolicy = "required" | "optional-for-generic-runtime-pattern";

export interface NormalizedDiscoveryPattern {
  kind: DiscoveryPatternKind;
  resource: DiscoveryResource;
  rawValue: string;
  normalizedPattern: string;
  diagnosticLabel: string;
  configPath: string;
  source: DiscoveryConfigSource;
  compatibilityMode: DiscoveryCompatibilityMode;
  index: number;
}

export interface CompiledDiscoveryPattern extends NormalizedDiscoveryPattern {
  hasGlob: boolean;
  baseDir: string;
  absoluteBaseDir: string;
  classification: DiscoveryPatternClassification;
  marker: ".workflow." | ".agent." | ".tool.";
  markerPolicy: DiscoveryMarkerPolicy;
}

export interface CompiledResourceDiscovery {
  resource: DiscoveryResource;
  listResourceType: ListResourceType;
  compatibilityMode: DiscoveryCompatibilityMode;
  include: CompiledDiscoveryPattern[];
  exclude: CompiledDiscoveryPattern[];
}

function checkHasGlob(pattern: string): boolean {
  return /[*?[\]{}]|([+!@?*]\()/.test(pattern);
}

function normalizePath(pattern: string): string {
  let normalized = pattern.replace(/\\/g, "/");
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

function computeBaseDir(normalizedPattern: string, hasGlob: boolean): string {
  if (!hasGlob) {
    return normalizedPattern;
  }
  const segments = normalizedPattern.split("/");
  const baseSegments: string[] = [];
  for (const segment of segments) {
    if (checkHasGlob(segment)) {
      break;
    }
    baseSegments.push(segment);
  }
  return baseSegments.length > 0 ? baseSegments.join("/") : ".";
}

function computeConfigPath(
  source: DiscoveryConfigSource,
  kind: DiscoveryPatternKind,
  resource: DiscoveryResource,
  index: number,
  sourcePaths: string[]
): string {
  if (source === "new") {
    return `${resource}.${kind}[${index}]`;
  }
  if (source === "legacy-discovery") {
    return `workflow.discovery.${kind}[${index}]`;
  }
  if (source === "legacy-dir") {
    return `${resource}.dir`;
  }
  if (source === "cli-override") {
    if (sourcePaths.includes("cli.workflowsDir")) return "cli.workflowsDir";
    if (sourcePaths.includes("cli.agentsDir")) return "cli.agentsDir";
    if (sourcePaths.includes("cli.toolsDir")) return "cli.toolsDir";
    if (sourcePaths.includes("cli.dir")) return "cli.dir";
    return "cli.dir";
  }
  if (source === "default") {
    return `${resource}.${kind}[${index}]`;
  }
  return `${resource}.${kind}[${index}]`;
}

const RUNTIME_EXTENSION_NAMES = new Set(["js", "ts", "mjs", "cjs"]);
const RUNTIME_EXTENSIONS = [".js", ".ts", ".mjs", ".cjs"] as const;

function basenameTargetsGenericRuntimeExtension(basename: string, marker: string): boolean {
  if (basename.includes(marker)) {
    return false;
  }
  if (RUNTIME_EXTENSIONS.some((extension) => basename.endsWith(extension))) {
    return true;
  }
  const braceMatch = basename.match(/\.\{([^{}]+)\}$/);
  if (!braceMatch) {
    return false;
  }
  const group = braceMatch[1];
  if (!group) {
    return false;
  }
  const alternatives = group.split(",").map((part) => part.trim());
  return alternatives.length > 0 && alternatives.every((part) => RUNTIME_EXTENSION_NAMES.has(part));
}

function computeMarkerPolicy(
  compatibilityMode: DiscoveryCompatibilityMode,
  normalizedPattern: string,
  marker: string
): DiscoveryMarkerPolicy {
  if (compatibilityMode === "legacy-compatible" || compatibilityMode === "cli-dir-compatible") {
    return "optional-for-generic-runtime-pattern";
  }
  const segments = normalizedPattern.split("/");
  const basename = segments[segments.length - 1] || "";
  if (basenameTargetsGenericRuntimeExtension(basename, marker)) {
    return "optional-for-generic-runtime-pattern";
  }
  return "required";
}

export function compileResourceDiscovery(input: {
  cwd: string;
  discovery: NormalizedResourceDiscovery & { exclude?: string[] };
}): { discovery: CompiledResourceDiscovery; diagnostics: [] } {
  const { cwd, discovery } = input;

  let listResourceType: ListResourceType;
  if (discovery.resource === "workflow") {
    listResourceType = "workflow";
  } else if (discovery.resource === "sharedAgents") {
    listResourceType = "agent";
  } else if (discovery.resource === "tools") {
    listResourceType = "tool";
  } else {
    listResourceType = "workflow";
  }

  let marker: ".workflow." | ".agent." | ".tool.";
  if (discovery.resource === "workflow") {
    marker = ".workflow.";
  } else if (discovery.resource === "sharedAgents") {
    marker = ".agent.";
  } else {
    marker = ".tool.";
  }

  const compilePattern = (
    pattern: string,
    kind: DiscoveryPatternKind,
    index: number
  ): CompiledDiscoveryPattern => {
    const normalizedPattern = normalizePath(pattern);

    let rawValue = normalizedPattern;
    if (kind === "include") {
      if (discovery.rawInclude && discovery.rawInclude[index] !== undefined) {
        rawValue = discovery.rawInclude[index];
      }
    } else {
      if (discovery.rawExclude && discovery.rawExclude[index] !== undefined) {
        rawValue = discovery.rawExclude[index];
      }
    }

    const source = kind === "include" ? discovery.includeSource : discovery.excludeSource;
    const diagnosticLabel = source === "default" ? normalizedPattern : rawValue;
    const configPath = computeConfigPath(source, kind, discovery.resource, index, discovery.sourcePaths || []);
    const hasGlob = checkHasGlob(normalizedPattern);
    const classification = hasGlob ? "glob" : "literal-file";
    const baseDir = computeBaseDir(normalizedPattern, hasGlob);
    const absoluteBaseDir = resolve(cwd, baseDir);
    const markerPolicy = computeMarkerPolicy(discovery.compatibilityMode, normalizedPattern, marker);

    return {
      kind,
      resource: discovery.resource,
      rawValue,
      normalizedPattern,
      diagnosticLabel,
      configPath,
      source,
      compatibilityMode: discovery.compatibilityMode,
      index,
      hasGlob,
      baseDir,
      absoluteBaseDir,
      classification,
      marker,
      markerPolicy,
    };
  };

  const compiledIncludes = (discovery.include || []).map((p, idx) => compilePattern(p, "include", idx));
  const compiledExcludes = (discovery.exclude || []).map((p, idx) => compilePattern(p, "exclude", idx));

  return {
    discovery: {
      resource: discovery.resource,
      listResourceType,
      compatibilityMode: discovery.compatibilityMode,
      include: compiledIncludes,
      exclude: compiledExcludes,
    },
    diagnostics: [],
  };
}
