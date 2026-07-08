import { contextInvalidPath } from "./errors.js";
import type { ContextOperationName, NormalizedContextPath } from "./types.js";

export function parseContextPath(
  path: unknown,
  options: { operation: ContextOperationName }
): NormalizedContextPath {
  const { operation } = options;

  if (typeof path !== "string") {
    // If not a string, we stringify it to show in the error message, but still throw
    throw contextInvalidPath(operation, String(path), "Path must be a string");
  }

  if (path === "") {
    throw contextInvalidPath(operation, path, "Path cannot be empty");
  }

  if (path.trim() === "") {
    throw contextInvalidPath(operation, path, "Path cannot be empty");
  }

  if (path.startsWith(".")) {
    throw contextInvalidPath(operation, path, "Path cannot start with a dot");
  }

  if (path.endsWith(".")) {
    throw contextInvalidPath(operation, path, "Path cannot end with a dot");
  }

  if (path.includes("..")) {
    throw contextInvalidPath(operation, path, "Path traversal segments (..) are not allowed");
  }

  const rawSegments = path.split(".");
  const segments: string[] = [];

  for (const rawSeg of rawSegments) {
    if (rawSeg === "") {
      throw contextInvalidPath(operation, path, "Path contains empty segments");
    }
    const trimmed = rawSeg.trim();
    if (trimmed === "") {
      throw contextInvalidPath(operation, path, "Path contains empty segments");
    }
    if (trimmed === "..") {
      throw contextInvalidPath(operation, path, "Path traversal segments (..) are not allowed");
    }
    if (trimmed === "__proto__" || trimmed === "prototype" || trimmed === "constructor") {
      throw contextInvalidPath(operation, path, "Prototype pollution segments are not allowed");
    }
    if (/^\d+$/.test(trimmed)) {
      throw contextInvalidPath(operation, path, "Numeric path segments are not allowed");
    }
    segments.push(trimmed);
  }

  const normalized = segments.join(".");
  return {
    raw: path,
    normalized,
    segments,
  };
}

export function joinContextPath(
  prefix: string,
  path: string,
  options: { operation: ContextOperationName }
): NormalizedContextPath {
  const { operation } = options;
  if (!prefix) {
    return parseContextPath(path, { operation });
  }
  if (!path) {
    return parseContextPath(prefix, { operation });
  }
  const joined = `${prefix}.${path}`;
  return parseContextPath(joined, { operation });
}

export function isAncestorPath(ancestor: string, path: string): boolean {
  if (!ancestor || !path) return false;
  const ancestorSegs = ancestor.split(".").map(s => s.trim());
  const pathSegs = path.split(".").map(s => s.trim());
  if (ancestorSegs.length >= pathSegs.length) return false;
  return ancestorSegs.every((seg, idx) => pathSegs[idx] === seg);
}
