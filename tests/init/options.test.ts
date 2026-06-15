import { describe, it, expect, vi } from "vitest";
import { parseInitOptions, parseInitReportMode } from "../../src/cli/args.js";
import { OpenFlowError } from "../../src/errors/types.js";
import { ErrorCode } from "../../src/errors/codes.js";

describe("init options parsing", () => {
  it("parses all options correctly", () => {
    const raw = {
      cwd: "/test",
      yes: true,
      provider: "codex",
      force: true,
      strict: false,
      runSmokeTest: true,
      report: "json",
      workflowsDir: "wf",
      agentsDir: "ag",
      toolsDir: "tl"
    };
    const parsed = parseInitOptions(raw);
    expect(parsed).toEqual({
      cwd: "/test",
      yes: true,
      provider: "codex",
      force: true,
      strict: false,
      runSmokeTest: true,
      report: "json",
      workflowsDir: "wf",
      agentsDir: "ag",
      toolsDir: "tl"
    });
  });

  it("handles missing optional values", () => {
    const raw = {};
    const parsed = parseInitOptions(raw);
    expect(parsed).toEqual({
      cwd: undefined,
      yes: false,
      provider: undefined,
      force: false,
      strict: false,
      runSmokeTest: false,
      report: undefined,
      workflowsDir: undefined,
      agentsDir: undefined,
      toolsDir: undefined
    });
  });

  it("fails on invalid report mode", () => {
    expect(() => parseInitReportMode("invalid")).toThrow(OpenFlowError);
    expect(() => parseInitReportMode("invalid")).toThrow(expect.objectContaining({
      code: ErrorCode.CLI_USAGE_ERROR
    }));
  });
});
