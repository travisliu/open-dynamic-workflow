import { describe, it, expect } from "vitest";
import { cloneJsonValue, cloneJsonObject } from "../../../src/workflow/json.js";
import { OpenFlowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("workflow json cloning", () => {
  it("clones primitives", () => {
    expect(cloneJsonValue("hello", "test")).toBe("hello");
    expect(cloneJsonValue(123, "test")).toBe(123);
    expect(cloneJsonValue(true, "test")).toBe(true);
    expect(cloneJsonValue(null, "test")).toBe(null);
  });

  it("clones plain objects and arrays", () => {
    const input = { a: 1, b: [2, 3], c: { d: "e" } };
    const cloned = cloneJsonValue(input, "test");
    expect(cloned).toEqual(input);
    expect(cloned).not.toBe(input);
    expect((cloned as any).b).not.toBe(input.b);
    expect((cloned as any).c).not.toBe(input.c);
  });

  it("rejects undefined values at any level", () => {
    expect(() => cloneJsonValue(undefined, "test")).toThrow(OpenFlowError);
    expect(() => cloneJsonValue({ a: undefined, b: 1 }, "test")).toThrow(OpenFlowError);
    expect(() => cloneJsonValue([undefined, 1], "test")).toThrow(OpenFlowError);
  });

  it("rejects functions", () => {
    expect(() => cloneJsonValue(() => {}, "test")).toThrow(OpenFlowError);
    expect(() => cloneJsonValue({ a: () => {} }, "test")).toThrow(OpenFlowError);
  });

  it("rejects circular references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(() => cloneJsonValue(obj, "test")).toThrow("circular reference");
  });

  it("rejects Promises", () => {
    expect(() => cloneJsonValue(Promise.resolve(), "test")).toThrow("Promise or thenable");
    expect(() => cloneJsonValue({ a: Promise.resolve() }, "test")).toThrow("Promise or thenable");
  });

  it("rejects non-plain objects", () => {
    expect(() => cloneJsonValue(new Date(), "test")).toThrow("contains a Date");
    expect(() => cloneJsonValue(new Map(), "test")).toThrow("contains a Map");
    expect(() => cloneJsonValue(new Set(), "test")).toThrow("contains a Set");
  });

  it("rejects getters", () => {
    const obj = {};
    Object.defineProperty(obj, "a", { get: () => 1, enumerable: true });
    expect(() => cloneJsonValue(obj, "test")).toThrow("contains accessors");
  });

  it("clones null-prototype objects", () => {
    const obj = Object.create(null);
    obj.a = 1;
    const cloned = cloneJsonValue(obj, "test");
    expect(cloned).toEqual({ a: 1 });
  });

  it("cloneJsonObject enforces object return", () => {
    expect(cloneJsonObject({ a: 1 }, "test")).toEqual({ a: 1 });
    expect(() => cloneJsonObject("string", "test")).toThrow("must be a plain object");
    expect(() => cloneJsonObject([], "test")).toThrow("must be a plain object");
    expect(() => cloneJsonObject(null, "test")).toThrow("must be a plain object");
  });
});
