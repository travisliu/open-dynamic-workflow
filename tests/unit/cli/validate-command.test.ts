import { describe, expect, it, vi, beforeEach } from "vitest";
import { validateCommand } from "../../../src/cli/commands/validate.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import * as fs from "node:fs";

// Mock imports
import { precollectAllResourcesForLoad, checkDiscoveryPolicy } from "../../../src/discovery/precollect.js";
import { resolveWorkflowTarget } from "../../../src/workflow/resolve-target.js";
import { loadSharedAgentRegistry } from "../../../src/shared-agents/load.js";
import { loadToolRegistry } from "../../../src/tools/load.js";
import { discoverWorkflowRegistry } from "../../../src/workflow/discovery.js";

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
  loadConfig: vi.fn().mockResolvedValue({
    cwd: "/mock-cwd",
    workflow: { maxLoopRounds: 10 },
    sharedAgents: { maxDefinitions: 100, allowDynamicIds: false },
    tools: { maxDefinitions: 100 },
    _normalizedDiscovery: { workflow: {}, sharedAgents: {}, tools: {} },
    _configDiagnostics: []
  })
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

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

describe("Validate Command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(precollectAllResourcesForLoad).mockResolvedValue(mockPrecollected);
    vi.mocked(checkDiscoveryPolicy).mockResolvedValue(undefined);
    vi.mocked(resolveWorkflowTarget).mockResolvedValue({
      workflowFile: "valid-simple.js",
      workflowFileRelative: "workflows/valid-simple.js",
      candidatePaths: [],
      requestedTarget: "valid-simple.js"
    });
    vi.mocked(loadSharedAgentRegistry).mockResolvedValue({ registry: "sharedAgents" } as any);
    vi.mocked(loadToolRegistry).mockResolvedValue({ registry: "tools" } as any);
    vi.mocked(discoverWorkflowRegistry).mockResolvedValue({
      list: () => [
        { sourcePath: "/mock-cwd/valid-simple.js", name: "valid-simple" }
      ]
    } as any);
  });

  it("valid workflow prints success and asserts the Phase 2 contract", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
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
        requestedTarget: "valid-simple.js"
      };
    });

    await expect(
      validateCommand({
        workflowFile: "valid-simple.js",
        rawOptions: { cwd: "/mock-cwd" }
      })
    ).resolves.not.toThrow();

    // Assert ordering contract
    expect(callOrder).toEqual(["precollect", "policy", "target"]);

    // 1. precollectAllResourcesForLoad is called after config load
    expect(precollectAllResourcesForLoad).toHaveBeenCalledWith({
      cwd: "/mock-cwd",
      discovery: { workflow: {}, sharedAgents: {}, tools: {} },
      strict: false
    });

    expect(checkDiscoveryPolicy).toHaveBeenCalledWith("validate", [], mockPrecollected, "/mock-cwd");

    // 3. loaders receive matching precollected.*.loadInput objects
    expect(loadSharedAgentRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputAgents
    }));
    expect(loadToolRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputTools
    }));
    expect(discoverWorkflowRegistry).toHaveBeenCalledWith(expect.objectContaining({
      precollected: mockLoadInputWorkflow
    }));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("✓ Validated workflow \"valid-simple\" at"));
    logSpy.mockRestore();
  });

  it("invalid workflow throws WORKFLOW_VALIDATION_ERROR", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(discoverWorkflowRegistry).mockRejectedValue(
      new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, "invalid workflow")
    );

    await expect(
      validateCommand({
        workflowFile: "invalid-pipeline.js",
        rawOptions: {}
      })
    ).rejects.toThrow(OpenDynamicWorkflowError);

    logSpy.mockRestore();
  });

  it("fails closed on policy check rejection and invokes no resource loader or resolver", async () => {
    vi.mocked(checkDiscoveryPolicy).mockRejectedValue(
      new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_DISCOVERY_FAILED, "Discovery policy blocked loading")
    );

    await expect(
      validateCommand({
        workflowFile: "some-file.js",
        rawOptions: { strict: true }
      })
    ).rejects.toThrow(expect.objectContaining({
      code: "WORKFLOW_DISCOVERY_FAILED"
    }));

    expect(resolveWorkflowTarget).not.toHaveBeenCalled();
    expect(loadSharedAgentRegistry).not.toHaveBeenCalled();
    expect(loadToolRegistry).not.toHaveBeenCalled();
    expect(discoverWorkflowRegistry).not.toHaveBeenCalled();
  });

  it("strict-mode validate Command passes strict: true and validate-strict diagnostic context", async () => {
    await expect(
      validateCommand({
        workflowFile: "valid-simple.js",
        rawOptions: { strict: true, cwd: "/mock-cwd" }
      })
    ).resolves.not.toThrow();

    expect(precollectAllResourcesForLoad).toHaveBeenCalledWith({
      cwd: "/mock-cwd",
      discovery: { workflow: {}, sharedAgents: {}, tools: {} },
      strict: true
    });
    expect(checkDiscoveryPolicy).toHaveBeenCalledWith("validate-strict", [], mockPrecollected, "/mock-cwd");
  });

  describe("initialization hints", () => {
    it("attaches hint to eligible target resolution failure when config is missing", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes("config.yaml") || p.toString().includes(".open-dynamic-workflow")) {
          return false;
        }
        return true;
      });
      vi.mocked(resolveWorkflowTarget).mockRejectedValue(
        new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_TARGET_NOT_FOUND, "target not found")
      );

      await expect(
        validateCommand({
          workflowFile: "non-existent-workflow",
          rawOptions: {},
        })
      ).rejects.toThrow(expect.objectContaining({
        code: "WORKFLOW_TARGET_NOT_FOUND",
        hint: expect.objectContaining({
          code: "PROJECT_INIT_MISSING",
        }),
      }));
    });

    it("does not attach hint to eligible target resolution failure when config exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(resolveWorkflowTarget).mockRejectedValue(
        new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_TARGET_NOT_FOUND, "target not found")
      );

      await expect(
        validateCommand({
          workflowFile: "non-existent-workflow",
          rawOptions: {},
        })
      ).rejects.toThrow(expect.objectContaining({
        code: "WORKFLOW_TARGET_NOT_FOUND",
        hint: undefined,
      }));
    });

    it("does not attach hint to ineligible workflow validation errors even when config is missing", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes("config.yaml") || p.toString().includes(".open-dynamic-workflow")) {
          return false;
        }
        return true;
      });
      vi.mocked(discoverWorkflowRegistry).mockRejectedValue(
        new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_VALIDATION_ERROR, "some other validation error")
      );

      await expect(
        validateCommand({
          workflowFile: "invalid-pipeline.js",
          rawOptions: {},
        })
      ).rejects.toThrow(expect.objectContaining({
        code: "WORKFLOW_VALIDATION_ERROR",
        hint: undefined,
      }));
    });
  });
});
