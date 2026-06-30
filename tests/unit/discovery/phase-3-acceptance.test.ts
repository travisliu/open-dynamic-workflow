import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

// Scenario 1: Tool loader & Helper exclusion
import { loadToolRegistry } from "../../../src/tools/load.js";
import { compileResourceDiscovery } from "../../../src/discovery/compile-patterns.js";

// Scenario 2: Shared agent loader
import { loadSharedAgentRegistry } from "../../../src/shared-agents/load.js";

// Scenario 3: Workflow discovery
import { discoverWorkflowRegistry } from "../../../src/workflow/discovery.js";

// Scenario 4: CLI run & validate commands
import { runCommand } from "../../../src/cli/commands/run.js";
import { validateCommand } from "../../../src/cli/commands/validate.js";

// Mocks delegation setups
let mockLoadToolRegistry: any = null;
let mockLoadSharedAgentRegistry: any = null;
let mockDiscoverWorkflowRegistry: any = null;
let mockPrecollectAllResourcesForLoad: any = null;
let mockCheckDiscoveryPolicy: any = null;
let mockLoadWorkflow: any = null;
let mockParseWorkflow: any = null;
let mockAssertWorkflowValid: any = null;
let mockLoadConfig: any = null;
let mockResolveWorkflowTarget: any = null;

// Mock modules so we can control loader calls and precollection in tests
vi.mock("../../../src/tools/load.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/tools/load.js")>();
  return {
    ...actual,
    loadToolRegistry: vi.fn().mockImplementation((input) => {
      if (mockLoadToolRegistry) {
        return mockLoadToolRegistry(input);
      }
      return actual.loadToolRegistry(input);
    })
  };
});

vi.mock("../../../src/shared-agents/load.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/shared-agents/load.js")>();
  return {
    ...actual,
    loadSharedAgentRegistry: vi.fn().mockImplementation((input) => {
      if (mockLoadSharedAgentRegistry) {
        return mockLoadSharedAgentRegistry(input);
      }
      return actual.loadSharedAgentRegistry(input);
    })
  };
});

vi.mock("../../../src/workflow/discovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/workflow/discovery.js")>();
  return {
    ...actual,
    discoverWorkflowRegistry: vi.fn().mockImplementation((input) => {
      if (mockDiscoverWorkflowRegistry) {
        return mockDiscoverWorkflowRegistry(input);
      }
      return actual.discoverWorkflowRegistry(input);
    })
  };
});

vi.mock("../../../src/discovery/precollect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/discovery/precollect.js")>();
  return {
    ...actual,
    precollectAllResourcesForLoad: vi.fn().mockImplementation((input) => {
      if (mockPrecollectAllResourcesForLoad) {
        return mockPrecollectAllResourcesForLoad(input);
      }
      return actual.precollectAllResourcesForLoad(input);
    }),
    checkDiscoveryPolicy: vi.fn().mockImplementation((mode, configDiagnostics, precollected, cwd) => {
      if (mockCheckDiscoveryPolicy) {
        return mockCheckDiscoveryPolicy(mode, configDiagnostics, precollected, cwd);
      }
      return actual.checkDiscoveryPolicy(mode, configDiagnostics, precollected, cwd);
    })
  };
});

vi.mock("../../../src/workflow/load.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/workflow/load.js")>();
  return {
    ...actual,
    loadWorkflow: vi.fn().mockImplementation((filePath, cwd) => {
      if (mockLoadWorkflow) {
        return mockLoadWorkflow(filePath, cwd);
      }
      return actual.loadWorkflow(filePath, cwd);
    })
  };
});

vi.mock("../../../src/workflow/parse.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/workflow/parse.js")>();
  return {
    ...actual,
    parseWorkflow: vi.fn().mockImplementation((loaded) => {
      if (mockParseWorkflow) {
        return mockParseWorkflow(loaded);
      }
      return actual.parseWorkflow(loaded);
    })
  };
});

vi.mock("../../../src/workflow/validate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/workflow/validate.js")>();
  return {
    ...actual,
    assertWorkflowValid: vi.fn().mockImplementation((parsed, options) => {
      if (mockAssertWorkflowValid) {
        return mockAssertWorkflowValid(parsed, options);
      }
      return actual.assertWorkflowValid(parsed, options);
    }),
    validateRegistryDependencies: vi.fn().mockImplementation((registry, options) => {
      return actual.validateRegistryDependencies(registry, options);
    })
  };
});

vi.mock("../../../src/config/load.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/load.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockImplementation((input) => {
      if (mockLoadConfig) {
        return mockLoadConfig(input);
      }
      return actual.loadConfig(input);
    })
  };
});

vi.mock("../../../src/workflow/resolve-target.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/workflow/resolve-target.js")>();
  return {
    ...actual,
    resolveWorkflowTarget: vi.fn().mockImplementation((input) => {
      if (mockResolveWorkflowTarget) {
        return mockResolveWorkflowTarget(input);
      }
      return actual.resolveWorkflowTarget(input);
    })
  };
});

// Mock Artifact Store and Reporter to prevent side effects in CLI execution
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

describe("Phase 3 Acceptance Tests - Preserve legacy direct API paths while reducing drift", () => {
  let tempDir: string;

  beforeEach(async () => {
    const baseTemp = await mkdtemp(join(tmpdir(), "phase-3-acceptance-"));
    tempDir = await realpath(baseTemp);

    // Reset all mock hooks
    mockLoadToolRegistry = null;
    mockLoadSharedAgentRegistry = null;
    mockDiscoverWorkflowRegistry = null;
    mockPrecollectAllResourcesForLoad = null;
    mockCheckDiscoveryPolicy = null;
    mockLoadWorkflow = null;
    mockParseWorkflow = null;
    mockAssertWorkflowValid = null;
    mockLoadConfig = null;
    mockResolveWorkflowTarget = null;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("Scenario 1: Tool loader blocks excluded helper imports before execution on precollected path", async () => {
    // ----------------------------------------------------
    // ARRANGE:
    // Setup a tools folder with a safe tool importing an excluded helper.
    // The excluded helper contains a side-effect marker that writes a file if evaluated.
    // ----------------------------------------------------
    const toolsDir = join(tempDir, "tools");
    await mkdir(toolsDir);
    const markerFile = join(tempDir, "excluded-helper-executed.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    await mkdir(join(toolsDir, "helpers"), { recursive: true });

    // The tool file
    await writeFile(join(toolsDir, "safe.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import "./helpers/excluded.js";
      export default defineTool({ id: "safe-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    // The helper file containing the execution side-effect
    await writeFile(join(toolsDir, "helpers", "excluded.ts"), `
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
    `);

    // Compile brace-expanded exclude pattern via compileResourceDiscovery
    const compiledDiscovery = compileResourceDiscovery({
      cwd: tempDir,
      discovery: {
        resource: "tools",
        include: [],
        exclude: ["tools/helpers/*.{ts,js}"],
        source: "new",
        includeSource: "new",
        excludeSource: "new",
        compatibilityMode: "new-suffix-specific",
        sourcePaths: ["tools.exclude"],
        rawInclude: [],
        rawExclude: ["tools/helpers/*.{ts,js}"],
        diagnostics: [],
      },
    });

    // ----------------------------------------------------
    // ACT & ASSERT: Precollected loading path
    // ----------------------------------------------------
    const precollectedAction = () => loadToolRegistry({
      cwd: tempDir,
      maxDefinitions: 10,
      precollected: {
        candidateFiles: [{
          relativePath: "tools/safe.tool.ts",
          absolutePath: join(toolsDir, "safe.tool.ts"),
          resourceType: "tool"
        }],
        discoveryPolicy: {
          exclude: compiledDiscovery.discovery.exclude,
        }
      }
    });

    await expect(precollectedAction).rejects.toThrow(/excluded by policy/);
    expect(existsSync(markerFile)).toBe(false);
  });

  it("Scenario 2: Shared-agent loader preserves legacy dir configuration with deterministic sorting", async () => {
    // ----------------------------------------------------
    // ARRANGE:
    // Create an agents directory and write three agent files out of alphabetical order.
    // ----------------------------------------------------
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });

    await writeFile(join(agentsDir, "z.js"), `export default defineAgent({ id: "z", description: "z-agent", run: async () => ({ ok: true }) });`);
    await writeFile(join(agentsDir, "a.js"), `export default defineAgent({ id: "a", description: "a-agent", run: async () => ({ ok: true }) });`);
    await writeFile(join(agentsDir, "c.js"), `export default defineAgent({ id: "c", description: "c-agent", run: async () => ({ ok: true }) });`);

    // ----------------------------------------------------
    // ACT:
    // Invoke loadSharedAgentRegistry with dir and cwd only (no precollected inputs).
    // ----------------------------------------------------
    const registry = await loadSharedAgentRegistry({
      cwd: tempDir,
      dir: "agents"
    });

    // ----------------------------------------------------
    // ASSERT:
    // Verify that legacy dir capability is preserved and sorting remains deterministic (a, c, z).
    // ----------------------------------------------------
    expect(registry).toBeDefined();
    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe("a");
    expect(list[1].id).toBe("c");
    expect(list[2].id).toBe("z");
  });

  it("Scenario 3: Workflow discovery enforces precollected precedence, root-inclusion, and candidate-narrowing", async () => {
    // ----------------------------------------------------
    // ARRANGE:
    // Set up dummy workflow files for root, alpha, and beta.
    // ----------------------------------------------------
    const workflowsDir = join(tempDir, "workflows");
    await mkdir(workflowsDir, { recursive: true });

    const rootPath = join(tempDir, "root.ts");
    const alphaPath = join(workflowsDir, "alpha.ts");
    const betaPath = join(workflowsDir, "beta.ts");

    await writeFile(rootPath, "root stub");
    await writeFile(alphaPath, "alpha stub");
    await writeFile(betaPath, "beta stub");

    // Configure the workflow mocks
    mockLoadWorkflow = async (p: string) => ({
      sourcePath: p,
      sourceText: "content"
    });

    mockParseWorkflow = (loaded: any) => {
      let name = "unknown";
      if (loaded.sourcePath === rootPath) name = "root";
      else if (loaded.sourcePath === alphaPath) name = "alpha";
      else if (loaded.sourcePath === betaPath) name = "beta";
      return {
        meta: { name, description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      };
    };

    mockAssertWorkflowValid = () => {};

    // ----------------------------------------------------
    // ACT 1 & ASSERT 1: Precollected vs Conflicting Legacy Include
    // ----------------------------------------------------
    const registry1 = await discoverWorkflowRegistry({
      rootWorkflowPath: "root.ts",
      cwd: tempDir,
      precollected: {
        candidateFiles: [
          {
            resourceType: "workflow" as const,
            absolutePath: alphaPath,
            relativePath: "workflows/alpha.ts",
            realPath: alphaPath,
            sourcePattern: "workflows/*.ts",
            sourceConfigPath: "workflow.include[0]",
            source: "new" as const,
          }
        ],
        discoveryPolicy: { exclude: [] }
      },
      include: ["workflows/beta.ts"] // Legacy include that should be ignored
    });

    // Verify precollected wins and root workflow is still loaded (root-inclusion)
    expect(registry1.names()).toEqual(new Set(["root", "alpha"]));

    // ----------------------------------------------------
    // ACT 2 & ASSERT 2: Precollected with narrowing candidatePaths
    // ----------------------------------------------------
    const registry2 = await discoverWorkflowRegistry({
      rootWorkflowPath: "root.ts",
      cwd: tempDir,
      precollected: {
        candidateFiles: [
          {
            resourceType: "workflow" as const,
            absolutePath: alphaPath,
            relativePath: "workflows/alpha.ts",
            realPath: alphaPath,
            sourcePattern: "workflows/*.ts",
            sourceConfigPath: "workflow.include[0]",
            source: "new" as const,
          },
          {
            resourceType: "workflow" as const,
            absolutePath: betaPath,
            relativePath: "workflows/beta.ts",
            realPath: betaPath,
            sourcePattern: "workflows/*.ts",
            sourceConfigPath: "workflow.include[0]",
            source: "new" as const,
          }
        ],
        discoveryPolicy: { exclude: [] }
      },
      candidatePaths: ["workflows/alpha.ts"] // Narrow selection to alpha
    });

    // Verify candidate-narrowing behaves as expected
    expect(registry2.names()).toEqual(new Set(["root", "alpha"]));
  });

  it("Scenario 4: CLI run and validate execute precollectAllResourcesForLoad first and pass correct inputs downstream", async () => {
    // ----------------------------------------------------
    // ARRANGE:
    // Prepare fake precollected load inputs.
    // Configure CLI mocks to record execution order and parameters.
    // ----------------------------------------------------
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

    const callOrder: string[] = [];

    mockLoadConfig = async () => ({
      cwd: tempDir,
      outDir: "runs",
      reporting: { mode: "silent" as const, verbose: false },
      workflow: { maxLoopRounds: 10 },
      sharedAgents: { maxDefinitions: 100, allowDynamicIds: false },
      tools: { maxDefinitions: 100 },
      _normalizedDiscovery: { workflow: {}, sharedAgents: {}, tools: {} },
      _configDiagnostics: []
    });

    mockResolveWorkflowTarget = async () => ({
      workflowFile: "valid-simple.js",
      workflowFileRelative: "workflows/valid-simple.js",
      candidatePaths: [],
      requestedTarget: "valid-simple.js",
      workflowName: "valid-simple"
    });

    mockPrecollectAllResourcesForLoad = async () => {
      callOrder.push("precollect");
      return mockPrecollected;
    };

    mockCheckDiscoveryPolicy = async () => {
      callOrder.push("policy");
    };

    mockLoadSharedAgentRegistry = async (input: any) => {
      callOrder.push("loadAgents");
      expect(input.precollected).toBe(mockLoadInputAgents);
      return { registry: "sharedAgents" } as any;
    };

    mockLoadToolRegistry = async (input: any) => {
      callOrder.push("loadTools");
      expect(input.precollected).toBe(mockLoadInputTools);
      return { registry: "tools" } as any;
    };

    mockDiscoverWorkflowRegistry = async (input: any) => {
      callOrder.push("discoverWorkflows");
      expect(input.precollected).toBe(mockLoadInputWorkflow);
      return {
        list: () => [
          {
            sourcePath: join(tempDir, "valid-simple.js"),
            name: "valid-simple",
            parsedWorkflow: {
              meta: { description: "description", phases: [] },
              sourceText: "source",
              sourceHash: "hash"
            }
          }
        ]
      } as any;
    };

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // ----------------------------------------------------
    // ACT 1: Run command
    // ----------------------------------------------------
    await runCommand({
      workflowFile: "valid-simple.js",
      rawOptions: { dryRun: true, cwd: tempDir },
      deps: { runtimeRunner: { run: vi.fn() } }
    });

    // ----------------------------------------------------
    // ASSERT 1: Precollect runs first and load inputs are correctly passed
    // ----------------------------------------------------
    expect(callOrder[0]).toBe("precollect");
    expect(callOrder).toContain("loadAgents");
    expect(callOrder).toContain("loadTools");
    expect(callOrder).toContain("discoverWorkflows");

    // ----------------------------------------------------
    // ACT 2: Validate command
    // ----------------------------------------------------
    callOrder.length = 0; // Reset call order
    await validateCommand({
      workflowFile: "valid-simple.js",
      rawOptions: { cwd: tempDir }
    });

    // ----------------------------------------------------
    // ASSERT 2: Precollect runs first and load inputs are correctly passed
    // ----------------------------------------------------
    expect(callOrder[0]).toBe("precollect");
    expect(callOrder).toContain("loadAgents");
    expect(callOrder).toContain("loadTools");
    expect(callOrder).toContain("discoverWorkflows");

    logSpy.mockRestore();
  });
});
