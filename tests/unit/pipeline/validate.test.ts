import { describe, expect, it } from "vitest";
import { validateAndNormalizePipelineArgs } from "../../../src/pipeline/validate.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";

describe("Pipeline Argument Validation and Normalization", () => {
  const dummyRun = () => {};

  it("passes with minimal valid arguments and applies defaults", () => {
    const { normalizedItems, normalizedStages, normalizedOptions } = validateAndNormalizePipelineArgs(
      ["item1", "item2"],
      [
        { name: "stage1", run: dummyRun },
        { name: "stage2", run: dummyRun }
      ]
    );

    expect(normalizedItems).toEqual(["item1", "item2"]);
    expect(normalizedStages).toHaveLength(2);
    expect(normalizedStages[0].name).toBe("stage1");
    expect(normalizedOptions).toEqual({
      strategy: "item-streaming",
      preserveOrder: true,
      failFast: false,
      stageConcurrency: {}
    });
  });

  it("rejects when items is not an array", () => {
    expect(() => validateAndNormalizePipelineArgs("not-an-array", [{ name: "stage1", run: dummyRun }])).toThrow(
      InvalidDslCallError
    );
  });

  it("rejects when stages is not an array or is empty", () => {
    expect(() => validateAndNormalizePipelineArgs([], "not-an-array")).toThrow(InvalidDslCallError);
    expect(() => validateAndNormalizePipelineArgs([], [])).toThrow(InvalidDslCallError);
  });

  it("rejects when stage object is invalid", () => {
    expect(() => validateAndNormalizePipelineArgs([], [null])).toThrow(InvalidDslCallError);
    expect(() => validateAndNormalizePipelineArgs([], ["not-an-object"])).toThrow(InvalidDslCallError);
  });

  it("rejects when stage name is missing or invalid", () => {
    expect(() => validateAndNormalizePipelineArgs([], [{ run: dummyRun }])).toThrow(InvalidDslCallError);
    expect(() => validateAndNormalizePipelineArgs([], [{ name: "invalid/name", run: dummyRun }])).toThrow(
      InvalidDslCallError
    );
  });

  it("rejects when stage run is missing or not a function", () => {
    expect(() => validateAndNormalizePipelineArgs([], [{ name: "stage1" }])).toThrow(InvalidDslCallError);
    expect(() => validateAndNormalizePipelineArgs([], [{ name: "stage1", run: "not-a-fn" }])).toThrow(
      InvalidDslCallError
    );
  });

  it("rejects duplicate stage names", () => {
    expect(() =>
      validateAndNormalizePipelineArgs(
        [],
        [
          { name: "stage1", run: dummyRun },
          { name: "stage1", run: dummyRun }
        ]
      )
    ).toThrow(InvalidDslCallError);
  });

  it("rejects invalid strategy in options", () => {
    expect(() =>
      validateAndNormalizePipelineArgs(
        [],
        [{ name: "stage1", run: dummyRun }],
        { strategy: "waterfall" }
      )
    ).toThrow(InvalidDslCallError);
  });

  it("accepts valid options and parses them correctly", () => {
    const { normalizedOptions } = validateAndNormalizePipelineArgs(
      [],
      [{ name: "stage1", run: dummyRun }],
      {
        strategy: "stage-barrier",
        concurrency: 5,
        preserveOrder: false,
        failFast: true,
        stageConcurrency: { stage1: 2 }
      }
    );

    expect(normalizedOptions).toEqual({
      strategy: "stage-barrier",
      concurrency: 5,
      preserveOrder: false,
      failFast: true,
      stageConcurrency: { stage1: 2 }
    });
  });

  it("rejects invalid concurrency in options", () => {
    expect(() =>
      validateAndNormalizePipelineArgs(
        [],
        [{ name: "stage1", run: dummyRun }],
        { concurrency: -1 }
      )
    ).toThrow(InvalidDslCallError);

    expect(() =>
      validateAndNormalizePipelineArgs(
        [],
        [{ name: "stage1", run: dummyRun }],
        { concurrency: 0.5 }
      )
    ).toThrow(InvalidDslCallError);
  });

  it("rejects stageConcurrency with unknown stages", () => {
    expect(() =>
      validateAndNormalizePipelineArgs(
        [],
        [{ name: "stage1", run: dummyRun }],
        { stageConcurrency: { unknownStage: 2 } }
      )
    ).toThrow(InvalidDslCallError);
  });

  it("rejects stageConcurrency with invalid value", () => {
    expect(() =>
      validateAndNormalizePipelineArgs(
        [],
        [{ name: "stage1", run: dummyRun }],
        { stageConcurrency: { stage1: -2 } }
      )
    ).toThrow(InvalidDslCallError);
  });

  it("rejects unsupported keys in options", () => {
    expect(() =>
      validateAndNormalizePipelineArgs(
        [],
        [{ name: "stage1", run: dummyRun }],
        { retry: 3 }
      )
    ).toThrow(InvalidDslCallError);
  });

  it("rejects context option as unsupported", () => {
    expect(() =>
      validateAndNormalizePipelineArgs(
        [],
        [{ name: "stage1", run: dummyRun }],
        { context: { merge: { x: "replace" } } } as any
      )
    ).toThrow(/unsupported.*context|context.*unsupported/i);
  });

  it("proves normalized options do not have context property", () => {
    const { normalizedOptions } = validateAndNormalizePipelineArgs(
      [],
      [{ name: "stage1", run: dummyRun }],
      { strategy: "stage-barrier" }
    );
    expect(Object.prototype.hasOwnProperty.call(normalizedOptions, "context")).toBe(false);
  });
});

