import { describe, it, expect, vi } from "vitest";

describe("package public API", () => {
  it("should export defineTool and isDefinedTool from index without executing CLI", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const originalExitCode = process.exitCode;

    // Dynamically import the package entry point
    const m = await import("../../src/index.js");

    expect(typeof m.defineTool).toBe("function");
    expect(typeof m.isDefinedTool).toBe("function");

    // Ensure no stdout/stderr output (e.g. usage info)
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();

    // Ensure process.exitCode has not been changed
    expect(process.exitCode).toBe(originalExitCode);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
