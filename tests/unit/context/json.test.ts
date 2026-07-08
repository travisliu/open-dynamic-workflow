import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { ErrorCode } from "../../../src/errors/codes.js";
import {
  cloneJsonValue,
  serializedJsonByteLength,
  validateJsonValue,
} from "../../../src/context/json.js";

function expectJsonValidationError(fn: () => unknown, code: ErrorCode, message?: string) {
  expect(fn).toThrow(
    expect.objectContaining({
      code,
      ...(message ? { message: expect.stringContaining(message) } : {}),
    })
  );
}

describe("Workflow Context JSON Validation", () => {
  it("accepts JSON-safe values and returns deep clones", () => {
    // Arrange
    const cases = [
      null,
      true,
      false,
      42,
      3.14,
      "hello",
      [1, "two", null],
      { a: 1, b: "two", c: [null] },
    ];

    // Act / Assert
    for (const c of cases) {
      const result = validateJsonValue(c, { operation: "set", path: "test" });
      expect(result.value).toEqual(c);
      expect(result.serializedBytes).toBe(Buffer.byteLength(JSON.stringify(c), "utf8"));
    }

    // Arrange
    const source = { nested: { list: [1, 2] } };

    // Act
    const cloned = cloneJsonValue(source, "test");

    // Assert
    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned.nested).not.toBe(source.nested);
  });

  it("rejects unsafe primitive values", () => {
    // Arrange
    const cases: Array<[unknown, string]> = [
      [undefined, "value cannot be undefined"],
      [() => {}, "type function is not JSON-safe"],
      [Symbol("test"), "type symbol is not JSON-safe"],
      [42n, "type bigint is not JSON-safe"],
    ];

    // Act / Assert
    for (const [value, message] of cases) {
      expectJsonValidationError(
        () => validateJsonValue(value, { operation: "set", path: "test" }),
        ErrorCode.CONTEXT_INVALID_VALUE,
        message
      );
    }
  });

  it("rejects unsupported object-like values and cycles", () => {
    // Arrange
    class MyClass {
      foo = "bar";
    }
    const unsupportedProto = Object.create({ inherited: true });
    unsupportedProto.foo = "bar";
    const cycleObj: any = { a: 1 };
    cycleObj.self = cycleObj;
    const cycleArr: any = [1];
    cycleArr.push(cycleArr);

    // Act / Assert
    expectJsonValidationError(
      () => validateJsonValue(new Date(), { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );
    expectJsonValidationError(
      () => validateJsonValue(new Map(), { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );
    expectJsonValidationError(
      () => validateJsonValue(new Set(), { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );
    expectJsonValidationError(
      () => validateJsonValue(new WeakMap(), { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );
    expectJsonValidationError(
      () => validateJsonValue(new WeakSet(), { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );
    expectJsonValidationError(
      () => validateJsonValue(new MyClass(), { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );
    expectJsonValidationError(
      () => validateJsonValue(unsupportedProto, { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );
    expectJsonValidationError(
      () => validateJsonValue(cycleObj, { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "cyclic object structure detected"
    );
    expectJsonValidationError(
      () => validateJsonValue(cycleArr, { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "cyclic object structure detected"
    );
  });

  it("rejects non-finite numbers", () => {
    // Arrange
    const cases = [NaN, Infinity, -Infinity];

    // Act / Assert
    for (const c of cases) {
      expectJsonValidationError(
        () => validateJsonValue(c, { operation: "set", path: "test" }),
        ErrorCode.CONTEXT_INVALID_VALUE,
        "number must be finite"
      );
    }
  });

  it("computes UTF-8 byte length and enforces exact size boundaries", () => {
    // Arrange
    const value = { label: "é🙂", nested: ["ß", "東京"] };
    const expectedBytes = Buffer.byteLength(JSON.stringify(value), "utf8");

    // Act
    const measuredBytes = serializedJsonByteLength(value);
    const atLimit = validateJsonValue(value, { operation: "set", path: "test", maxBytes: expectedBytes });

    // Assert
    expect(measuredBytes).toBe(expectedBytes);
    expect(atLimit.serializedBytes).toBe(expectedBytes);
    expect(atLimit.value).toEqual(value);

    // Act / Assert
    expectJsonValidationError(
      () => validateJsonValue(value, { operation: "set", path: "test", maxBytes: expectedBytes - 1 }),
      ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED
    );
  });

  it("handles own __proto__ keys without prototype pollution and strictly rejects unsupported custom prototypes", () => {
    // Arrange
    const payload = JSON.parse('{"__proto__":{"polluted":true},"ok":1}');

    // Act
    const result = validateJsonValue(payload, { operation: "set", path: "test" });
    const clone = result.value as any;

    // Assert
    expect(Object.prototype.hasOwnProperty.call(clone, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
    expect(clone.__proto__).toEqual({ polluted: true });
    expect(clone.ok).toBe(1);

    // Arrange - custom prototype with Object constructor
    const customProto = Object.create(null);
    customProto.constructor = Object;
    const valueWithCustomProto = Object.create(customProto);
    valueWithCustomProto.foo = "bar";

    // Act / Assert
    expectJsonValidationError(
      () => validateJsonValue(valueWithCustomProto, { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );

    // Arrange - custom prototype with spoofed constructor name 'Object'
    function FakeConstructor() {}
    Object.defineProperty(FakeConstructor, "name", { value: "Object" });
    const spoofedProto = { inherited: true };
    FakeConstructor.prototype = spoofedProto;
    (spoofedProto as any).constructor = FakeConstructor;
    const valueWithSpoofedProto = Object.create(spoofedProto);
    valueWithSpoofedProto.foo = "bar";

    // Act / Assert
    expectJsonValidationError(
      () => validateJsonValue(valueWithSpoofedProto, { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );

    // Arrange - cross-realm object using Node's vm module
    const realmObject = vm.runInNewContext("({ foo: 'bar' })");

    // Act / Assert
    expectJsonValidationError(
      () => validateJsonValue(realmObject, { operation: "set", path: "test" }),
      ErrorCode.CONTEXT_INVALID_VALUE,
      "plain object or array"
    );
  });
});
