import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { validateWorkflowService } from "../../../src/cli/commands/validate.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import * as fs from "node:fs";
import * as path from "node:path";

// Mock other service imports so validate runs in sandbox
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

let mockConfig: any = {
  cwd: "/mock-cwd",
  workflow: { maxLoopRounds: 10 },
  sharedAgents: { maxDefinitions: 100, allowDynamicIds: false },
  tools: { maxDefinitions: 100 },
  _normalizedDiscovery: { workflow: {}, sharedAgents: {}, tools: {} },
  _configDiagnostics: [],
  profiles: {}
};

vi.mock("../../../src/config/load.js", () => ({
  loadConfig: vi.fn().mockImplementation(() => Promise.resolve(mockConfig))
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

describe("Validate Command Profile Options", () => {
  const tempDir = path.resolve(process.cwd(), "tests/unit/cli/tmp-fixtures");

  beforeEach(() => {
    vi.clearAllMocks();
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    mockConfig = {
      cwd: tempDir,
      workflow: { maxLoopRounds: 10 },
      sharedAgents: { maxDefinitions: 100, allowDynamicIds: false },
      tools: { maxDefinitions: 100 },
      _normalizedDiscovery: { workflow: {}, sharedAgents: {}, tools: {} },
      _configDiagnostics: [],
      profiles: {}
    };

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
        { sourcePath: path.resolve(tempDir, "valid-simple.js"), name: "valid-simple" }
      ]
    } as any);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("inline selected profile passes and calls precollection", async () => {
    mockConfig.profiles = {
      fast: {
        description: "Fast profile description",
        args: { x: 1 }
      }
    };

    const res = await validateWorkflowService({
      workflowFile: "valid-simple.js",
      rawOptions: {
        cwd: tempDir,
        profile: "fast"
      }
    });

    expect(res.workflowName).toBe("valid-simple");
    expect(precollectAllResourcesForLoad).toHaveBeenCalledTimes(1);
  });

  it("external selected profile passes and calls precollection", async () => {
    const yamlContent = `
profiles:
  ci:
    description: "CI profile"
    args: { y: 2 }
`;
    const ymlPath = path.join(tempDir, ".profiles.yml");
    fs.writeFileSync(ymlPath, yamlContent);

    const res = await validateWorkflowService({
      workflowFile: "valid-simple.js",
      rawOptions: {
        cwd: tempDir,
        profiles: ".profiles.yml",
        profile: "ci"
      }
    });

    expect(res.workflowName).toBe("valid-simple");
    expect(precollectAllResourcesForLoad).toHaveBeenCalledTimes(1);
  });

  it("missing profile throws PROFILE_NOT_FOUND and prevents precollection", async () => {
    await expect(
      validateWorkflowService({
        workflowFile: "valid-simple.js",
        rawOptions: {
          cwd: tempDir,
          profile: "non-existent"
        }
      })
    ).rejects.toThrow(expect.objectContaining({
      code: "PROFILE_NOT_FOUND"
    }));

    expect(precollectAllResourcesForLoad).not.toHaveBeenCalled();
  });

  it("inheritance cycle throws PROFILE_VALIDATION_ERROR and prevents precollection", async () => {
    mockConfig.profiles = {
      a: { extends: "b" },
      b: { extends: "a" }
    };

    await expect(
      validateWorkflowService({
        workflowFile: "valid-simple.js",
        rawOptions: {
          cwd: tempDir,
          profile: "a"
        }
      })
    ).rejects.toThrow(expect.objectContaining({
      code: "PROFILE_VALIDATION_ERROR"
    }));

    expect(precollectAllResourcesForLoad).not.toHaveBeenCalled();
  });

  it("missing base throws PROFILE_NOT_FOUND and prevents precollection", async () => {
    mockConfig.profiles = {
      child: { extends: "missing-base" }
    };

    await expect(
      validateWorkflowService({
        workflowFile: "valid-simple.js",
        rawOptions: {
          cwd: tempDir,
          profile: "child"
        }
      })
    ).rejects.toThrow(expect.objectContaining({
      code: "PROFILE_NOT_FOUND"
    }));

    expect(precollectAllResourcesForLoad).not.toHaveBeenCalled();
  });

  it("--profiles alone loads and schema-validates the external file, returns unused warning, and continues", async () => {
    const yamlContent = `
profiles:
  ci:
    description: "CI profile"
    args: { y: 2 }
`;
    const ymlPath = path.join(tempDir, ".profiles.yml");
    fs.writeFileSync(ymlPath, yamlContent);

    const res = await validateWorkflowService({
      workflowFile: "valid-simple.js",
      rawOptions: {
        cwd: tempDir,
        profiles: ".profiles.yml"
      }
    });

    expect(res.workflowName).toBe("valid-simple");
    expect(precollectAllResourcesForLoad).toHaveBeenCalledTimes(1);
    expect(res.profileDiagnostics).toHaveLength(1);
    expect(res.profileDiagnostics![0]).toEqual(expect.objectContaining({
      severity: "warning",
      code: "PROFILE_UNUSED_FILE"
    }));
  });

  it("without flags, validate behavior is unchanged and no profile diagnostics are returned", async () => {
    const res = await validateWorkflowService({
      workflowFile: "valid-simple.js",
      rawOptions: {
        cwd: tempDir
      }
    });

    expect(res.workflowName).toBe("valid-simple");
    expect(precollectAllResourcesForLoad).toHaveBeenCalledTimes(1);
    expect(res.profileDiagnostics).toEqual([]);
  });
});
