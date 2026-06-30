import { describe, expect, it, vi, beforeEach } from "vitest";
import { runCommand } from "../../../src/cli/commands/run.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import type { RuntimeRunner, WorkflowRunResult } from "../../../src/runtime/public.js";
import * as fs from "node:fs";

// Mock imports
import { precollectAllResourcesForLoad, checkDiscoveryPolicy } from "../../../src/discovery/precollect.js";
import { resolveWorkflowTarget } from "../../../src/workflow/resolve-target.js";
import { loadSharedAgentRegistry } from "../../../src/shared-agents/load.js";
import { loadToolRegistry } from "../../../src/tools/load.js";
import { discoverWorkflowRegistry } from "../../../src/workflow/discovery.js";
import { FileSystemArtifactStore } from "../../../src/artifacts/run-store.js";
import { createReporter } from "../../../src/output/reporter.js";

const mockLoadInputWorkflow = { candidateFiles: ["workflow.js"], discoveryPolicy: { exclude: [] } };
const mockLoadInputAgents = { candidateFiles: ["agent.js"], discoveryPolicy: { exclude: [] } };
const mockLoadInputTools = { candidateFiles: ["tool.js"], discoveryPolicy: { exclude: [] } };

const mockPrecollected = {
  workflow: {
    loadInput: mockLoadInputWorkflow,
    collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
  },
  sharedAgents: {
    loadInput: mockLoadInputAgents,
    collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
  },
  tools: {
    loadInput: mockLoadInputTools,
    collectionResult: { files: [], configDiagnostics: [], diagnostics: [] }
  }
};

vi.mock("../../../src/config/load.js", () => ({
  loadConfig: vi.fn().mockImplementation(async (input: any) => ({
    cwd: "/mock-cwd",
    configPath: "/mock-config.yaml",
    outDir: "/mock-out",
    defaultProvider: input?.cli?.provider ?? "mock-provider",
    defaultModel: input?.cli?.model ?? "mock-model",
    providers: {},
    reporting: { mode: "silent", verbose: false },
    workflow: { maxLoopRounds: 10 },
    sharedAgents: { maxDefinitions: 100, allowDynamicIds: false },
    tools: { maxDefinitions: 100 },
    _normalizedDiscovery: { workflow: {}, sharedAgents: {}, tools: {} },
    _configDiagnostics: []
  }))
}));

vi.mock("../../../src/discovery/precollect.js", () => ({
  precollectAllResourcesForLoad: vi.fn(),
  checkDiscoveryPolicy: vi.fn()
}));

vi.mock("../../../src/workflow/resolve-target.js", () => ({
  resolveWorkflowTarget: vi.fn()
}));

vi.mock("../../../src/shared-agents/load.js", () => ({
  loadSharedAgentRegistry: vi.fn()
}));

vi.mock("../../../src/tools/load.js", () => ({
  loadToolRegistry: vi.fn()
}));

vi.mock("../../../src/workflow/discovery.js", () => ({
  discoverWorkflowRegistry: vi.fn()
}));

const mockStoreInstance = {
  createRun: vi.fn().mockResolvedValue(undefined),
  writeJson: vi.fn().mockResolvedValue(undefined),
  writeFinalReport: vi.fn().mockResolvedValue(undefined),
  isRunCreated: vi.fn().mockReturnValue(true),
  getRunArtifacts: vi.fn().mockReturnValue({}),
};

vi.mock("../../../src/artifacts/run-store.js", () => {
  return {
    FileSystemArtifactStore: vi.fn().mockImplementation(() => mockStoreInstance)
  };
});

const mockReporterInstance = {
  handle: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
};

vi.mock("../../../src/output/reporter.js", () => ({
  createReporter: vi.fn().mockImplementation(() => mockReporterInstance)
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

describe("Run Command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(precollectAllResourcesForLoad).mockResolvedValue(mockPrecollected);
    vi.mocked(checkDiscoveryPolicy).mockResolvedValue(undefined);
    vi.mocked(resolveWorkflowTarget).mockResolvedValue({
      workflowFile: "valid-simple.js",
      workflowFileRelative: "workflows/valid-simple.js",
      candidatePaths: [],
      requestedTarget: "valid-simple.js",
      workflowName: "valid-simple"
    });
    vi.mocked(loadSharedAgentRegistry).mockResolvedValue({ registry: "sharedAgents" } as any);
    vi.mocked(loadToolRegistry).mockResolvedValue({ registry: "tools" } as any);
    vi.mocked(discoverWorkflowRegistry).mockResolvedValue({
      list: () => [
        {
          sourcePath: "/mock-cwd/valid-simple.js",
          name: "valid-simple",
          parsedWorkflow: {
            meta: { description: "description", phases: [] },
            sourceText: "source",
            sourceHash: "hash"
          }
        }
      ]
    } as any);
  });

  it("valid dry-run does not call runtime but precollects and loads successfully", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };

    await runCommand({
      workflowFile: "valid-simple.js",
      rawOptions: { dryRun: true, cwd: "/mock-cwd" },
      deps: { runtimeRunner: mockRunner }
    });

    expect(precollectAllResourcesForLoad).toHaveBeenCalledWith({
      cwd: "/mock-cwd",
      discovery: { workflow: {}, sharedAgents: {}, tools: {} },
      strict: false
    });
    expect(checkDiscoveryPolicy).toHaveBeenCalledWith("run", [], mockPrecollected, "/mock-cwd");
    expect(loadSharedAgentRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputAgents
    }));
    expect(loadToolRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputTools
    }));
    expect(discoverWorkflowRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputWorkflow
    }));
    expect(runSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Dry run: valid-simple"));
    logSpy.mockRestore();
  });

  it("valid non-dry-run calls runtime once and asserts order", async () => {
    const runSpy = vi.fn().mockResolvedValue({
      schemaVersion: "open-dynamic-workflow.report.v1",
      runId: "test-run",
      status: "succeeded",
      durationMs: 10,
      artifactsDir: "runs",
      agents: []
    } as WorkflowRunResult);
    const mockRunner: RuntimeRunner = { run: runSpy };

    const callOrder: string[] = [];

    vi.mocked(precollectAllResourcesForLoad).mockImplementation(async () => {
      callOrder.push("precollect");
      return mockPrecollected;
    });
    vi.mocked(checkDiscoveryPolicy).mockImplementation(async () => {
      callOrder.push("policy");
    });
    vi.mocked(resolveWorkflowTarget).mockImplementation(async () => {
      callOrder.push("target");
      return {
        workflowFile: "valid-simple.js",
        workflowFileRelative: "workflows/valid-simple.js",
        candidatePaths: [],
        requestedTarget: "valid-simple.js",
        workflowName: "valid-simple"
      };
    });

    await runCommand({
      workflowFile: "valid-simple.js",
      rawOptions: { cwd: "/mock-cwd" },
      deps: { runtimeRunner: mockRunner }
    });

    expect(callOrder).toEqual(["precollect", "policy", "target"]);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(loadSharedAgentRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputAgents
    }));
    expect(loadToolRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputTools
    }));
    expect(discoverWorkflowRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputWorkflow
    }));
  });

  it("invalid workflow fails before runtime", async () => {
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };
    vi.mocked(discoverWorkflowRegistry).mockRejectedValue(
      new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, "invalid workflow")
    );

    await expect(
      runCommand({
        workflowFile: "invalid-pipeline.js",
        rawOptions: {},
        deps: { runtimeRunner: mockRunner }
      })
    ).rejects.toThrow(OpenDynamicWorkflowError);

    expect(runSpy).not.toHaveBeenCalled();
  });

  it("strict policy failure rejects and creates no run artifact and calls no loader", async () => {
    const runSpy = vi.fn();
    const mockRunner: RuntimeRunner = { run: runSpy };
    vi.mocked(checkDiscoveryPolicy).mockRejectedValue(
      new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_DISCOVERY_FAILED, "Discovery policy blocked loading")
    );

    await expect(
      runCommand({
        workflowFile: "valid-simple.js",
        rawOptions: { strict: true },
        deps: { runtimeRunner: mockRunner }
      })
    ).rejects.toThrow(expect.objectContaining({
      code: "WORKFLOW_DISCOVERY_FAILED"
    }));

    expect(runSpy).not.toHaveBeenCalled();
    expect(resolveWorkflowTarget).not.toHaveBeenCalled();
    expect(loadSharedAgentRegistry).not.toHaveBeenCalled();
    expect(loadToolRegistry).not.toHaveBeenCalled();
    expect(discoverWorkflowRegistry).not.toHaveBeenCalled();
    expect(FileSystemArtifactStore).not.toHaveBeenCalled();
    expect(mockStoreInstance.createRun).not.toHaveBeenCalled();
    expect(mockStoreInstance.writeJson).not.toHaveBeenCalled();
    expect(createReporter).not.toHaveBeenCalled();
  });

  it("strict-mode run Command passes strict: true and run-strict diagnostic context", async () => {
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
      workflowFile: "valid-simple.js",
      rawOptions: { strict: true, cwd: "/mock-cwd" },
      deps: { runtimeRunner: mockRunner }
    });

    expect(precollectAllResourcesForLoad).toHaveBeenCalledWith({
      cwd: "/mock-cwd",
      discovery: { workflow: {}, sharedAgents: {}, tools: {} },
      strict: true
    });
    expect(checkDiscoveryPolicy).toHaveBeenCalledWith("run-strict", [], mockPrecollected, "/mock-cwd");
    expect(loadSharedAgentRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputAgents
    }));
    expect(loadToolRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputTools
    }));
    expect(discoverWorkflowRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputWorkflow
    }));
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
        workflowFile: "valid-simple.js",
        rawOptions: {},
        deps: { runtimeRunner: mockRunner }
      })
    ).rejects.toThrow(OpenDynamicWorkflowError);

    try {
      await runCommand({
        workflowFile: "valid-simple.js",
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
      workflowFile: "valid-simple.js",
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

  describe("initialization hints", () => {
    it("attaches hint to preflight failure (target not found) when config is missing", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes("config.yaml") || p.toString().includes(".open-dynamic-workflow")) {
          return false;
        }
        return true;
      });
      vi.mocked(resolveWorkflowTarget).mockRejectedValue(
        new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_TARGET_NOT_FOUND, "target not found")
      );
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
  });
});
