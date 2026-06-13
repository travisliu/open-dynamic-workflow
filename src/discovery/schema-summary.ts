import ts from "typescript";
import { extractStaticValue, StaticValue } from "./static-values.js";

/**
 * Extracts a static object literal from an AST node if possible.
 */
export function asStaticObject(node: ts.Node): Record<string, unknown> | undefined {
  const result = extractStaticValue(node);
  if (result.ok && result.value !== null && typeof result.value === "object" && !Array.isArray(result.value)) {
    return result.value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Derives required input names from a JSON schema object.
 */
export function deriveRequiredInputs(inputSchema: unknown): string[] | undefined {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return undefined;
  }
  
  if (!Object.prototype.hasOwnProperty.call(inputSchema, "required")) {
    return undefined;
  }

  const required = (inputSchema as any).required;
  if (!Array.isArray(required)) {
    return undefined;
  }

  if (required.every(value => typeof value === "string")) {
    return required;
  }

  return undefined;
}

/**
 * Checks if a value is a positive integer.
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
