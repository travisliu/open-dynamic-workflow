import { describe, expect, it } from "vitest";
import { validateJson } from "../../../src/structured/validate-json.js";

describe("validateJson", () => {
  const schema = {
    type: "object",
    required: ["name", "age"],
    properties: {
      name: { type: "string" },
      age: { type: "integer" }
    }
  };

  it("validates correct object", () => {
    const value = { name: "Alice", age: 30 };
    const result = validateJson(value, schema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(value);
    }
  });

  it("rejects missing required field", () => {
    const value = { name: "Alice" };
    const result = validateJson(value, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SCHEMA_VALIDATION_FAILED");
      expect(result.message).toContain("must have required property 'age'");
    }
  });

  it("rejects wrong type", () => {
    const value = { name: "Alice", age: "thirty" };
    const result = validateJson(value, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SCHEMA_VALIDATION_FAILED");
      expect(result.message).toContain("age must be integer");
    }
  });

  it("handles invalid schema by throwing an error", () => {
    const invalidSchema = {
      type: "invalid_type_xyz"
    };

    expect(() => validateJson({}, invalidSchema as any)).toThrow("Invalid JSON Schema");
  });
});
