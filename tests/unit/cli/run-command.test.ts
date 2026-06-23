import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../../../src/cli/commands/run.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import type { RuntimeRunner, WorkflowRunResult } from "../../../src/runtime/public.js";
import { resolve } from "node:path";

describe("Run Command", () => {
  const validFixturePath = resolve(process.cwd(), "tests/fixtures/workflows/valid-simple.js");
  const invalidFixturePath = resolve(process.cwd(), "tests/fixtures/workflows/invalid-pipeline.js");

  it("valid dry-run does not call runtime", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };

    await runCommand({
      workflowFile: validFixturePath,
      rawOptions: { dryRun: true },
      deps: { runtimeRunner: mockRunner }
    });

    expect(runSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Dry run: valid-simple"));
    logSpy.mockRestore();
  });

  it("valid non-dry-run calls runtime once", async () => {
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
      rawOptions: {},
      deps: { runtimeRunner: mockRunner }
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("invalid workflow fails before runtime", async () => {
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };

    await expect(
      runCommand({
        workflowFile: invalidFixturePath,
        rawOptions: {},
        deps: { runtimeRunner: mockRunner }
      })
    ).rejects.toThrow(OpenDynamicWorkflowError);

    expect(runSpy).not.toHaveBeenCalled();
  });

  it("runtime failed result maps to workflow failure", async () => {
    const runSpy = vi.fn().mockResolvedValue({
      schemaVersion: "open-dynamic-workflow.report.v1",
      runId: "test-run",
      status: "failed",
      durationMs: 10,
      artifactsDir: "runs",
      agents: [],
      error: new Error("execution failure")
    } as WorkflowRunResult);
    const mockRunner: RuntimeRunner = { run: runSpy };

    await expect(
      runCommand({
        workflowFile: validFixturePath,
        rawOptions: {},
        deps: { runtimeRunner: mockRunner }
      })
    ).rejects.toThrow(OpenDynamicWorkflowError);

    try {
      await runCommand({
        workflowFile: validFixturePath,
        rawOptions: {},
        deps: { runtimeRunner: mockRunner }
      });
    } catch (err: any) {
      expect(err.code).toBe("PROVIDER_PROCESS_FAILED");
    }
  });

  it("CLI provider option sets default provider in runtime input", async () => {
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
      rawOptions: { provider: "codex" },
      deps: { runtimeRunner: mockRunner }
    });

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          defaultProvider: "codex"
        })
      }),
      expect.anything()
    );
  });

  it("CLI max-agent-calls option is passed into runtime input", async () => {
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
      rawOptions: { maxAgentCalls: "3" },
      deps: { runtimeRunner: mockRunner }
    });

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          maxAgentCalls: 3
        }),
        cli: expect.objectContaining({
          maxAgentCalls: 3
        })
      }),
      expect.anything()
    );
  });

  it("invalid max-agent-calls option fails before runtime", async () => {
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };

    await expect(
      runCommand({
        workflowFile: validFixturePath,
        rawOptions: { maxAgentCalls: "0" },
        deps: { runtimeRunner: mockRunner }
      })
    ).rejects.toThrow(OpenDynamicWorkflowError);

    expect(runSpy).not.toHaveBeenCalled();
  });
});
