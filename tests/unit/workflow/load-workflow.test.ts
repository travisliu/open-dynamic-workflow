import { describe, expect, it } from "vitest";
import { loadWorkflow } from "../../../src/workflow/load.js";
import { ExecflowError } from "../../../src/errors/types.js";
import { resolve } from "node:path";

describe("Load Workflow", () => {
  it("loads a valid workflow and normalizes line endings", async () => {
    const fixturePath = resolve(process.cwd(), "tests/fixtures/workflows/valid-simple.js");
    const loaded = await loadWorkflow(fixturePath, process.cwd());

    expect(loaded.sourcePath).toBe(fixturePath);
    expect(loaded.sourceText).toContain("export const meta = {");
    expect(loaded.sourceText).not.toContain("\r\n");
  });

  it("throws WORKFLOW_PARSE_ERROR if file does not exist", async () => {
    await expect(
      loadWorkflow("nonexistent-workflow.js", process.cwd())
    ).rejects.toThrow(ExecflowError);

    try {
      await loadWorkflow("nonexistent-workflow.js", process.cwd());
    } catch (err: any) {
      expect(err.code).toBe("WORKFLOW_PARSE_ERROR");
    }
  });
});
