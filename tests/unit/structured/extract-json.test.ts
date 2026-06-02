import { describe, expect, it } from "vitest";
import { extractJson } from "../../../src/structured/extract-json.js";

describe("extractJson", () => {
  it("parses direct JSON object", () => {
    const stdout = '{"key": "value", "number": 123}';
    const result = extractJson(stdout);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ key: "value", number: 123 });
      expect(result.source).toBe("direct");
    }
  });

  it("parses direct JSON array", () => {
    const stdout = '[1, 2, "three"]';
    const result = extractJson(stdout);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([1, 2, "three"]);
      expect(result.source).toBe("direct");
    }
  });

  it("parses fenced JSON block", () => {
    const stdout = "Some text before\n```json\n{\n  \"nested\": true\n}\n```\nSome text after";
    const result = extractJson(stdout);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ nested: true });
      expect(result.source).toBe("fenced");
    }
  });

  it("parses fenced code block without json language prefix", () => {
    const stdout = "```\n[1, 2]\n```";
    const result = extractJson(stdout);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([1, 2]);
      expect(result.source).toBe("fenced");
    }
  });

  it("extracts balanced JSON structure from within mixed text", () => {
    const stdout = "Here is the result: {\"success\": true} and some other text.";
    const result = extractJson(stdout);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ success: true });
      expect(result.source).toBe("balanced");
    }
  });

  it("fails clearly for malformed JSON", () => {
    const stdout = "{\"key\": ";
    const result = extractJson(stdout);
    expect(result.ok).toBe(false);
  });

  it("ignores normal text when no JSON exists", () => {
    const stdout = "Just some normal text response without any JSON.";
    const result = extractJson(stdout);
    expect(result.ok).toBe(false);
  });
});
