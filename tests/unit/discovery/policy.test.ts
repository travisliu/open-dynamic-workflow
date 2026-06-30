import { describe, expect, it } from "vitest";
import { applyDiscoveryPolicy, evaluateDiscoveryLoadPolicy } from "../../../src/discovery/policy.js";
import type { DiscoveryRawResult } from "../../../src/discovery/types.js";
import type { ConfigDiagnostic } from "../../../src/config/types.js";

describe("Discovery Policy Unit Tests", () => {
  function createRawResult(overrides: Partial<DiscoveryRawResult> = {}): DiscoveryRawResult {
    return {
      schemaVersion: "open-dynamic-workflow.list.v1",
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
        countsByType: { workflow: 0, agent: 0, tool: 0 }
      },
      ...overrides
    };
  }

  it("merges config diagnostics before collection diagnostics", () => {
    const rawResult = createRawResult();
    const configDiagnostics: ConfigDiagnostic[] = [
      { code: "CONFIG_1", message: "Config error 1", severity: "error" }
    ];
    const collectionDiagnostics: ConfigDiagnostic[] = [
      { code: "COLL_1", message: "Collection warning 1", severity: "warning" }
    ];

    const policy = applyDiscoveryPolicy({
      context: "list",
      rawResult,
      configDiagnostics,
      collectionDiagnostics
    });

    expect(policy.allConfigDiagnostics).toEqual([
      configDiagnostics[0],
      collectionDiagnostics[0]
    ]);
  });

  it("explicit collectionDiagnostics take precedence over rawResult.configDiagnostics", () => {
    const rawResult = createRawResult({
      configDiagnostics: [{ code: "OLD", message: "Old diagnostic", severity: "warning" }]
    });
    const collectionDiagnostics: ConfigDiagnostic[] = [
      { code: "NEW", message: "New diagnostic", severity: "error" }
    ];

    const policy = applyDiscoveryPolicy({
      context: "list",
      rawResult,
      collectionDiagnostics
    });

    expect(policy.allConfigDiagnostics).toEqual(collectionDiagnostics);
  });

  it("preserves duplicate diagnostics", () => {
    const rawResult = createRawResult();
    const configDiagnostics: ConfigDiagnostic[] = [
      { code: "CONFIG_1", message: "Duplicate", severity: "error" }
    ];
    const collectionDiagnostics: ConfigDiagnostic[] = [
      { code: "CONFIG_1", message: "Duplicate", severity: "error" }
    ];

    const policy = applyDiscoveryPolicy({
      context: "list",
      rawResult,
      configDiagnostics,
      collectionDiagnostics
    });

    expect(policy.allConfigDiagnostics.length).toBe(2);
  });

  it("warning and error counts include both list diagnostics and config diagnostics", () => {
    const rawResult = createRawResult({
      warnings: [{ severity: "warning", code: "W_LIST", message: "List Warning" }],
      errors: [{ severity: "error", code: "E_LIST", message: "List Error" }]
    });
    const configDiagnostics: ConfigDiagnostic[] = [
      { code: "C_W", message: "Config Warning", severity: "warning" }
    ];
    const collectionDiagnostics: ConfigDiagnostic[] = [
      { code: "C_E", message: "Collection Error", severity: "error" }
    ];

    const policy = applyDiscoveryPolicy({
      context: "list",
      rawResult,
      configDiagnostics,
      collectionDiagnostics
    });

    expect(policy.configWarningCount).toBe(1);
    expect(policy.configErrorCount).toBe(1);
    expect(policy.result.summary.warningCount).toBe(2);
    expect(policy.result.summary.errorCount).toBe(2);
  });

  it("warning-only diagnostics produce partially_succeeded status", () => {
    const rawResult = createRawResult();
    const configDiagnostics: ConfigDiagnostic[] = [
      { code: "C_W", message: "Config Warning", severity: "warning" }
    ];

    const policy = applyDiscoveryPolicy({
      context: "list",
      rawResult,
      configDiagnostics
    });

    expect(policy.result.status).toBe("partially_succeeded");
  });

  it("config errors produce failed status", () => {
    const rawResult = createRawResult();
    const configDiagnostics: ConfigDiagnostic[] = [
      { code: "C_E", message: "Config Error", severity: "error" }
    ];

    const policy = applyDiscoveryPolicy({
      context: "list",
      rawResult,
      configDiagnostics
    });

    expect(policy.result.status).toBe("failed");
  });

  it("fatalInStrictContext is fatal in list-strict, validate-strict, and run-strict, but not list, validate, and run", () => {
    const rawResult = createRawResult();
    const configDiagnostics: ConfigDiagnostic[] = [
      { code: "STRICT_FATAL", message: "Fatal in strict", severity: "error", fatalInStrictContext: true }
    ];

    const listPolicy = applyDiscoveryPolicy({
      context: "list",
      rawResult,
      configDiagnostics
    });
    expect(listPolicy.shouldFailBeforeLoad).toBe(false);

    const listStrictPolicy = applyDiscoveryPolicy({
      context: "list-strict",
      rawResult,
      configDiagnostics
    });
    expect(listStrictPolicy.shouldFailBeforeLoad).toBe(true);

    const validatePolicy = applyDiscoveryPolicy({
      context: "validate",
      rawResult,
      configDiagnostics
    });
    expect(validatePolicy.shouldFailBeforeLoad).toBe(false);

    const validateStrictPolicy = applyDiscoveryPolicy({
      context: "validate-strict",
      rawResult,
      configDiagnostics
    });
    expect(validateStrictPolicy.shouldFailBeforeLoad).toBe(true);

    const runPolicy = applyDiscoveryPolicy({
      context: "run",
      rawResult,
      configDiagnostics
    });
    expect(runPolicy.shouldFailBeforeLoad).toBe(false);

    const runStrictPolicy = applyDiscoveryPolicy({
      context: "run-strict",
      rawResult,
      configDiagnostics
    });
    expect(runStrictPolicy.shouldFailBeforeLoad).toBe(true);
  });

  it("preserves existing resources, resource types, warning/error arrays, and computes status", () => {
    const rawResult = createRawResult({
      resources: [{ name: "my-resource", relativePath: "res.js", resourceType: "workflow", isValid: true } as any],
      resourceTypes: ["workflow"],
      warnings: [{ severity: "warning", code: "W", message: "Warning", resourceType: "workflow", path: "res.js" }],
      errors: [{ severity: "error", code: "E", message: "Error", resourceType: "workflow", path: "res.js" }]
    });

    const policy = applyDiscoveryPolicy({
      context: "list",
      rawResult
    });

    expect(policy.result.status).toBe("failed");
    expect(policy.result.resources).toEqual(rawResult.resources);
    expect(policy.result.resourceTypes).toEqual(rawResult.resourceTypes);
    expect(policy.result.warnings).toEqual(rawResult.warnings);
    expect(policy.result.errors).toEqual(rawResult.errors);
  });

  it("table-driven assertion for applyDiscoveryPolicy shouldFailBeforeLoad matrix", () => {
    const contexts = [
      "list",
      "list-strict",
      "run",
      "run-strict",
      "validate",
      "validate-strict"
    ] as const;

    // Helper to evaluate a scenario
    const testMatrix = (
      scenarioName: string,
      args: {
        configDiagnostics?: ConfigDiagnostic[];
        rawResultOverrides?: Partial<DiscoveryRawResult>;
      },
      expected: Record<string, boolean>
    ) => {
      for (const context of contexts) {
        const policy = applyDiscoveryPolicy({
          context,
          rawResult: createRawResult(args.rawResultOverrides),
          configDiagnostics: args.configDiagnostics
        });
        expect(policy.shouldFailBeforeLoad, `${scenarioName} for context ${context}`).toBe(expected[context]);
      }
    };

    // 1. Success case
    testMatrix("success", {}, {
      "list": false,
      "list-strict": false,
      "run": false,
      "run-strict": false,
      "validate": false,
      "validate-strict": false
    });

    // 2. Strict-fatal config error (fatalInStrictContext: true)
    testMatrix("strict-fatal config error", {
      configDiagnostics: [{ code: "E", message: "Strict fatal", severity: "error", fatalInStrictContext: true }]
    }, {
      "list": false,
      "list-strict": true,
      "run": false,
      "run-strict": true,
      "validate": false,
      "validate-strict": true
    });

    // 3. Hard config error (fatalInStrictContext: false)
    testMatrix("hard config error", {
      configDiagnostics: [{ code: "E", message: "Hard config error", severity: "error", fatalInStrictContext: false }]
    }, {
      "list": false,
      "list-strict": true,
      "run": true,
      "run-strict": true,
      "validate": true,
      "validate-strict": true
    });

    // 4. Discovery error (rawResult has errors)
    testMatrix("discovery error", {
      rawResultOverrides: {
        errors: [{ severity: "error", code: "E_DISC", message: "Discovery error", resourceType: "workflow", path: "" }]
      }
    }, {
      "list": false,
      "list-strict": true,
      "run": true,
      "run-strict": true,
      "validate": true,
      "validate-strict": true
    });

    // 5. All-paths-failed case
    testMatrix("all-paths-failed", {
      rawResultOverrides: {
        resourceTypes: ["workflow", "agent", "tool"],
        resources: [],
        warnings: [
          { severity: "warning", code: "LIST_DIRECTORY_NOT_FOUND", message: "No workflows", resourceType: "workflow", path: "" },
          { severity: "warning", code: "LIST_DIRECTORY_NOT_FOUND", message: "No agents", resourceType: "agent", path: "" },
          { severity: "warning", code: "LIST_DIRECTORY_NOT_FOUND", message: "No tools", resourceType: "tool", path: "" }
        ]
      }
    }, {
      "list": false,
      "list-strict": true,
      "run": true,
      "run-strict": true,
      "validate": true,
      "validate-strict": true
    });
  });

  it("mixed-success: does not block run/validate when each type has LIST_DIRECTORY_NOT_FOUND warning but at least one type has a discovered resource", () => {
    const rawResult = createRawResult({
      resourceTypes: ["workflow", "agent", "tool"],
      resources: [
        { type: "workflow", name: "wf1", description: "", path: "/wf1", valid: true }
      ],
      warnings: [
        { severity: "warning", code: "LIST_DIRECTORY_NOT_FOUND", message: "No workflows in dir2", resourceType: "workflow", path: "" },
        { severity: "warning", code: "LIST_DIRECTORY_NOT_FOUND", message: "No agents", resourceType: "agent", path: "" },
        { severity: "warning", code: "LIST_DIRECTORY_NOT_FOUND", message: "No tools", resourceType: "tool", path: "" }
      ]
    });

    const runPolicy = applyDiscoveryPolicy({
      context: "run",
      rawResult
    });
    expect(runPolicy.shouldFailBeforeLoad).toBe(false);
    expect(runPolicy.result.warnings.length).toBe(3);

    const validatePolicy = applyDiscoveryPolicy({
      context: "validate",
      rawResult
    });
    expect(validatePolicy.shouldFailBeforeLoad).toBe(false);
  });

  describe("evaluateDiscoveryLoadPolicy and checkDiscoveryPolicy Integration", () => {
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

    const configDiagnostics: ConfigDiagnostic[] = [
      { code: "STRICT_FATAL", message: "Fatal in strict", severity: "error", fatalInStrictContext: true }
    ];

    it("evaluateDiscoveryLoadPolicy: list-strict failure vs list report-only", () => {
      const rawResult = createRawResult();
      const decisionListStrict = evaluateDiscoveryLoadPolicy({
        context: "list-strict",
        rawResult,
        configDiagnostics
      });
      expect(decisionListStrict.shouldBlockLoad).toBe(true);

      const decisionList = evaluateDiscoveryLoadPolicy({
        context: "list",
        rawResult,
        configDiagnostics
      });
      expect(decisionList.shouldBlockLoad).toBe(false);
    });

    it("evaluateDiscoveryLoadPolicy: blocks on run/validate/list-strict contexts on failed status, but non-strict list remains report-only", () => {
      const rawResult = createRawResult();
      const failedConfigDiagnostics: ConfigDiagnostic[] = [
        { code: "SOME_ERROR", message: "An error occurred", severity: "error", fatalInStrictContext: false }
      ];

      const cases = [
        { context: "run" as const, expectedBlock: true },
        { context: "run-strict" as const, expectedBlock: true },
        { context: "validate" as const, expectedBlock: true },
        { context: "validate-strict" as const, expectedBlock: true },
        { context: "list" as const, expectedBlock: false },
        { context: "list-strict" as const, expectedBlock: true }
      ];

      for (const tc of cases) {
        const decision = evaluateDiscoveryLoadPolicy({
          context: tc.context,
          rawResult,
          configDiagnostics: failedConfigDiagnostics
        });
        expect(decision.shouldBlockLoad).toBe(tc.expectedBlock);
      }
    });

    it("evaluateDiscoveryLoadPolicy: allPathsFailed blocks execution contexts (run/validate, strict and non-strict) and list-strict, but does not block list", () => {
      const rawResult = createRawResult({
        resourceTypes: ["workflow"],
        resources: [],
        errors: [],
        warnings: [
          {
            severity: "warning",
            code: "LIST_DIRECTORY_NOT_FOUND",
            message: "Directory not found",
            resourceType: "workflow"
          }
        ]
      });

      const cases = [
        { context: "list" as const, expectedBlock: false },
        { context: "list-strict" as const, expectedBlock: true },
        { context: "run" as const, expectedBlock: true },
        { context: "run-strict" as const, expectedBlock: true },
        { context: "validate" as const, expectedBlock: true },
        { context: "validate-strict" as const, expectedBlock: true }
      ];

      for (const tc of cases) {
        const decision = evaluateDiscoveryLoadPolicy({
          context: tc.context,
          rawResult
        });
        expect(decision.shouldBlockLoad).toBe(tc.expectedBlock);
        if (tc.expectedBlock) {
          expect(decision.blockingDiagnostics.some(d => d.code === "LIST_DIRECTORY_NOT_FOUND")).toBe(true);
        }
      }
    });

    it("checkDiscoveryPolicy: strict run-strict blocks on fatal strict config diagnostic", async () => {
      const { checkDiscoveryPolicy } = await import("../../../src/discovery/precollect.js");
      const { OpenDynamicWorkflowError } = await import("../../../src/errors/types.js");
      const { ErrorCode } = await import("../../../src/errors/codes.js");

      try {
        await checkDiscoveryPolicy("run-strict", configDiagnostics, mockPrecollected);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.WORKFLOW_DISCOVERY_FAILED);
      }
    });

    it("checkDiscoveryPolicy: strict validate-strict blocks on fatal strict config diagnostic", async () => {
      const { checkDiscoveryPolicy } = await import("../../../src/discovery/precollect.js");
      const { OpenDynamicWorkflowError } = await import("../../../src/errors/types.js");
      const { ErrorCode } = await import("../../../src/errors/codes.js");

      try {
        await checkDiscoveryPolicy("validate-strict", configDiagnostics, mockPrecollected);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.WORKFLOW_DISCOVERY_FAILED);
      }
    });

    it("checkDiscoveryPolicy: blocks when policy status is failed due to list error, even without fatal config diagnostic", async () => {
      const { checkDiscoveryPolicy } = await import("../../../src/discovery/precollect.js");
      const { OpenDynamicWorkflowError } = await import("../../../src/errors/types.js");
      const { ErrorCode } = await import("../../../src/errors/codes.js");

      const precollectedWithListError = {
        ...mockPrecollected,
        workflow: {
          ...mockPrecollected.workflow,
          collectionResult: {
            ...mockPrecollected.workflow.collectionResult,
            diagnostics: [
              {
                severity: "error" as const,
                resourceType: "workflow" as const,
                path: "workflows",
                code: "LIST_DIRECTORY_NOT_FOUND",
                message: "Directory not found"
              }
            ]
          }
        }
      };

      try {
        await checkDiscoveryPolicy("run-strict", [], precollectedWithListError);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.WORKFLOW_DISCOVERY_FAILED);
      }
    });

    it("checkDiscoveryPolicy: non-strict list with error data returns reportable data and does not throw", async () => {
      const { checkDiscoveryPolicy } = await import("../../../src/discovery/precollect.js");
      
      const precollectedWithListError = {
        ...mockPrecollected,
        workflow: {
          ...mockPrecollected.workflow,
          collectionResult: {
            ...mockPrecollected.workflow.collectionResult,
            diagnostics: [
              {
                severity: "error" as const,
                resourceType: "workflow" as const,
                path: "workflows",
                code: "LIST_DIRECTORY_NOT_FOUND",
                message: "Directory not found"
              }
            ]
          }
        }
      };

      await expect(checkDiscoveryPolicy("list", configDiagnostics, precollectedWithListError)).resolves.toBeUndefined();
    });

    it("checkDiscoveryPolicy: CONFIG_PATH_SYMLINK_ESCAPE for sharedAgents maps to SHARED_AGENT_SECURITY_POLICY_VIOLATION", async () => {
      const { checkDiscoveryPolicy } = await import("../../../src/discovery/precollect.js");
      const { OpenDynamicWorkflowError } = await import("../../../src/errors/types.js");
      const { ErrorCode } = await import("../../../src/errors/codes.js");

      const symlinkAgentDiag = [
        {
          code: "CONFIG_PATH_SYMLINK_ESCAPE",
          message: "Symlink escape shared agents",
          severity: "error" as const,
          resource: "sharedAgents" as const,
          value: "my-agents/escape",
          fatalInStrictContext: true
        }
      ];

      try {
        await checkDiscoveryPolicy("run-strict", symlinkAgentDiag, mockPrecollected);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION);
      }
    });

    it("checkDiscoveryPolicy: CONFIG_PATH_SYMLINK_ESCAPE for workflow maps to SECURITY_POLICY_VIOLATION", async () => {
      const { checkDiscoveryPolicy } = await import("../../../src/discovery/precollect.js");
      const { OpenDynamicWorkflowError } = await import("../../../src/errors/types.js");
      const { ErrorCode } = await import("../../../src/errors/codes.js");

      const symlinkWorkflowDiag = [
        {
          code: "CONFIG_PATH_SYMLINK_ESCAPE",
          message: "Symlink escape workflow",
          severity: "error" as const,
          resource: "workflow" as const,
          value: "my-workflows/escape",
          fatalInStrictContext: true
        }
      ];

      try {
        await checkDiscoveryPolicy("run-strict", symlinkWorkflowDiag, mockPrecollected);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.SECURITY_POLICY_VIOLATION);
      }
    });

    it("checkDiscoveryPolicy: CONFIG_PATH_SYMLINK_ESCAPE for tools maps to SECURITY_POLICY_VIOLATION", async () => {
      const { checkDiscoveryPolicy } = await import("../../../src/discovery/precollect.js");
      const { OpenDynamicWorkflowError } = await import("../../../src/errors/types.js");
      const { ErrorCode } = await import("../../../src/errors/codes.js");

      const symlinkToolsDiag = [
        {
          code: "CONFIG_PATH_SYMLINK_ESCAPE",
          message: "Symlink escape tools",
          severity: "error" as const,
          resource: "tools" as const,
          value: "my-tools/escape",
          fatalInStrictContext: true
        }
      ];

      try {
        await checkDiscoveryPolicy("run-strict", symlinkToolsDiag, mockPrecollected);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.SECURITY_POLICY_VIOLATION);
      }
    });
  });
});
