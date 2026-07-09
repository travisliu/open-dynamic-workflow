import type { ContextInheritRule, NormalizedContextInheritRule } from "./types.js";
import type { ContextScopeFrame } from "./overlay.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { parseContextPath } from "./path.js";
import { frameGet, incrementPathVersions } from "./overlay.js";
import { contextInheritPathNotFound } from "./errors.js";
import { contextSet } from "./operations.js";

export function normalizeInheritRules(
  rules: ContextInheritRule[] | undefined,
  operationLabel: string = "inheritance"
): NormalizedContextInheritRule[] {
  if (!rules) return [];
  const normalized: NormalizedContextInheritRule[] = [];
  const seenPaths = new Set<string>();

  for (const rule of rules) {
    let pathStr: string;
    let required = true;

    if (typeof rule === "string") {
      pathStr = rule;
    } else if (rule && typeof rule === "object" && typeof rule.path === "string") {
      pathStr = rule.path;
      if (rule.required !== undefined) {
        required = !!rule.required;
      }
    } else {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONTEXT_INVALID_PATH,
        `Invalid inherit rule in ${operationLabel}: rules must be strings or objects with a path string`
      );
    }

    const { normalized: normPath } = parseContextPath(pathStr, { operation: "scope" });

    if (seenPaths.has(normPath)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONTEXT_INVALID_PATH,
        `Duplicate inherit path '${normPath}' in ${operationLabel}`
      );
    }
    seenPaths.add(normPath);

    normalized.push({ path: normPath, required });
  }

  return normalized;
}

export function applyInheritedPaths(
  parentScope: ContextScopeFrame,
  childScope: ContextScopeFrame,
  normalizedRules: NormalizedContextInheritRule[]
): void {
  for (const rule of normalizedRules) {
    const segments = rule.path.split(".");
    const val = frameGet(parentScope, segments, rule.path);

    if (val === undefined) {
      if (rule.required) {
        throw contextInheritPathNotFound(rule.path, parentScope.scopeId, childScope.scopeId);
      } else {
        // Record optional missing path
        childScope.inheritedPaths.push({
          path: rule.path,
          required: false,
          found: false,
        });
      }
    } else {
      // Set value in childScope locally (without logging patch operation)
      contextSet(childScope.data, segments, val, "set", rule.path);
      incrementPathVersions(childScope, rule.path);
      // Record inherited path metadata
      childScope.inheritedPaths.push({
        path: rule.path,
        required: rule.required,
        found: true,
      });
    }
  }
}
