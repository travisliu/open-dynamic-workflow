import { describe, expect, it } from "vitest";
import { validateAndNormalizeLoopArgs, validateLoopRunResult } from "../../../src/loop/validate.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";

describe("Loop Validation Helpers", () => {
  const ceiling = 20;
  const mockRun = () => {};

  it("accepts valid minimal arguments", () => {
    const result = validateAndNormalizeLoopArgs(
      {
        label: "test-loop",
        initialState: { ok: true },
        options: { maxRounds: 5 },
        run: mockRun,
      },
      ceiling
    );
    expect(result.label).toBe("test-loop");
    expect(result.options.maxRounds).toBe(5);
    expect(result.options.failureMode).toBe("throw");
  });

  it("throws if input is missing or not a plain object", () => {
    expect(() => validateAndNormalizeLoopArgs(undefined, ceiling)).toThrow(
      "loop() input must be a plain object."
    );
    expect(() => validateAndNormalizeLoopArgs(null, ceiling)).toThrow(
      "loop() input must be a plain object."
    );
    expect(() => validateAndNormalizeLoopArgs("string", ceiling)).toThrow(
      "loop() input must be a plain object."
    );
    expect(() => validateAndNormalizeLoopArgs([], ceiling)).toThrow(
      "loop() input must be a plain object."
    );
  });

  it("throws on unsupported top level keys", () => {
    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          label: "loop",
          initialState: {},
          options: { maxRounds: 5 },
          run: mockRun,
          extraKey: 42,
        },
        ceiling
      )
    ).toThrow("loop() input contains unsupported key 'extraKey'.");
  });

  it("throws if required fields are missing", () => {
    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          initialState: {},
          options: { maxRounds: 5 },
          run: mockRun,
        },
        ceiling
      )
    ).toThrow("loop() missing required field 'label'.");

    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          label: "loop",
          options: { maxRounds: 5 },
          run: mockRun,
        },
        ceiling
      )
    ).toThrow("loop() missing required field 'initialState'.");

    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          label: "loop",
          initialState: {},
          run: mockRun,
        },
        ceiling
      )
    ).toThrow("loop() missing required field 'options'.");

    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          label: "loop",
          initialState: {},
          options: { maxRounds: 5 },
        },
        ceiling
      )
    ).toThrow("loop() missing required field 'run'.");
  });

  it("validates maxRounds against ceiling", () => {
    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          label: "loop",
          initialState: {},
          options: { maxRounds: 21 },
          run: mockRun,
        },
        ceiling
      )
    ).toThrow("exceeds the global ceiling (20)");
  });

  it("throws on unsupported options keys", () => {
    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          label: "loop",
          initialState: {},
          options: { maxRounds: 5, stopWhen: () => true } as any,
          run: mockRun,
        },
        ceiling
      )
    ).toThrow("loop() options contain unsupported key 'stopWhen'.");
  });

  it("validates failureMode values", () => {
    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          label: "loop",
          initialState: {},
          options: { maxRounds: 5, failureMode: "invalid" as any },
          run: mockRun,
        },
        ceiling
      )
    ).toThrow("failureMode must be 'throw' or 'settled'.");
  });

  it("validates timeoutMs is a positive integer", () => {
    expect(() =>
      validateAndNormalizeLoopArgs(
        {
          label: "loop",
          initialState: {},
          options: { maxRounds: 5, timeoutMs: -10 },
          run: mockRun,
        },
        ceiling
      )
    ).toThrow("timeoutMs must be a positive integer.");
  });

  describe("validateLoopRunResult", () => {
    it("accepts valid round result", () => {
      expect(() =>
        validateLoopRunResult({ done: true, nextState: {} }, "test")
      ).not.toThrow();
    });

    it("rejects non-object return values", () => {
      expect(() => validateLoopRunResult(null, "test")).toThrow("non-object value");
      expect(() => validateLoopRunResult("string", "test")).toThrow("non-object value");
    });

    it("rejects missing done or nextState", () => {
      expect(() => validateLoopRunResult({ nextState: {} }, "test")).toThrow("missing required property 'done'");
      expect(() => validateLoopRunResult({ done: true }, "test")).toThrow("missing required property 'nextState'");
    });

    it("rejects deprecated properties", () => {
      expect(() =>
        validateLoopRunResult({ done: true, nextState: {}, result: "some" }, "test")
      ).toThrow("deprecated property 'result'");

      expect(() =>
        validateLoopRunResult({ done: true, nextState: {}, break: true }, "test")
      ).toThrow("deprecated break signal");
    });

    it("rejects unsupported extra keys", () => {
      expect(() =>
        validateLoopRunResult({ done: true, nextState: {}, debug: "x" }, "test")
      ).toThrow("contains unsupported property 'debug'");

      expect(() =>
        validateLoopRunResult({ done: true, nextState: {}, debug: () => {} }, "test")
      ).toThrow("contains unsupported property 'debug'");
    });
  });
});
