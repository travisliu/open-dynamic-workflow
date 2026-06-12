import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { JsonValue } from "../types/common.js";
import { cloneJsonValue } from "../workflow/json.js";
import { redactText } from "../security/env.js";

export interface SerializationOptions {
  secrets?: string[];
  maxStringLength?: number;
  maxArrayLength?: number;
  maxObjectFields?: number;
  maxDepth?: number;
}

export function redactAndBoundValue(value: unknown, options: SerializationOptions = {}, depth = 0): any {
  const {
    secrets = [],
    maxStringLength = 10000,
    maxArrayLength = 100,
    maxObjectFields = 50,
    maxDepth = 10
  } = options;

  if (value === null || value === undefined) return value;
  
  if (depth > maxDepth) return "[RECURSION_LIMIT]";

  if (typeof value === "string") {
    let redacted = redactText(value, secrets);
    if (redacted.length > maxStringLength) {
      redacted = redacted.substring(0, maxStringLength) + "... [TRUNCATED]";
    }
    return redacted;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const bounded = value.slice(0, maxArrayLength).map(item => redactAndBoundValue(item, options, depth + 1));
    if (value.length > maxArrayLength) {
      bounded.push(`... [${value.length - maxArrayLength} more items]`);
    }
    return bounded;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (keys.length === 0) return {};
    const bounded: Record<string, any> = {};
    for (const key of keys.slice(0, maxObjectFields)) {
      bounded[key] = redactAndBoundValue((value as any)[key], options, depth + 1);
    }
    if (keys.length > maxObjectFields) {
      bounded["..."] = `${keys.length - maxObjectFields} more fields`;
    }
    return bounded;
  }

  return String(value);
}

export function serializeToolValue(value: unknown, label: string, secrets: string[] = []): JsonValue {
  try {
    // 1. Ensure it's valid JSON-clonable
    const cloned = cloneJsonValue(value, label);
    // 2. Redact and bound
    return redactAndBoundValue(cloned, { secrets });
  } catch (error) {
    if (error instanceof OpenFlowError && error.code === ErrorCode.WORKFLOW_INVALID_CALL) {
      throw new OpenFlowError(
        ErrorCode.TOOL_SERIALIZATION_FAILED,
        error.message,
        { cause: error }
      );
    }
    throw error;
  }
}

export function createPreview(value: unknown, secrets: string[] = []): unknown {
  return redactAndBoundValue(value, {
    secrets,
    maxStringLength: 1000,
    maxArrayLength: 5,
    maxObjectFields: 5,
    maxDepth: 3
  });
}
