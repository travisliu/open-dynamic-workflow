import { describe, it, expect, vi } from "vitest";
import { formatInitSummary, formatStrictConflicts, formatCancellationMessage, printInitSummary } from "../../src/cli/init/summary.js";
import { InitResult } from "../../src/cli/init/types.js";

describe("init summary formatting", () => {
  const baseResult: InitResult = {
    plan: {
      cwd: "/test",
      providerSelection: {
        defaultProvider: "mock",
        selectedReason: "mock-fallback"
      },
      targets: [],
      strictConflicts: [],
      nextSteps: ["open-dynamic-workflow doctor", "open-dynamic-workflow run workflows/example.workflow.ts --provider mock"]
    },
    writeResult: {
      created: [".open-dynamic-workflow/config.yaml", "workflows/example.workflow.ts"],
      overwritten: [],
      skipped: [],
      reusedDirectories: [".open-dynamic-workflow/agents", ".open-dynamic-workflow/tools", "workflows"]
    },
    smokeTest: {
      requested: false,
      reportMode: "pretty"
    }
  };

  it("formats a standard success summary", () => {
    const output = formatInitSummary(baseResult);
    expect(output).toContain("Open Dynamic Workflow project initialized.");
    expect(output).toContain("Selected default provider: mock");
    expect(output).toContain("Reason: mock-fallback");
    expect(output).toContain("Created:");
    expect(output).toContain("  .open-dynamic-workflow/config.yaml");
    expect(output).toContain("Reused existing directories:");
    expect(output).toContain("  .open-dynamic-workflow/agents");
    expect(output).toContain("Next steps:");
    expect(output).toContain("  open-dynamic-workflow doctor");
  });

  it("formats summary with overwritten and skipped files", () => {
    const result = {
      ...baseResult,
      writeResult: {
        created: [".open-dynamic-workflow/config.yaml"],
        overwritten: ["workflows/example.workflow.ts"],
        skipped: ["existing-file.ts"],
        reusedDirectories: []
      }
    };
    const output = formatInitSummary(result);
    expect(output).toContain("Created:");
    expect(output).toContain("Overwritten:");
    expect(output).toContain("  workflows/example.workflow.ts");
    expect(output).toContain("Skipped existing files:");
    expect(output).toContain("  existing-file.ts");
  });

  it("includes smoke test results when requested and mode is pretty", () => {
    const result = {
      ...baseResult,
      smokeTest: {
        requested: true,
        validateStatus: "succeeded" as const,
        runStatus: "succeeded" as const,
        reportMode: "pretty" as const
      }
    };
    const output = formatInitSummary(result);
    expect(output).toContain("Smoke test result:");
    expect(output).toContain("  Validation: succeeded");
    expect(output).toContain("  Mock run: succeeded");
  });

  it("omits smoke test results when mode is json", () => {
    const result = {
      ...baseResult,
      smokeTest: {
        requested: true,
        validateStatus: "succeeded" as const,
        runStatus: "succeeded" as const,
        reportMode: "json" as const
      }
    };
    const output = formatInitSummary(result);
    expect(output).not.toContain("Smoke test result:");
  });

  it("formats strict conflicts correctly", () => {
    const plan = {
      ...baseResult.plan,
      strictConflicts: [
        { displayPath: ".open-dynamic-workflow/config.yaml", exists: true } as any
      ]
    };
    const output = formatStrictConflicts(plan);
    expect(output).toContain("Cannot initialize because --strict was provided and target paths already exist:");
    expect(output).toContain("  .open-dynamic-workflow/config.yaml");
    expect(output).toContain("No files were written.");
  });

  it("formats cancellation message", () => {
    expect(formatCancellationMessage()).toBe("Initialization cancelled. No files were written.");
  });

  it("prints summary to stdout in pretty mode", () => {
    const stdout = { write: vi.fn() } as any;
    const stderr = { write: vi.fn() } as any;
    printInitSummary({ result: baseResult, stdout, stderr });
    expect(stdout.write).toHaveBeenCalled();
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it("prints summary to stderr in JSON smoke test mode", () => {
    const result = {
      ...baseResult,
      smokeTest: { requested: true, reportMode: "json" as const }
    };
    const stdout = { write: vi.fn() } as any;
    const stderr = { write: vi.fn() } as any;
    printInitSummary({ result, stdout, stderr });
    expect(stdout.write).not.toHaveBeenCalled();
    expect(stderr.write).toHaveBeenCalled();
  });
});
