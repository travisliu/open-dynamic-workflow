import { realpath } from "fs/promises";
import { realpathSync } from "node:fs";
import * as path from "path";
import type {
  ConfigDiagnostic,
  DiscoveryResource,
  DiscoveryConfigSource,
} from "./types.js";
import { createConfigDiagnostic } from "./path-diagnostics.js";

/**
 * Normalizes pattern path: converts backslashes to POSIX '/' and trims leading './'.
 */
export function normalizePatternPath(pattern: string): string {
  return pattern.replace(/\\+/g, "/").replace(/^(\.\/)+/, "");
}

/**
 * Detects unsupported glob syntax in the pattern and returns labels in deterministic order.
 */
export function detectUnsupportedGlobSyntax(pattern: string): string[] {
  const labels: string[] = [];
  const normalized = pattern.replace(/\\/g, "/");

  // 1. brace-expansion: { or }
  if (pattern.includes("{") || pattern.includes("}")) {
    labels.push("brace-expansion");
  }

  // 2. character-class: [ or ]
  if (pattern.includes("[") || pattern.includes("]")) {
    labels.push("character-class");
  }

  // 3. extglob: ?(, !(, +(, or @(
  if (
    pattern.includes("?(") ||
    pattern.includes("!(") ||
    pattern.includes("+(") ||
    pattern.includes("@(")
  ) {
    labels.push("extglob");
  }

  // 4. negated-pattern: any path segment starting with !
  const segments = normalized.split("/");
  if (segments.some((seg) => seg.startsWith("!"))) {
    labels.push("negated-pattern");
  }

  // 5. question-mark: standalone ? (not part of extglob)
  let hasStandaloneQuestion = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "?") {
      if (i === pattern.length - 1 || pattern[i + 1] !== "(") {
        hasStandaloneQuestion = true;
        break;
      }
    }
  }
  if (hasStandaloneQuestion) {
    labels.push("question-mark");
  }

  return labels;
}

/**
 * Checks if targetPath resolves inside cwd without escaping.
 */
export function isPathInsideCwd(input: { cwd: string; targetPath: string }): boolean {
  let absoluteCwd = path.resolve(input.cwd);
  try {
    absoluteCwd = realpathSync(absoluteCwd);
  } catch {}
  let absoluteTarget = path.resolve(absoluteCwd, input.targetPath);
  try {
    absoluteTarget = realpathSync(absoluteTarget);
  } catch {}
  const relative = path.relative(absoluteCwd, absoluteTarget);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Normalizes pattern and returns potential diagnostics.
 */
export function normalizePatternForMatching(input: {
  cwd: string;
  resource: DiscoveryResource;
  path: string;
  pattern: string;
  source: DiscoveryConfigSource;
}): { pattern?: string; diagnostics: ConfigDiagnostic[] } {
  const diagnostics: ConfigDiagnostic[] = [];
  const rawPattern = input.pattern;

  // 1. Check for empty or whitespace-only pattern
  if (typeof rawPattern !== "string" || rawPattern.trim() === "") {
    diagnostics.push(
      createConfigDiagnostic({
        resource: input.resource,
        path: input.path,
        severity: "error",
        code: "CONFIG_PATH_EMPTY_PATTERN",
        message: `Empty or whitespace-only pattern is not allowed for ${input.path}.`,
        value: rawPattern,
        fatalInStrictContext: true,
      })
    );
    return { diagnostics };
  }

  // 2. Normalize and check if empty after normalization
  const normalized = normalizePatternPath(rawPattern);
  if (normalized === "") {
    diagnostics.push(
      createConfigDiagnostic({
        resource: input.resource,
        path: input.path,
        severity: "error",
        code: "CONFIG_PATH_EMPTY_PATTERN",
        message: `Pattern resolved to empty for ${input.path}.`,
        value: rawPattern,
        fatalInStrictContext: true,
      })
    );
    return { diagnostics };
  }

  // 3. Trailing slash is directory-only
  if (normalized.endsWith("/")) {
    diagnostics.push(
      createConfigDiagnostic({
        resource: input.resource,
        path: input.path,
        severity: "error",
        code: "CONFIG_PATH_DIRECTORY_ONLY",
        message: `${input.path} must be a glob or literal resource file pattern, but received a directory-only value: ${rawPattern}`,
        value: rawPattern,
        fatalInStrictContext: true,
      })
    );
    return { diagnostics };
  }

  // 4. Unsupported syntax warnings
  const unsupportedSyntax = detectUnsupportedGlobSyntax(rawPattern);
  for (const syntax of unsupportedSyntax) {
    diagnostics.push(
      createConfigDiagnostic({
        resource: input.resource,
        path: input.path,
        severity: "warning",
        code: "CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX",
        message: `Unsupported glob syntax (${syntax}) detected in pattern: ${rawPattern}`,
        value: rawPattern,
        fatalInStrictContext: false,
      })
    );
  }

  // 5. Absolute path check
  const isAbsolute = path.isAbsolute(rawPattern) ||
                     rawPattern.startsWith("/") ||
                     /^[a-zA-Z]:/.test(rawPattern);

  if (isAbsolute) {
    if (input.source === "cli-override") {
      const resolvedPath = path.resolve(input.cwd, rawPattern);
      if (isPathInsideCwd({ cwd: input.cwd, targetPath: resolvedPath })) {
        const relative = path.relative(path.resolve(input.cwd), resolvedPath);
        const relativeNormalized = normalizePatternPath(relative);
        diagnostics.push(
          createConfigDiagnostic({
            resource: input.resource,
            path: input.path,
            severity: "warning",
            code: "CONFIG_PATH_CLI_OVERRIDE_USED",
            message: `CLI override absolute path normalized to workspace-relative path: ${relativeNormalized}`,
            value: rawPattern,
            fatalInStrictContext: false,
          })
        );
        return { pattern: relativeNormalized, diagnostics };
      } else {
        diagnostics.push(
          createConfigDiagnostic({
            resource: input.resource,
            path: input.path,
            severity: "error",
            code: "CONFIG_PATH_OUTSIDE_WORKSPACE",
            message: `CLI override absolute path resolves outside the workspace cwd: ${rawPattern}`,
            value: rawPattern,
            fatalInStrictContext: true,
          })
        );
        return { diagnostics };
      }
    } else {
      diagnostics.push(
        createConfigDiagnostic({
          resource: input.resource,
          path: input.path,
          severity: "error",
          code: "CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN",
          message: `Absolute paths are not allowed in configuration files: ${rawPattern}`,
          value: rawPattern,
          fatalInStrictContext: true,
        })
      );
      return { diagnostics };
    }
  }

  // 6. Relative path escaping cwd check
  const resolvedRelative = path.resolve(input.cwd, normalized);
  if (!isPathInsideCwd({ cwd: input.cwd, targetPath: resolvedRelative })) {
    diagnostics.push(
      createConfigDiagnostic({
        resource: input.resource,
        path: input.path,
        severity: "error",
        code: "CONFIG_PATH_OUTSIDE_WORKSPACE",
        message: `${input.path} resolves outside the configured cwd and will not be loaded.`,
        value: rawPattern,
        fatalInStrictContext: true,
      })
    );
    return { diagnostics };
  }

  return { pattern: normalized, diagnostics };
}

/**
 * Checks if the realpath of targetPath is inside cwd.
 */
export async function checkRealPathInsideCwd(input: {
  cwd: string;
  targetPath: string;
  resource: DiscoveryResource;
  path: string;
  source: DiscoveryConfigSource;
}): Promise<{ realPath?: string; diagnostics: ConfigDiagnostic[] }> {
  try {
    const resolvedPath = path.resolve(input.cwd, input.targetPath);
    const real = await realpath(resolvedPath);
    if (!isPathInsideCwd({ cwd: input.cwd, targetPath: real })) {
      return {
        diagnostics: [
          createConfigDiagnostic({
            resource: input.resource,
            path: input.path,
            severity: "error",
            code: "CONFIG_PATH_SYMLINK_ESCAPE",
            message: `The resolved path for ${input.path} escapes the workspace directory via a symlink.`,
            value: input.targetPath,
            fatalInStrictContext: true,
          }),
        ],
      };
    }
    return { realPath: real, diagnostics: [] };
  } catch (error) {
    return { diagnostics: [] };
  }
}

/**
 * Verifies that a matched file does not resolve to a symlink escaping cwd.
 */
export async function checkMatchedFileSafety(input: {
  cwd: string;
  resource: DiscoveryResource;
  path: string;
  filePath: string;
  source: DiscoveryConfigSource;
}): Promise<{ realPath?: string; relativePath?: string; diagnostics: ConfigDiagnostic[] }> {
  try {
    const resolvedPath = path.resolve(input.cwd, input.filePath);
    const real = await realpath(resolvedPath);
    if (!isPathInsideCwd({ cwd: input.cwd, targetPath: real })) {
      return {
        diagnostics: [
          createConfigDiagnostic({
            resource: input.resource,
            path: input.path,
            severity: "error",
            code: "CONFIG_PATH_SYMLINK_ESCAPE",
            message: `A matched ${input.resource} file resolves through a symlink outside cwd and will not be loaded.`,
            value: input.filePath,
            fatalInStrictContext: true,
          }),
        ],
      };
    }
    const relative = path.relative(path.resolve(input.cwd), real);
    const relativePosix = normalizePatternPath(relative);
    return {
      realPath: real,
      relativePath: relativePosix,
      diagnostics: [],
    };
  } catch (error) {
    return { diagnostics: [] };
  }
}
