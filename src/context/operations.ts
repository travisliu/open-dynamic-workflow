import { contextTypeMismatch } from "./errors.js";
import { cloneJsonValue, isJsonPlainObject } from "./json.js";
import type { ContextOperationName } from "./types.js";

function traverse(
  store: Record<string, any>,
  segments: string[],
  operation: ContextOperationName,
  fullPath: string,
  isWrite: boolean
): Record<string, any> | undefined {
  let current = store;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]!;
    if (current[key] === undefined || current[key] === null) {
      if (isWrite) {
        current[key] = {};
      } else {
        return undefined;
      }
    }
    current = current[key];
    if (Array.isArray(current)) {
      throw contextTypeMismatch(
        operation,
        fullPath,
        `Cannot traverse through array at segment '${key}'`
      );
    }
    if (typeof current !== "object") {
      if (isWrite) {
        throw contextTypeMismatch(
          operation,
          fullPath,
          `Cannot traverse through non-object at segment '${key}'`
        );
      } else {
        return undefined;
      }
    }
  }
  return current;
}

export function contextGet(
  store: Record<string, any>,
  segments: string[],
  operation: ContextOperationName,
  fullPath: string
): unknown {
  const parent = traverse(store, segments, operation, fullPath, false);
  if (!parent) return undefined;
  const key = segments[segments.length - 1]!;
  const val = parent[key];
  return val !== undefined ? cloneJsonValue(val) : undefined;
}

export function contextHas(
  store: Record<string, any>,
  segments: string[],
  operation: ContextOperationName,
  fullPath: string
): boolean {
  const parent = traverse(store, segments, operation, fullPath, false);
  if (!parent) return false;
  const key = segments[segments.length - 1]!;
  return parent[key] !== undefined;
}

export function contextSet(
  store: Record<string, any>,
  segments: string[],
  value: unknown,
  operation: ContextOperationName,
  fullPath: string
): void {
  const cloned = cloneJsonValue(value);
  const parent = traverse(store, segments, operation, fullPath, true);
  const key = segments[segments.length - 1]!;
  Object.defineProperty(parent!, key, {
    value: cloned,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function contextDelete(
  store: Record<string, any>,
  segments: string[],
  operation: ContextOperationName,
  fullPath: string
): boolean {
  const parent = traverse(store, segments, operation, fullPath, false);
  if (!parent) return false;
  const key = segments[segments.length - 1]!;
  if (parent[key] === undefined) {
    return false;
  }
  delete parent[key];
  return true;
}

export function contextMerge(
  store: Record<string, any>,
  segments: string[],
  value: Record<string, any>,
  operation: ContextOperationName,
  fullPath: string
): void {
  if (!isJsonPlainObject(value)) {
    throw contextTypeMismatch(operation, fullPath, "Merge input must be a plain object");
  }

  // Clone all keys first to verify they are valid JSON before mutating the store
  const clonedEntries: [string, unknown][] = [];
  for (const k of Object.keys(value)) {
    clonedEntries.push([k, cloneJsonValue(value[k])]);
  }

  // Check target validity before mutating
  const existingParent = traverse(store, segments, operation, fullPath, false);
  if (existingParent !== undefined) {
    const key = segments[segments.length - 1]!;
    const target = existingParent[key];
    if (target !== undefined && target !== null) {
      if (!isJsonPlainObject(target)) {
        throw contextTypeMismatch(operation, fullPath, "Cannot merge into non-object target");
      }
    }
  }

  const parent = traverse(store, segments, operation, fullPath, true);
  const key = segments[segments.length - 1]!;
  let target = parent![key];

  if (target === undefined || target === null) {
    target = {};
    Object.defineProperty(parent!, key, {
      value: target,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    if (!isJsonPlainObject(target)) {
      throw contextTypeMismatch(operation, fullPath, "Cannot merge into non-object target");
    }
  }

  for (const [k, clonedVal] of clonedEntries) {
    Object.defineProperty(target, k, {
      value: clonedVal,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

export function contextAppend(
  store: Record<string, any>,
  segments: string[],
  value: unknown,
  operation: ContextOperationName,
  fullPath: string
): void {
  // Clone first
  const cloned = cloneJsonValue(value);

  // Check target validity before mutating
  const existingParent = traverse(store, segments, operation, fullPath, false);
  if (existingParent !== undefined) {
    const key = segments[segments.length - 1]!;
    const target = existingParent[key];
    if (target !== undefined && target !== null && !Array.isArray(target)) {
      throw contextTypeMismatch(operation, fullPath, "Cannot append to non-array target");
    }
  }

  const parent = traverse(store, segments, operation, fullPath, true);
  const key = segments[segments.length - 1]!;
  let target = parent![key];

  if (target === undefined || target === null) {
    target = [];
    Object.defineProperty(parent!, key, {
      value: target,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    if (!Array.isArray(target)) {
      throw contextTypeMismatch(operation, fullPath, "Cannot append to non-array target");
    }
  }

  target.push(cloned);
}
