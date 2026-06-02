import { describe, expect, it } from "vitest";
import { appendModelArg } from "../../../src/agents/model-args.js";
import { ExecflowError } from "../../../src/errors/types.js";

describe("appendModelArg", () => {
  it("does not modify args if model is undefined", () => {
    const args: string[] = ["run"];
    appendModelArg(args, undefined, undefined, "--model");
    expect(args).toEqual(["run"]);
  });

  it("throws MODEL_NOT_SUPPORTED when model is requested but modelArg is false", () => {
    const args: string[] = ["run"];
    expect(() => appendModelArg(args, "some-model", false, "--model")).toThrow(ExecflowError);
    try {
      appendModelArg(args, "some-model", false, "--model");
    } catch (err: any) {
      expect(err.code).toBe("MODEL_NOT_SUPPORTED");
      expect(err.message).toContain("Model selection is not supported by this provider");
    }
  });

  it("appends default flag and model if modelArg is undefined", () => {
    const args: string[] = ["run"];
    appendModelArg(args, "some-model", undefined, "-m");
    expect(args).toEqual(["run", "-m", "some-model"]);
  });

  it("appends custom flag and model if modelArg config has a flag", () => {
    const args: string[] = ["run"];
    appendModelArg(args, "some-model", { flag: "--custom-flag" }, "-m");
    expect(args).toEqual(["run", "--custom-flag", "some-model"]);
  });
});
