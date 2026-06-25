import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../../../src/cli/commands/run.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import type { RuntimeRunner, WorkflowRunResult } from "../../../src/runtime/public.js";
import { resolve } from "node:path";

describe("CLI Run Thinking Effort Option", () => {
  const validFixturePath = resolve(process.cwd(), "tests/fixtures/workflows/valid-simple.js");

  it("CLI --thinking-effort option is table-driven across all six public values", async () => {
    const allSixValues = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

    for (const effort of allSixValues) {
      const runSpy = vi.fn().mockResolvedValue({
        schemaVersion: "open-dynamic-workflow.report.v1",
        runId: "test-run",
        status: "succeeded",
        durationMs: 10,
        artifactsDir: "runs",
        agents: []
      } as WorkflowRunResult);
      const mockRunner: RuntimeRunner = { run: runSpy };

      await runCommand({
        workflowFile: validFixturePath,
        rawOptions: { thinkingEffort: effort },
        deps: { runtimeRunner: mockRunner }
      });

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cli: expect.objectContaining({
            thinkingEffort: effort
          })
        }),
        expect.anything()
      );
    }
  });

  it("fails if CLI --thinking-effort option is invalid", async () => {
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };

    await expect(
      runCommand({
        workflowFile: validFixturePath,
        rawOptions: { thinkingEffort: "super-high" },
        deps: { runtimeRunner: mockRunner }
      })
    ).rejects.toThrow(OpenDynamicWorkflowError);

    try {
      await runCommand({
        workflowFile: validFixturePath,
        rawOptions: { thinkingEffort: "super-high" },
        deps: { runtimeRunner: mockRunner }
      });
    } catch (err: any) {
      expect(err.code).toBe("CLI_USAGE_ERROR");
      expect(err.message).toContain("Must be one of");
    }

    expect(runSpy).not.toHaveBeenCalled();
  });

  it("proves CLI validation occurs before config loading (with missing config path)", async () => {
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };

    // With a deliberately non-existent config path and invalid thinkingEffort
    let thrownError: any = null;
    try {
      await runCommand({
        workflowFile: validFixturePath,
        rawOptions: {
          config: "/non/existent/config/path.yaml",
          thinkingEffort: "invalid-value"
        },
        deps: { runtimeRunner: mockRunner }
      });
    } catch (err: any) {
      thrownError = err;
    }

    expect(thrownError).not.toBeNull();
    // It should throw CLI_USAGE_ERROR first for thinking-effort instead of config-loading error
    expect(thrownError.code).toBe("CLI_USAGE_ERROR");
    expect(thrownError.message).toContain("Must be one of");
    expect(runSpy).not.toHaveBeenCalled();
  });
});
