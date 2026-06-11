import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { JsonObject, JsonValue } from "../types/common.js";

/**
 * Clones a value while ensuring it is strictly JSON-compatible.
 * Throws InvalidDslCallError (or similar) if the value contains non-JSON types or circular references.
 */
export function cloneJsonValue(value: unknown, label: string): JsonValue {
  return cloneRecursive(value, label, new Set());
}

/**
 * Clones an object while ensuring it is strictly JSON-compatible.
 */
export function cloneJsonObject(value: unknown, label: string): JsonObject {
  const cloned = cloneJsonValue(value, label);
  if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      `${label} must be a plain object.`
    );
  }
  return cloned as JsonObject;
}

function cloneRecursive(value: unknown, label: string, seen: Set<unknown>): JsonValue {
  // Primitives
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new OpenFlowError(
        ErrorCode.WORKFLOW_INVALID_CALL,
        `${label} contains non-finite number: ${value}`
      );
    }
    return value;
  }

  // Reject explicitly unsupported types
  if (value === undefined) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      `${label} cannot be undefined.`
    );
  }
  if (typeof value === "function") {
    throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a function.`);
  }
  if (typeof value === "symbol") {
    throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a symbol.`);
  }
  if (typeof value === "bigint") {
    throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a bigint.`);
  }

  // Circular reference detection
  if (seen.has(value)) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_INVALID_CALL,
      `${label} contains a circular reference.`
    );
  }

  // Arrays
  if (Array.isArray(value)) {
    seen.add(value);
    const cloned = value.map((item, index) => {
      const result = cloneRecursive(item, `${label}[${index}]`, seen);
      return result === undefined ? null : result;
    });
    seen.delete(value);
    return cloned;
  }

  // Objects
  if (typeof value === "object") {
    // Check for "thenables" or Promises
    if ("then" in value && typeof (value as any).then === "function") {
      throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a Promise or thenable.`);
    }

    // Check for other non-plain objects
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      // In some environments (like VM contexts), proto might be Object.prototype from a different context.
      // We check if it's still a "plain" object by looking at the constructor name.
      if (proto.constructor?.name === "Object") {
        // Fall through to plain object handling
      } else {
        // It's a class instance, Map, Set, Date, Buffer, etc.
        if (value instanceof Date) {
          throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a Date.`);
        }
        if (value instanceof Map) {
          throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a Map.`);
        }
        if (value instanceof Set) {
          throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a Set.`);
        }
        if (value instanceof Error) {
          throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains an Error.`);
        }
        if (globalThis.Buffer && value instanceof globalThis.Buffer) {
          throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a Buffer.`);
        }
        if (ArrayBuffer.isView(value)) {
          throw new OpenFlowError(ErrorCode.WORKFLOW_INVALID_CALL, `${label} contains a TypedArray or DataView.`);
        }
        // General rejection for class instances or complex types
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_INVALID_CALL,
          `${label} contains an unsupported object type: ${value.constructor?.name || "Unknown"}`
        );
      }
    }


    seen.add(value);
    const cloned: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get || descriptor?.set) {
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_INVALID_CALL,
          `${label}.${key} contains accessors.`
        );
      }
      const val = cloneRecursive((value as any)[key], `${label}.${key}`, seen);
      if (val !== undefined) {
        cloned[key] = val;
      }
    }
    seen.delete(value);
    return cloned;
  }

  // Fallback for anything else (shouldn't really happen with above checks)
  throw new OpenFlowError(
    ErrorCode.WORKFLOW_INVALID_CALL,
    `${label} contains an unsupported value: ${value}`
  );
}
