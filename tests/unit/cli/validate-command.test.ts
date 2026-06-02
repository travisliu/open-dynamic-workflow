import { describe, expect, it, vi } from "vitest";
import { validateCommand } from "../../../src/cli/commands/validate.js";
import { ExecflowError } from "../../../src/errors/types.js";
import { resolve } from "node:path";

describe("Validate Command", () => {
  it("valid workflow prints success", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fixturePath = resolve(process.cwd(), "tests/fixtures/workflows/valid-simple.js");
    
    await expect(
      validateCommand({
        workflowFile: fixturePath,
        rawOptions: {}
      })
    ).resolves.not.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("✓ Workflow is valid: valid-simple"));
    logSpy.mockRestore();
  });

  it("invalid workflow throws WORKFLOW_VALIDATION_ERROR", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fixturePath = resolve(process.cwd(), "tests/fixtures/workflows/invalid-pipeline.js");

    await expect(
      validateCommand({
        workflowFile: fixturePath,
        rawOptions: {}
      })
    ).rejects.toThrow(ExecflowError);

    try {
      await validateCommand({
        workflowFile: fixturePath,
        rawOptions: {}
      });
    } catch (err: any) {
      expect(err.code).toBe("WORKFLOW_VALIDATION_ERROR");
    }
    logSpy.mockRestore();
  });
});
