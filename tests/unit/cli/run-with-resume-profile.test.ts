import { describe, expect, it, vi, beforeEach } from "vitest";
import { runWorkflowService } from "../../../src/cli/commands/run.js";
import { readRunInput } from "../../../src/cli/run-input.js";
import { DefaultRuntimeRunner } from "../../../src/runtime/public.js";
import type { RecordedRunProfileInput } from "../../../src/types/artifacts.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

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

vi.mock("../../../src/cli/run-input.ts", () => ({
  readRunInput: vi.fn(),
  resolveRunRoot: vi.fn().mockReturnValue("/mock-run-root"),
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
        getRunArtifacts: vi.fn().mockReturnValue({}),
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
  const dummyProfile: RecordedRunProfileInput = {
    selected: "recorded-profile",
    source: "external",
    resolved: {
      description: "Recorded profile description",
      args: { arg1: "recorded-val-1", arg2: "recorded-val-2" },
      context: { ctx1: "recorded-ctx-1" },
      run: { provider: "recorded-provider" }
    },
    hash: "recorded-hash",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunnerRun.mockResolvedValue({ status: "succeeded", agents: [] });
  });

  it("retrieves and injects recorded profile data before runtime on run --resume", async () => {
    vi.mocked(readRunInput).mockResolvedValue({
      previousRunRoot: "/mock-run-root",
      runInput: {
        schemaVersion: "open-dynamic-workflow.run-input.v1",
        runId: "prev-run-id",
        workflowFile: "workflow.js",
        profile: dummyProfile,
      }
    });

    await runWorkflowService({
      workflowFile: "workflow.js",
      rawOptions: { resume: "prev-run-id" }
    });

    expect(readRunInput).toHaveBeenCalledWith("prev-run-id", undefined, expect.any(String));
    
    // Prove it was injected into runtime runner
    expect(mockRunnerRun).toHaveBeenCalledWith(
      expect.objectContaining({
        profileReport: expect.objectContaining({
          selected: "recorded-profile",
          source: "recorded",
          hash: "recorded-hash"
        }),
        profileContextSeed: expect.objectContaining({
          context: { ctx1: "recorded-ctx-1" },
          metadata: expect.objectContaining({
            name: "recorded-profile",
            source: "recorded",
            hash: "recorded-hash"
          })
        })
      }),
      expect.any(Object)
    );
  });

  it("forces fresh resolution when current invocation includes --profile", async () => {
    vi.mocked(readRunInput).mockResolvedValue({
      previousRunRoot: "/mock-run-root",
      runInput: {
        schemaVersion: "open-dynamic-workflow.run-input.v1",
        runId: "prev-run-id",
        workflowFile: "workflow.js",
        profile: dummyProfile,
      }
    });

    // Fresh resolution tries to look up profile which does not exist in mock config, thus throwing PROFILE_NOT_FOUND
    await expect(
      runWorkflowService({
        workflowFile: "workflow.js",
        rawOptions: { resume: "prev-run-id", profile: "some-other-profile" }
      })
    ).rejects.toThrowError(/Profile 'some-other-profile' not found/);
  });

  it("handles legacy no-profile artifact run-input resume gracefully", async () => {
    vi.mocked(readRunInput).mockResolvedValue({
      previousRunRoot: "/mock-run-root",
      runInput: {
        schemaVersion: "open-dynamic-workflow.run-input.v1",
        runId: "prev-run-id",
        workflowFile: "workflow.js",
        profile: undefined,
      }
    });

    await runWorkflowService({
      workflowFile: "workflow.js",
      rawOptions: { resume: "prev-run-id" }
    });

    expect(mockRunnerRun).toHaveBeenCalledWith(
      expect.objectContaining({
        profileReport: undefined,
        profileContextSeed: undefined
      }),
      expect.any(Object)
    );
  });
});
