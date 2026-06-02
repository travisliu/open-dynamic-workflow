import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../../../src/cli/commands/run.js";
import { ExecflowError } from "../../../src/errors/types.js";
import type { RuntimeRunner, WorkflowRunResult } from "../../../src/runtime/public.js";
import { resolve } from "node:path";

describe("CLI Run Model Option", () => {
  const validFixturePath = resolve(process.cwd(), "tests/fixtures/workflows/valid-simple.js");

  it("CLI model option sets defaultModel in config and maps to run input cli properties", async () => {
    const runSpy = vi.fn().mockResolvedValue({
      schemaVersion: "execflow.report.v1",
      runId: "test-run",
      status: "succeeded",
      durationMs: 10,
      artifactsDir: "runs",
      agents: []
    } as WorkflowRunResult);
    const mockRunner: RuntimeRunner = { run: runSpy };

    await runCommand({
      workflowFile: validFixturePath,
      rawOptions: { model: "my-custom-model" },
      deps: { runtimeRunner: mockRunner }
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          defaultModel: "my-custom-model"
        }),
        cli: expect.objectContaining({
          model: "my-custom-model"
        })
      }),
      expect.anything()
    );
  });

  it("fails if CLI model option is an empty string", async () => {
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };

    await expect(
      runCommand({
        workflowFile: validFixturePath,
        rawOptions: { model: "   " },
        deps: { runtimeRunner: mockRunner }
      })
    ).rejects.toThrow(ExecflowError);

    try {
      await runCommand({
        workflowFile: validFixturePath,
        rawOptions: { model: "   " },
        deps: { runtimeRunner: mockRunner }
      });
    } catch (err: any) {
      expect(err.code).toBe("CLI_USAGE_ERROR");
      expect(err.message).toContain("value must be a non-empty string");
    }

    expect(runSpy).not.toHaveBeenCalled();
  });
});
