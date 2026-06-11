import { describe, it, expect } from "vitest";
import { normalizeWorkflowCall } from "../../../src/workflow/workflow-call.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";

describe("workflow call normalization", () => {
  it("normalizes a minimal call", () => {
    const normalized = normalizeWorkflowCall({ name: "child" });
    expect(normalized).toEqual({
      name: "child",
      args: {},
      failureMode: "throw",
      timeoutMs: undefined,
      concurrency: undefined,
      metadata: undefined
    });
  });

  it("normalizes a full call", () => {
    const input = {
      name: "child",
      args: { a: 1 },
      failureMode: "settled" as const,
      timeoutMs: 1000,
      concurrency: 2,
      metadata: { source: "test" }
    };
    const normalized = normalizeWorkflowCall(input);
    expect(normalized).toEqual(input);
    expect(normalized.args).not.toBe(input.args);
    expect(normalized.metadata).not.toBe(input.metadata);
  });

  it("rejects non-object input", () => {
    expect(() => normalizeWorkflowCall(null)).toThrow("must be an object");
    expect(() => normalizeWorkflowCall("string")).toThrow("must be an object");
  });

  it("rejects missing or invalid name", () => {
    expect(() => normalizeWorkflowCall({})).toThrow("valid 'name' string");
    expect(() => normalizeWorkflowCall({ name: "" })).toThrow("cannot be empty");
    expect(() => normalizeWorkflowCall({ name: "   " })).toThrow("cannot be empty");
  });

  it("rejects path-like names", () => {
    const cases = [
      "subdir/child",
      "child.ts",
      "..\\child",
      "file:child",
      "file:///child",
      "./child",
      "../child",
      "/child",
      "\\\\server\\\\child",
      "C:\\\\child",
      "safe/../child"
    ];
    for (const name of cases) {
      expect(() => normalizeWorkflowCall({ name })).toThrow("cannot be a path");
    }
  });

  it("rejects invalid failureMode", () => {
    expect(() => normalizeWorkflowCall({ name: "child", failureMode: "invalid" as any })).toThrow("must be 'throw' or 'settled'");
  });

  it("rejects invalid timeoutMs", () => {
    expect(() => normalizeWorkflowCall({ name: "child", timeoutMs: -1 })).toThrow("positive integer");
    expect(() => normalizeWorkflowCall({ name: "child", timeoutMs: 0 })).toThrow("positive integer");
    expect(() => normalizeWorkflowCall({ name: "child", timeoutMs: 1.5 })).toThrow("positive integer");
    expect(() => normalizeWorkflowCall({ name: "child", timeoutMs: "1000" as any })).toThrow("positive integer");
  });

  it("rejects invalid concurrency", () => {
    expect(() => normalizeWorkflowCall({ name: "child", concurrency: 0 })).toThrow("positive integer");
    expect(() => normalizeWorkflowCall({ name: "child", concurrency: -5 })).toThrow("positive integer");
  });
});
