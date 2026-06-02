import type { JsonSchema, ProviderParsedResult } from "../types/index.js";
import { extractJson } from "./extract-json.js";
import { validateJson } from "./validate-json.js";

export type NormalizedOutputResult =
  | { ok: true; text?: string; json?: unknown }
  | { ok: false; error: { message: string; code: string; errors?: unknown[] } };

export async function normalizeAgentOutput(input: {
  schema?: JsonSchema;
  parsed: ProviderParsedResult;
  stdout: string;
}): Promise<NormalizedOutputResult> {
  const { schema, parsed, stdout } = input;

  if (schema) {
    let candidate: unknown = undefined;
    let found = false;

    // 1. Use parsed.json if available
    if (parsed.json !== undefined) {
      candidate = parsed.json;
      found = true;
    }

    // 2. Use JSON parsed from parsed.text if available
    if (!found && parsed.text !== undefined) {
      try {
        candidate = JSON.parse(parsed.text.trim());
        found = true;
      } catch {
        // Ignore and try next
      }
    }

    // 3. Extract JSON from stdout
    if (!found) {
      const extracted = extractJson(stdout);
      if (extracted.ok) {
        candidate = extracted.value;
        found = true;
      }
    }

    if (!found) {
      return {
        ok: false,
        error: {
          message: "Failed to extract JSON from provider output to validate against schema.",
          code: "SCHEMA_VALIDATION_FAILED"
        }
      };
    }

    // 4. Validate candidate JSON against schema
    const validation = validateJson(candidate, schema);
    if (validation.ok) {
      return {
        ok: true,
        json: candidate,
        text: typeof candidate === "string" ? candidate : JSON.stringify(candidate)
      };
    } else {
      return {
        ok: false,
        error: {
          message: validation.message,
          code: "SCHEMA_VALIDATION_FAILED",
          errors: validation.errors
        }
      };
    }
  }

  // Without a schema:
  // 1. Prefer parsed.text
  if (parsed.text !== undefined) {
    return {
      ok: true,
      text: parsed.text,
      json: parsed.json
    };
  }

  // 2. If text is missing but JSON exists, expose JSON
  if (parsed.json !== undefined) {
    return {
      ok: true,
      text: typeof parsed.json === "string" ? parsed.json : JSON.stringify(parsed.json),
      json: parsed.json
    };
  }

  // 3. Fall back to raw stdout as text
  return {
    ok: true,
    text: stdout,
    json: undefined
  };
}
