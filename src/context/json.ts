import { contextInvalidValue } from "./errors.js";
import { assertWithinContextValueLimit } from "./limits.js";
import type { ContextOperationName } from "./types.js";
import type { JsonValue } from "../types/common.js";

export function isJsonPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function validateJsonValue(
  value: unknown,
  options: { operation: ContextOperationName; path: string; maxBytes?: number }
): { value: JsonValue; serializedBytes: number } {
  const { operation, path, maxBytes } = options;
  const seen = new Set<unknown>();

  function checkAndClone(val: unknown, currentPath: string): JsonValue {
    if (val === undefined) {
      throw contextInvalidValue(operation, path, `value cannot be undefined`);
    }
    if (val === null) {
      return null;
    }
    const type = typeof val;
    if (type === "boolean") {
      return val as boolean;
    }
    if (type === "string") {
      return val as string;
    }
    if (type === "number") {
      const num = val as number;
      if (!Number.isFinite(num)) {
        throw contextInvalidValue(operation, path, `number must be finite (received ${num})`);
      }
      return num;
    }
    if (type === "bigint" || type === "symbol" || type === "function") {
      throw contextInvalidValue(operation, path, `type ${type} is not JSON-safe`);
    }

    // Objects and arrays
    if (type === "object") {
      if (seen.has(val)) {
        throw contextInvalidValue(operation, path, `cyclic object structure detected`);
      }
      seen.add(val);

      if (Array.isArray(val)) {
        const clonedArr: JsonValue[] = [];
        for (let i = 0; i < val.length; i++) {
          clonedArr.push(checkAndClone(val[i], `${currentPath}[${i}]`));
        }
        seen.delete(val);
        return clonedArr;
      }

      // Check for Date, Map, Set, class instances
      if (!isJsonPlainObject(val)) {
        const proto = Object.getPrototypeOf(val);
        throw contextInvalidValue(
          operation,
          path,
          `value is not a plain object or array (prototype: ${proto?.constructor?.name || "unknown"})`
        );
      }

      // Plain object
      const clonedObj: Record<string, JsonValue> = {};
      const keys = Object.keys(val as object);
      for (const key of keys) {
        const clonedValue = checkAndClone((val as Record<string, unknown>)[key], `${currentPath}.${key}`);
        Object.defineProperty(clonedObj, key, {
          value: clonedValue,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      seen.delete(val);
      return clonedObj;
    }

    throw contextInvalidValue(operation, path, `type ${type} is not JSON-safe`);
  }

  const cloned = checkAndClone(value, path);
  let serializedBytes: number;
  try {
    const stringified = JSON.stringify(cloned);
    serializedBytes = Buffer.byteLength(stringified, "utf8");
  } catch (err: any) {
    throw contextInvalidValue(operation, path, `failed to serialize value to JSON: ${err.message}`);
  }

  if (maxBytes !== undefined) {
    assertWithinContextValueLimit(serializedBytes, operation, path, maxBytes);
  }

  return {
    value: cloned,
    serializedBytes,
  };
}

export function cloneJsonValue(value: unknown, contextLabel?: string): JsonValue {
  // Use validateJsonValue with dummy path/operation but without maxBytes by default
  const { value: cloned } = validateJsonValue(value, {
    operation: "set",
    path: contextLabel || "root",
  });
  return cloned;
}

export function serializedJsonByteLength(value: unknown): number {
  const { serializedBytes } = validateJsonValue(value, {
    operation: "get",
    path: "root",
  });
  return serializedBytes;
}
