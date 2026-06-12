import type { ErrorObject } from "ajv";

/**
 * Checks if a value is JSON-compatible.
 * Rejects functions, symbols, cyclic structures, BigInt, and host objects.
 */
export function isJsonCompatible(value: unknown, seen = new WeakSet()): boolean {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value as object)) {
    return false; // Cyclic
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.every(item => isJsonCompatible(item, seen));
  }

  // Plain objects only
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return false;
  }

  for (const key of Object.keys(value)) {
    if (!isJsonCompatible((value as any)[key], seen)) {
      return false;
    }
  }

  return true;
}

/**
 * Formats Ajv errors into a standard ToolValidationResult error shape.
 */
export function formatAjvErrors(errors: ErrorObject[] | null | undefined): Array<{
  path: string;
  keyword?: string;
  message: string;
}> {
  if (!errors) return [];
  return errors.map(err => ({
    path: err.instancePath || "",
    keyword: err.keyword,
    message: err.message || "Unknown validation error"
  }));
}

/**
 * Checks if a tool ID is safe (non-empty, no path-like characters, no whitespace).
 */
export function isSafeToolDefinitionId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  
  // No whitespace
  if (/\s/.test(id)) return false;
  
  // Non-empty, and no /, \, or ..
  return id.length > 0 && !id.includes("/") && !id.includes("\\") && !id.includes("..");
}
