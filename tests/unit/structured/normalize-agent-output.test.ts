import { describe, expect, it } from "vitest";
import { normalizeAgentOutput } from "../../../src/structured/normalize-agent-output.js";

describe("normalizeAgentOutput", () => {
  const schema = {
    type: "object",
    required: ["value"],
    properties: {
      value: { type: "string" }
    }
  };

  it("schema uses provider JSON if available", async () => {
    const result = await normalizeAgentOutput({
      schema,
      parsed: { json: { value: "from-provider-json" } },
      stdout: "raw stdout"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toEqual({ value: "from-provider-json" });
    }
  });

  it("schema parses from provider text if available", async () => {
    const result = await normalizeAgentOutput({
      schema,
      parsed: { text: '{"value": "from-provider-text"}' },
      stdout: "raw stdout"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toEqual({ value: "from-provider-text" });
    }
  });

  it("schema extracts JSON from stdout if parsed lacks it", async () => {
    const result = await normalizeAgentOutput({
      schema,
      parsed: {},
      stdout: 'some preamble\n```json\n{"value": "from-stdout"}\n```'
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toEqual({ value: "from-stdout" });
    }
  });

  it("schema failure when no JSON exists", async () => {
    const result = await normalizeAgentOutput({
      schema,
      parsed: {},
      stdout: "raw text with no JSON"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SCHEMA_VALIDATION_FAILED");
      expect(result.error.message).toContain("Failed to extract JSON");
    }
  });

  it("schema failure when JSON shape is invalid", async () => {
    const result = await normalizeAgentOutput({
      schema,
      parsed: { json: { incorrectKey: "value" } },
      stdout: ""
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SCHEMA_VALIDATION_FAILED");
      expect(result.error.message).toContain("must have required property 'value'");
    }
  });

  it("no-schema: prefers parsed.text", async () => {
    const result = await normalizeAgentOutput({
      parsed: { text: "hello parsed text", json: { val: 1 } },
      stdout: "raw stdout"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("hello parsed text");
      expect(result.json).toEqual({ val: 1 });
    }
  });

  it("no-schema: exposes JSON if text is missing but JSON exists", async () => {
    const result = await normalizeAgentOutput({
      parsed: { json: { val: 1 } },
      stdout: "raw stdout"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('{"val":1}');
      expect(result.json).toEqual({ val: 1 });
    }
  });

  it("no-schema: falls back to raw stdout as text", async () => {
    const result = await normalizeAgentOutput({
      parsed: {},
      stdout: "raw stdout text fallback"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("raw stdout text fallback");
      expect(result.json).toBeUndefined();
    }
  });
});
