import { describe, expect, it, vi, beforeEach } from "vitest";
import { runWorkflowService } from "../../../src/cli/commands/run.js";

// Setup mocks
vi.mock("../../../src/config/load.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    cwd: "/mock-cwd",
    configPath: "/mock-cwd/config.yaml",
    outDir: "/mock-cwd/out",
    workflow: { maxLoopRounds: 10 },
    sharedAgents: { maxDefinitions: 100, allowDynamicIds: false },
    tools: { maxDefinitions: 100 },
    reporting: { mode: "pretty", verbose: false },
    security: { redactEnv: [] },
    _normalizedDiscovery: { workflow: {}, sharedAgents: {}, tools: {} },
    _configDiagnostics: []
  })
}));

const { resolvePreviousRun } = vi.hoisted(() => ({
  resolvePreviousRun: vi.fn().mockResolvedValue({ runDir: "/previous-runs/prev-run-id" }),
}));
vi.mock("../../../src/cli/artifact-paths.js", () => ({
  legacyRunsRoot: vi.fn().mockReturnValue("/mock-cwd/.open-dynamic-workflow/runs"),
  resolvePreviousRun,
}));

const mockRunnerRun = vi.fn().mockResolvedValue({ status: "succeeded", agents: [] });
vi.mock("../../../src/runtime/public.js", () => {
  return {
    DefaultRuntimeRunner: vi.fn().mockImplementation(() => {
      return {
        run: mockRunnerRun
      };
    })
  };
});

vi.mock("../../../src/artifacts/run-store.js", () => {
  return {
    FileSystemArtifactStore: vi.fn().mockImplementation(() => {
      return {
        createRun: vi.fn().mockResolvedValue(undefined),
        writeJson: vi.fn().mockResolvedValue(undefined),
        writeFinalReport: vi.fn().mockResolvedValue(undefined),
        getRunArtifacts: vi.fn().mockReturnValue({ rootDir: "/current-runs/current-run" }),
        isRunCreated: vi.fn().mockReturnValue(true),
      };
    })
  };
});

vi.mock("../../../src/discovery/precollect.js", () => ({
  precollectAllResourcesForLoad: vi.fn().mockResolvedValue({
    workflow: { loadInput: {} },
    sharedAgents: { loadInput: {} },
    tools: { loadInput: {} }
  }),
  checkDiscoveryPolicy: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../../src/workflow/resolve-target.js", () => ({
  resolveWorkflowTarget: vi.fn().mockResolvedValue({
    workflowFile: "workflow.js",
    workflowFileRelative: "workflow.js",
    candidatePaths: [],
    requestedTarget: "workflow.js",
    workflowName: "test-wf"
  })
}));

vi.mock("../../../src/shared-agents/load.js", () => ({
  loadSharedAgentRegistry: vi.fn().mockResolvedValue({})
}));

vi.mock("../../../src/tools/load.js", () => ({
  loadToolRegistry: vi.fn().mockResolvedValue({})
}));

vi.mock("../../../src/workflow/discovery.js", () => ({
  discoverWorkflowRegistry: vi.fn().mockResolvedValue({
    list: () => [
      {
        sourcePath: "/mock-cwd/workflow.js",
        parsedWorkflow: {
          meta: { name: "test-wf", version: "1.0.0" },
          sourceHash: "wf-hash",
          sourceText: "export default workflow(...)"
        }
      }
    ]
  })
}));

describe("runWorkflowService with --resume and profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunnerRun.mockResolvedValue({ status: "succeeded", agents: [] });
  });

  it("does not restore a recorded profile snapshot for run --resume", async () => {
    await runWorkflowService({
      workflowFile: "workflow.js",
      rawOptions: { resume: "prev-run-id" }
    });

    expect(mockRunnerRun).toHaveBeenCalledWith(
      expect.objectContaining({
        profileReport: undefined,
        profileContextSeed: undefined,
        run: expect.objectContaining({ previousRunDir: "/previous-runs/prev-run-id" }),
      }),
      expect.any(Object)
    );
  });

  it("resolves a current profile fresh and fails before previous-run lookup when it is missing", async () => {
    await expect(
      runWorkflowService({
        workflowFile: "workflow.js",
        rawOptions: { resume: "prev-run-id", profile: "some-other-profile" }
      })
    ).rejects.toThrowError(/Profile 'some-other-profile' not found/);
    expect(resolvePreviousRun).not.toHaveBeenCalled();
  });

  it("creates a distinct current run while passing the resolved previous directory", async () => {
    await runWorkflowService({
      workflowFile: "workflow.js",
      rawOptions: { resume: "prev-run-id" }
    });

    expect(mockRunnerRun).toHaveBeenCalledWith(expect.objectContaining({
      run: expect.objectContaining({
        runDir: "/current-runs/current-run",
        previousRunDir: "/previous-runs/prev-run-id",
      }),
    }), expect.any(Object));
  });
});
