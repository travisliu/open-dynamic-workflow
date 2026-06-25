import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../../../src/cli/commands/run.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import type { RuntimeRunner, WorkflowRunResult } from "../../../src/runtime/public.js";
import { resolve } from "node:path";
import * as fs from "node:fs";

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

  describe("initialization hints", () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReset();
    });

    afterEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it("attaches hint to preflight failure (target not found) when config is missing", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes("config.yaml") || p.toString().includes(".open-dynamic-workflow")) {
          return false;
        }
        return true;
      });
      const mockRunner: RuntimeRunner = { run: vi.fn() };

      await expect(
        runCommand({
          workflowFile: "non-existent-workflow",
          rawOptions: {},
          deps: { runtimeRunner: mockRunner }
        })
      ).rejects.toThrow(expect.objectContaining({
        code: "WORKFLOW_TARGET_NOT_FOUND",
        hint: expect.objectContaining({
          code: "PROJECT_INIT_MISSING",
        }),
      }));
    });

    it("does not attach hint to runtime failures after execution starts", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes("config.yaml") || p.toString().includes(".open-dynamic-workflow")) {
          return false;
        }
        return true;
      });
      
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
      ).rejects.toThrow(expect.objectContaining({
        code: "PROVIDER_PROCESS_FAILED",
        hint: undefined,
      }));
    });
  });
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    promises: {
      ...actual.promises,
      stat: vi.fn().mockImplementation(async (p: any) => {
        if (p.toString().includes("workflows") || p.toString().includes("agents") || p.toString().includes("tools")) {
          return {
            isDirectory: () => true,
          } as any;
        }
        return actual.promises.stat(p);
      }),
      readdir: vi.fn().mockImplementation(async (p: any) => {
        if (p.toString().includes("workflows") || p.toString().includes("agents") || p.toString().includes("tools")) {
          return [];
        }
        return actual.promises.readdir(p);
      }),
    },
  };
});


