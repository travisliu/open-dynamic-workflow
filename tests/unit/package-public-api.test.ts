import { describe, it, expect, vi } from "vitest";
import type {
  WorkflowContext,
  WorkflowContextSnapshot,
  WorkflowContextSnapshotMetadata
} from "../../src/index.js";
import type { PipelineStageContext } from "../../src/pipeline/types.js";
import type { LoopContext } from "../../src/loop/types.js";

// @ts-expect-error removed type surface
import type { ParallelOptions } from "../../src/types/workflow.js";
// @ts-expect-error removed type surface
import type { ContextMergeStrategy } from "../../src/types/workflow.js";
// @ts-expect-error removed type surface
import type { PipelineContextOptions } from "../../src/pipeline/types.js";
// @ts-expect-error removed type surface
import type { LoopContextOptions } from "../../src/loop/types.js";

describe("package public API", () => {
  it("should export defineTool and isDefinedTool from index without executing CLI", async () => {
    // Arrange: type-only compile-time assertions
    type _AssertContext = WorkflowContext;
    type _AssertSnapshot = WorkflowContextSnapshot;
    type _AssertMetadata = WorkflowContextSnapshotMetadata;
    type _RemovedParallelOptions = ParallelOptions;
    type _RemovedContextMergeStrategy = ContextMergeStrategy;
    type _RemovedPipelineContextOptions = PipelineContextOptions;
    type _RemovedLoopContextOptions = LoopContextOptions;
    type _PipelineStageContextHasNoContext = "context" extends keyof PipelineStageContext ? true : false;
    type _LoopContextHasNoContext = "context" extends keyof LoopContext ? true : false;

    const pipelineStageContextHasNoContext: _PipelineStageContextHasNoContext = false;
    const loopContextHasNoContext: _LoopContextHasNoContext = false;

    // Act
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const originalExitCode = process.exitCode;

    // Act
    const m = await import("../../src/index.js");

    // Assert
    expect(typeof m.defineTool).toBe("function");
    expect(typeof m.isDefinedTool).toBe("function");
    expect(pipelineStageContextHasNoContext).toBe(false);
    expect(loopContextHasNoContext).toBe(false);

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
