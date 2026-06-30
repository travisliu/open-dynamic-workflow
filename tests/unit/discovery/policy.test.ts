import { describe, expect, it } from "vitest";
import { applyDiscoveryPolicy } from "../../../src/discovery/policy.js";
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

  it("fatalInStrictContext is fatal in list-strict, validate, and run, but not list", () => {
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
    expect(validatePolicy.shouldFailBeforeLoad).toBe(true);

    const runPolicy = applyDiscoveryPolicy({
      context: "run",
      rawResult,
      configDiagnostics
    });
    expect(runPolicy.shouldFailBeforeLoad).toBe(true);
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
});
