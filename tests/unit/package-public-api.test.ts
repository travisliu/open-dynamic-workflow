import { describe, it, expect, vi } from "vitest";
import type {
  WorkflowContext,
  WorkflowContextSnapshot,
  WorkflowContextSnapshotMetadata
} from "../../src/index.js";
import type { WorkflowRuntimeContext } from "../../src/types/workflow.js";

describe("package public API", () => {
  it("should export defineTool and isDefinedTool from index without executing CLI", async () => {
    // Arrange: type-only compile-time assertions
    type _AssertContext = WorkflowContext;
    type _AssertSnapshot = WorkflowContextSnapshot;
    type _AssertMetadata = WorkflowContextSnapshotMetadata;
    type _AssertRuntimeContextField = WorkflowRuntimeContext["context"];
    type _AssertRuntimeContextType = _AssertRuntimeContextField extends WorkflowContext ? true : never;

    // Act
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const originalExitCode = process.exitCode;

    // Act
    const m = await import("../../src/index.js");

    // Assert
    expect(typeof m.defineTool).toBe("function");
    expect(typeof m.isDefinedTool).toBe("function");

    // Assert: no stdout/stderr output (e.g. usage info)
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();

    // Assert: process.exitCode has not been changed
    expect(process.exitCode).toBe(originalExitCode);

    // Cleanup
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
