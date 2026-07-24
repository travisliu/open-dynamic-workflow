import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ErrorCode } from "../../../src/errors/codes.js";
import { normalizeRunInput, readRunInput } from "../../../src/cli/run-input.js";

const created: string[] = [];
afterEach(async () => { await Promise.all(created.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

const profile = { selected: "dev", source: "config", hash: "abc", resolved: { args: {}, context: {}, run: { provider: "mock" } } };

describe("run-input reader", () => {
  it("normalizes v1 replay fields while retaining output only as audit metadata", () => {
    const raw = {
      schemaVersion: "open-dynamic-workflow.run-input.v1", runId: "old", workflowFile: "flow.js", cwd: "/old",
      outDir: "/old/runs", rawOptions: { arg: ["x=1"], out: "/ignored", provider: "mock" }, profile,
    };
    const input = normalizeRunInput(raw);
    expect(input.invocation).toMatchObject({ args: ["x=1"], provider: "mock" });
    expect(input.output).toEqual({ effectiveRunsRoot: "/old/runs" });
    expect(input.output?.explicitCliOut).toBeUndefined();
    expect(input.recordedProfileName).toBe("dev");
    input.invocation.args.push("y=2");
    expect(raw.rawOptions.arg).toEqual(["x=1"]);
  });

  it("normalizes v2 and rejects contradictory profile audit metadata", () => {
    const raw = {
      schemaVersion: "open-dynamic-workflow.run-input.v2", runId: "new", workflowFile: "flow.js", requestedTarget: "flow", targetKind: "workflow-name", workflowName: "flow", cwd: "/project",
      output: { effectiveRunsRoot: "/runs", source: "profile", selectedProfile: "dev", explicitCliOut: "relative-runs" },
      invocation: { args: ["x=1"], noCache: false, failFast: true, verbose: false }, profile,
    } as const;
    expect(normalizeRunInput(raw)).toMatchObject({ output: raw.output, recordedProfileName: "dev" });
    expect(() => normalizeRunInput({ ...raw, output: { ...raw.output, selectedProfile: "other" } })).toThrow(/disagrees/);
  });

  it("rejects malformed structural data and preserves profile validation errors", () => {
    expect(() => normalizeRunInput({ schemaVersion: "other", workflowFile: "x" })).toThrow(/schema/);
    expect(() => normalizeRunInput({ schemaVersion: "open-dynamic-workflow.run-input.v1", workflowFile: "", rawOptions: {} })).toThrow(/workflowFile/);
    expect(() => normalizeRunInput({ schemaVersion: "open-dynamic-workflow.run-input.v2", runId: "x", workflowFile: "f", requestedTarget: "f", targetKind: "workflow-file", workflowName: "f", cwd: "/x", output: { effectiveRunsRoot: "/x", source: "unknown" }, invocation: { args: [], noCache: false, failFast: false, verbose: false } })).toThrow(/output.source/);
    try {
      normalizeRunInput({ schemaVersion: "open-dynamic-workflow.run-input.v1", workflowFile: "f", profile: {} });
      throw new Error("expected profile error");
    } catch (error: any) {
      expect(error.code).toBe(ErrorCode.PROFILE_VALIDATION_ERROR);
    }
  });

  it("reads only an absolute previous directory and maps unreadable input to usage errors", async () => {
    await expect(readRunInput("relative-run")).rejects.toMatchObject({ code: ErrorCode.CLI_USAGE_ERROR });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-run-input-"));
    created.push(dir);
    await expect(readRunInput(dir)).rejects.toMatchObject({ code: ErrorCode.CLI_USAGE_ERROR });
    await fs.writeFile(path.join(dir, "run-input.json"), "{bad", "utf8");
    await expect(readRunInput(dir)).rejects.toMatchObject({ code: ErrorCode.CLI_USAGE_ERROR });
  });
});
