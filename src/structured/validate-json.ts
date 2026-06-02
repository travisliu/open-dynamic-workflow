import AjvModule from "ajv";
import type { JsonSchema } from "../types/index.js";
const Ajv = (AjvModule as any).default || AjvModule;
const ajv = new Ajv();

export interface JsonValidationSuccess {
  ok: true;
  value: unknown;
}

export interface JsonValidationFailure {
  ok: false;
  code: "SCHEMA_VALIDATION_FAILED";
  message: string;
  errors: unknown[];
}

export type JsonValidationResult = JsonValidationSuccess | JsonValidationFailure;

export function validateJson(value: unknown, schema: JsonSchema): JsonValidationResult {
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    throw new Error(`Invalid JSON Schema: ${(err as Error).message}`);
  }

  const valid = validate(value);
  if (valid) {
    return {
      ok: true,
      value
    };
  } else {
    const errors = validate.errors ?? [];
    const message = errors
      .map((e: any) => `${e.instancePath || "root"} ${e.message}`)
      .join(", ");
    return {
      ok: false,
      code: "SCHEMA_VALIDATION_FAILED",
      message: `Schema validation failed: ${message}`,
      errors
    };
  }
}
