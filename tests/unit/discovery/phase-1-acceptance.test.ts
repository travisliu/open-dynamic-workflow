import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../../../src/cli/commands/run.js";
import { validateCommand } from "../../../src/cli/commands/validate.js";
import { evaluateDiscoveryLoadPolicy, applyDiscoveryPolicy } from "../../../src/discovery/policy.js";
import { checkDiscoveryPolicy, precollectResourceForLoad, precollectAllResourcesForLoad } from "../../../src/discovery/precollect.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import * as fs from "node:fs";
import * as path from "node:path";

// Mock config load
let mockConfigDiagnostics: any[] = [];
vi.mock("../../../src/config/load.js", () => ({
  loadConfig: vi.fn().mockImplementation(async () => ({
    cwd: "/mock-cwd",
    configPath: "/mock-config.yaml",
    outDir: "/mock-out",
    defaultProvider: "mock-provider",
    defaultModel: "mock-model",
    providers: {},
    reporting: { mode: "silent", verbose: false },
    workflow: { maxLoopRounds: 10 },
    sharedAgents: { maxDefinitions: 100, allowDynamicIds: false },
    tools: { maxDefinitions: 100 },
    _normalizedDiscovery: {
      workflow: { include: ["**/*.js"] },
      sharedAgents: { include: ["**/*.js"] },
      tools: { include: ["**/*.js"] }
    },
    _configDiagnostics: mockConfigDiagnostics
  }))
}));

// Mock target resolution and registries to verify that they are NOT called
vi.mock("../../../src/workflow/resolve-target.js", () => ({
  resolveWorkflowTarget: vi.fn().mockResolvedValue({
    workflowFile: "valid.js",
    workflowFileRelative: "workflows/valid.js",
    candidatePaths: [],
    requestedTarget: "valid.js",
    workflowName: "valid"
  })
}));

vi.mock("../../../src/shared-agents/load.js", () => ({
  loadSharedAgentRegistry: vi.fn().mockResolvedValue({ registry: {} })
}));

vi.mock("../../../src/tools/load.js", () => ({
  loadToolRegistry: vi.fn().mockResolvedValue({ registry: {} })
}));

vi.mock("../../../src/workflow/discovery.js", () => ({
  discoverWorkflowRegistry: vi.fn().mockResolvedValue({ list: () => [] })
}));

// Mock artifacts and reporter to prevent side effects
const mockStoreInstance = {
  createRun: vi.fn().mockResolvedValue(undefined),
  writeJson: vi.fn().mockResolvedValue(undefined),
  writeFinalReport: vi.fn().mockResolvedValue(undefined),
  isRunCreated: vi.fn().mockReturnValue(true),
  getRunArtifacts: vi.fn().mockReturnValue({}),
};

vi.mock("../../../src/artifacts/run-store.js", () => ({
  FileSystemArtifactStore: vi.fn().mockImplementation(() => mockStoreInstance)
}));

const mockReporterInstance = {
  handle: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
};

vi.mock("../../../src/output/reporter.js", () => ({
  createReporter: vi.fn().mockImplementation(() => mockReporterInstance)
}));

// Mock existsSync specifically to allow test files check but return true for runCommand checks
let mockExistsSync = true;
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockImplementation((pathLike: any) => {
      const p = String(pathLike);
      if (p.includes("temp-aaa-test") || p.includes("workflows") || p.includes("exclude") || p.includes("target")) {
        return actual.existsSync(pathLike);
      }
      return mockExistsSync;
    })
  };
});

// Mock compile count for precollection compilation check
let compileCount = 0;
vi.mock("../../../src/discovery/compile-patterns.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/discovery/compile-patterns.js")>();
  return {
    ...original,
    compileResourceDiscovery: (input: any) => {
      compileCount++;
      return original.compileResourceDiscovery(input);
    }
  };
});

// Mock precollectAllResourcesForLoad so it doesn't try to list the fake /mock-cwd
vi.mock("../../../src/discovery/precollect.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/discovery/precollect.js")>();
  return {
    ...original,
    precollectAllResourcesForLoad: vi.fn().mockImplementation(async () => {
      return {
        workflow: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        },
        sharedAgents: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        },
        tools: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        }
      };
    })
  };
});

describe("Phase 1 Acceptance Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync = true;
    mockConfigDiagnostics = [];
    compileCount = 0;
    vi.mocked(precollectAllResourcesForLoad).mockImplementation(async () => {
      return {
        workflow: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        },
        sharedAgents: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        },
        tools: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        }
      };
    });
  });

  // Acceptance Test Scenario 1
  it("AAA Scenario 1: strict run and validate block on failed discovery policy and halt before resolution or loading", async () => {
    // ----------------------------------------------------
    // ARRANGE:
    // A project configuration with a fatal strict diagnostic
    // which causes the discovery policy check to fail in strict mode.
    // ----------------------------------------------------
    mockConfigDiagnostics = [
      {
        code: "STRICT_FATAL_ERROR",
        message: "This error is fatal in strict mode",
        severity: "error",
        fatalInStrictContext: true,
      },
    ];

    const runDeps = {
      runtimeRunner: { run: vi.fn() },
    };

    // ----------------------------------------------------
    // ACT:
    // Invoke both run and validate commands in strict mode.
    // ----------------------------------------------------
    const actRun = runCommand({
      workflowFile: "test-workflow.js",
      rawOptions: { strict: true, cwd: "/mock-cwd" },
      deps: runDeps,
    });

    const actValidate = validateCommand({
      workflowFile: "test-workflow.js",
      rawOptions: { strict: true, cwd: "/mock-cwd" },
    });

    // ----------------------------------------------------
    // ASSERT:
    // Both commands must throw ErrorCode.WORKFLOW_DISCOVERY_FAILED,
    // and downstream steps (target resolution, loading, runner execution) must not be called.
    // ----------------------------------------------------
    await expect(actRun).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.WORKFLOW_DISCOVERY_FAILED,
      })
    );

    await expect(actValidate).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.WORKFLOW_DISCOVERY_FAILED,
      })
    );

    // Verify blocking: none of the resolution, registry discovery, or loading logic was executed
    const { resolveWorkflowTarget } = await import("../../../src/workflow/resolve-target.js");
    const { loadSharedAgentRegistry } = await import("../../../src/shared-agents/load.js");
    const { loadToolRegistry } = await import("../../../src/tools/load.js");
    const { discoverWorkflowRegistry } = await import("../../../src/workflow/discovery.js");

    expect(resolveWorkflowTarget).not.toHaveBeenCalled();
    expect(loadSharedAgentRegistry).not.toHaveBeenCalled();
    expect(loadToolRegistry).not.toHaveBeenCalled();
    expect(discoverWorkflowRegistry).not.toHaveBeenCalled();
    expect(runDeps.runtimeRunner.run).not.toHaveBeenCalled();
  });

  // Acceptance Test Scenario 1b
  it("AAA Scenario 1b: non-strict run and validate block on all-paths-failed discovery policy and halt before resolution or loading", async () => {
    // ----------------------------------------------------
    // ARRANGE:
    // A mocked precollect result representing all-paths-failed.
    // ----------------------------------------------------
    vi.mocked(precollectAllResourcesForLoad).mockResolvedValue({
      workflow: {
        loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
        collectionResult: {
          files: [],
          diagnostics: [
            {
              severity: "warning" as const,
              code: "LIST_DIRECTORY_NOT_FOUND",
              message: "Workflow directory not found",
              resourceType: "workflow" as const,
              path: "workflows",
            }
          ],
          configDiagnostics: [],
          metrics: []
        }
      },
      sharedAgents: {
        loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
        collectionResult: {
          files: [],
          diagnostics: [
            {
              severity: "warning" as const,
              code: "LIST_DIRECTORY_NOT_FOUND",
              message: "Agents directory not found",
              resourceType: "agent" as const,
              path: "agents",
            }
          ],
          configDiagnostics: [],
          metrics: []
        }
      },
      tools: {
        loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
        collectionResult: {
          files: [],
          diagnostics: [
            {
              severity: "warning" as const,
              code: "LIST_DIRECTORY_NOT_FOUND",
              message: "Tools directory not found",
              resourceType: "tool" as const,
              path: "tools",
            }
          ],
          configDiagnostics: [],
          metrics: []
        }
      }
    });

    const runDeps = {
      runtimeRunner: { run: vi.fn() },
    };

    // ----------------------------------------------------
    // ACT:
    // Invoke both run and validate commands in non-strict mode.
    // ----------------------------------------------------
    const actRun = runCommand({
      workflowFile: "test-workflow.js",
      rawOptions: { strict: false, cwd: "/mock-cwd" },
      deps: runDeps,
    });

    const actValidate = validateCommand({
      workflowFile: "test-workflow.js",
      rawOptions: { strict: false, cwd: "/mock-cwd" },
    });

    // ----------------------------------------------------
    // ASSERT:
    // Both commands must throw ErrorCode.WORKFLOW_DISCOVERY_FAILED,
    // and downstream steps (target resolution, loading, runner execution) must not be called.
    // ----------------------------------------------------
    await expect(actRun).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.WORKFLOW_DISCOVERY_FAILED,
      })
    );

    await expect(actValidate).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.WORKFLOW_DISCOVERY_FAILED,
      })
    );

    // Verify blocking: none of the resolution, registry discovery, or loading logic was executed
    const { resolveWorkflowTarget } = await import("../../../src/workflow/resolve-target.js");
    const { loadSharedAgentRegistry } = await import("../../../src/shared-agents/load.js");
    const { loadToolRegistry } = await import("../../../src/tools/load.js");
    const { discoverWorkflowRegistry } = await import("../../../src/workflow/discovery.js");

    expect(resolveWorkflowTarget).not.toHaveBeenCalled();
    expect(loadSharedAgentRegistry).not.toHaveBeenCalled();
    expect(loadToolRegistry).not.toHaveBeenCalled();
    expect(discoverWorkflowRegistry).not.toHaveBeenCalled();
    expect(runDeps.runtimeRunner.run).not.toHaveBeenCalled();
  });

  // Acceptance Test Scenario 2
  it("AAA Scenario 2: symlinks pointing outside workspace throw proper security policy errors", async () => {
    // ----------------------------------------------------
    // ARRANGE:
    // Set up diagnostics representing symlink escapes outside the workspace
    // for shared agents, workflows, and tools.
    // ----------------------------------------------------
    const mockPrecollected = {
      workflow: {
        loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
        collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
      },
      sharedAgents: {
        loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
        collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
      },
      tools: {
        loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
        collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
      }
    };

    const symlinkAgentDiag = [
      {
        code: "CONFIG_PATH_SYMLINK_ESCAPE",
        message: "Symlink points outside root",
        severity: "error" as const,
        resource: "sharedAgents" as const,
        value: "agents/symlink",
        fatalInStrictContext: true,
      },
    ];

    const symlinkWorkflowDiag = [
      {
        code: "CONFIG_PATH_SYMLINK_ESCAPE",
        message: "Symlink points outside root",
        severity: "error" as const,
        resource: "workflow" as const,
        value: "workflows/symlink",
        fatalInStrictContext: true,
      },
    ];

    const symlinkToolsDiag = [
      {
        code: "CONFIG_PATH_SYMLINK_ESCAPE",
        message: "Symlink points outside root",
        severity: "error" as const,
        resource: "tools" as const,
        value: "tools/symlink",
        fatalInStrictContext: true,
      },
    ];

    // ----------------------------------------------------
    // ACT:
    // Run the discovery policy check for all three cases.
    // ----------------------------------------------------
    const actAgent = checkDiscoveryPolicy("run-strict", symlinkAgentDiag, mockPrecollected, "/mock-cwd");
    const actWorkflow = checkDiscoveryPolicy("run-strict", symlinkWorkflowDiag, mockPrecollected, "/mock-cwd");
    const actTools = checkDiscoveryPolicy("run-strict", symlinkToolsDiag, mockPrecollected, "/mock-cwd");

    // ----------------------------------------------------
    // ASSERT:
    // Shared agents throw SHARED_AGENT_SECURITY_POLICY_VIOLATION,
    // workflows and tools throw SECURITY_POLICY_VIOLATION.
    // ----------------------------------------------------
    await expect(actAgent).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION,
      })
    );

    await expect(actWorkflow).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.SECURITY_POLICY_VIOLATION,
      })
    );

    await expect(actTools).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.SECURITY_POLICY_VIOLATION,
      })
    );
  });

  // Acceptance Test Scenario 3
  it("AAA Scenario 3: non-strict list configuration reports diagnostics without blocking or throwing exceptions", () => {
    // ----------------------------------------------------
    // ARRANGE:
    // Setup a non-strict list configuration that contains diagnostics.
    // ----------------------------------------------------
    const configDiagnostics = [
      {
        code: "STRICT_FATAL_ERROR",
        message: "Fatal in strict mode but warning/non-fatal here",
        severity: "error",
        fatalInStrictContext: true,
      },
    ];

    const rawResult = {
      schemaVersion: "open-dynamic-workflow.list.v1" as const,
      resourceTypes: ["workflow", "agent", "tool"],
      resources: [],
      warnings: [],
      errors: [],
      configDiagnostics: [],
      summary: {
        discoveredCount: 0,
        validCount: 0,
        warningCount: 0,
        errorCount: 0,
        configWarningCount: 0,
        configErrorCount: 0,
        countsByType: { workflow: 0, agent: 0, tool: 0 },
      },
    };

    // ----------------------------------------------------
    // ACT:
    // Evaluate the policy in a non-strict "list" context.
    // ----------------------------------------------------
    const decision = evaluateDiscoveryLoadPolicy({
      context: "list",
      rawResult,
      configDiagnostics,
    });

    // ----------------------------------------------------
    // ASSERT:
    // It must not block loading, and diagnostics must be reported successfully.
    // ----------------------------------------------------
    expect(decision.shouldBlockLoad).toBe(false);
    expect(decision.policy.shouldFailBeforeLoad).toBe(false);
    expect(decision.policy.result.status).toBe("failed"); // fatalInStrictContext is ignored for blocking in non-strict list but status is still failed due to severity error
    expect(decision.policy.allConfigDiagnostics).toContainEqual(configDiagnostics[0]);
  });

  // Acceptance Test Scenario 4
  describe("AAA Scenario 4: single-compile precollection with candidate files and compiled exclude pattern reuse", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(process.cwd(), "temp-aaa-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("runs precollectResourceForLoad filtering candidates, reusing exclude, and compiling exactly once", async () => {
      // ----------------------------------------------------
      // ARRANGE:
      // A temporary filesystem workspace containing one matching and one excluded file.
      // ----------------------------------------------------
      fs.mkdirSync(path.join(tempDir, "workflows"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "workflows", "target.js"), "console.log('target')");
      fs.writeFileSync(path.join(tempDir, "workflows", "exclude.js"), "console.log('exclude')");

      const discovery = {
        resource: "workflow",
        include: ["workflows/**/*.js"],
        exclude: ["workflows/exclude.js"],
        source: "project-config",
        includeSource: "project-config",
        excludeSource: "project-config",
        compatibilityMode: "default-suffix-specific",
        sourcePaths: [],
        rawInclude: ["workflows/**/*.js"],
        rawExclude: ["workflows/exclude.js"],
        diagnostics: [],
      } as any;

      compileCount = 0;

      // ----------------------------------------------------
      // ACT:
      // Invoke precollectResourceForLoad()
      // ----------------------------------------------------
      const result = await precollectResourceForLoad({
        cwd: tempDir,
        resourceType: "workflow",
        discovery,
        strict: true,
      });

      // ----------------------------------------------------
      // ASSERT:
      // - Pattern compilation is executed exactly once
      // - Candidate files are correctly filtered (only target.js is included)
      // - Exclude array in loadInput.discoveryPolicy.exclude matches the compiled output
      // ----------------------------------------------------
      expect(compileCount).toBe(1);

      expect(result.loadInput.candidateFiles.length).toBe(1);
      expect(result.loadInput.candidateFiles[0].relativePath).toBe("workflows/target.js");

      expect(result.loadInput.discoveryPolicy.exclude.length).toBe(1);
      expect(result.loadInput.discoveryPolicy.exclude[0].absoluteBaseDir).toBe(
        path.resolve(tempDir, "workflows/exclude.js")
      );
    });
  });

  // Acceptance Test Scenario 5
  it("AAA Scenario 5: applyDiscoveryPolicy policy contract carries the stop-before-load decision correctly", () => {
    const configDiagnostics = [
      {
        code: "HARD_ERROR",
        message: "A hard configuration error",
        severity: "error" as const,
        fatalInStrictContext: false
      }
    ];

    const rawResult = {
      schemaVersion: "open-dynamic-workflow.list.v1" as const,
      resourceTypes: ["workflow", "agent", "tool"] as const,
      resources: [],
      warnings: [],
      errors: [],
      configDiagnostics: [],
      summary: {
        discoveredCount: 0,
        validCount: 0,
        warningCount: 0,
        errorCount: 0,
        configWarningCount: 0,
        configErrorCount: 0,
        countsByType: { workflow: 0, agent: 0, tool: 0 }
      }
    };

    const runPolicy = applyDiscoveryPolicy({
      context: "run",
      rawResult,
      configDiagnostics
    });
    expect(runPolicy.shouldFailBeforeLoad).toBe(true);

    const validatePolicy = applyDiscoveryPolicy({
      context: "validate",
      rawResult,
      configDiagnostics
    });
    expect(validatePolicy.shouldFailBeforeLoad).toBe(true);

    const listPolicy = applyDiscoveryPolicy({
      context: "list",
      rawResult,
      configDiagnostics
    });
    expect(listPolicy.shouldFailBeforeLoad).toBe(false);
  });

  // Acceptance Test Scenario 6
  it("AAA Scenario 6: mixed success precollection does not block run and validate commands", async () => {
    vi.mocked(precollectAllResourcesForLoad).mockResolvedValue({
      workflow: {
        loadInput: {
          candidateFiles: [
            {
              resourceType: "workflow",
              absolutePath: "/mock-cwd/valid.js",
              relativePath: "valid.js",
              realPath: "/mock-cwd/valid.js",
              sourcePattern: "**/*.js",
              sourceConfigPath: "/mock-config.yaml",
              source: "project-config"
            }
          ],
          discoveryPolicy: { exclude: [] }
        },
        collectionResult: {
          files: [
            {
              resourceType: "workflow",
              absolutePath: "/mock-cwd/valid.js",
              relativePath: "valid.js",
              realPath: "/mock-cwd/valid.js",
              sourcePattern: "**/*.js",
              sourceConfigPath: "/mock-config.yaml",
              source: "project-config"
            }
          ],
          diagnostics: [
            {
              severity: "warning" as const,
              code: "LIST_DIRECTORY_NOT_FOUND",
              message: "Workflow directory not found",
              resourceType: "workflow" as const,
              path: "workflows"
            }
          ],
          configDiagnostics: [],
          metrics: []
        }
      },
      sharedAgents: {
        loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
        collectionResult: {
          files: [],
          diagnostics: [
            {
              severity: "warning" as const,
              code: "LIST_DIRECTORY_NOT_FOUND",
              message: "Agents directory not found",
              resourceType: "agent" as const,
              path: "agents"
            }
          ],
          configDiagnostics: [],
          metrics: []
        }
      },
      tools: {
        loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
        collectionResult: {
          files: [],
          diagnostics: [
            {
              severity: "warning" as const,
              code: "LIST_DIRECTORY_NOT_FOUND",
              message: "Tools directory not found",
              resourceType: "tool" as const,
              path: "tools"
            }
          ],
          configDiagnostics: [],
          metrics: []
        }
      }
    });

    const runDeps = {
      runtimeRunner: { run: vi.fn().mockResolvedValue({ status: "success" }) },
    };

    const { discoverWorkflowRegistry } = await import("../../../src/workflow/discovery.js");
    vi.mocked(discoverWorkflowRegistry).mockResolvedValue({
      list: () => [
        {
          sourcePath: "/mock-cwd/valid.js",
          parsedWorkflow: {
            meta: {
              description: "A valid workflow description",
              phases: [],
              version: "1.0.0"
            },
            sourceHash: "12345",
            sourceText: "console.log('hi')"
          }
        } as any
      ]
    });

    await expect(runCommand({
      workflowFile: "valid.js",
      rawOptions: { strict: false, cwd: "/mock-cwd" },
      deps: runDeps
    })).resolves.toBeUndefined();

    await expect(validateCommand({
      workflowFile: "valid.js",
      rawOptions: { strict: false, cwd: "/mock-cwd" }
    })).resolves.toBeUndefined();
  });
});
