import { describe, it, expect, vi } from "vitest";
import { runInitSmokeTest } from "../../src/cli/init/smoke-test.js";
import { OpenFlowError } from "../../src/errors/types.js";
import { ErrorCode } from "../../src/errors/codes.js";

describe("runInitSmokeTest", () => {
  const defaultInput = {
    cwd: "/fake/cwd",
    workflowPath: "/fake/cwd/workflows/example.ts",
    report: "pretty" as const
  };

  it("returns success when both validate and run succeed", async () => {
    const validate = vi.fn().mockResolvedValue({ workflowName: "example", workflowFileRelative: "workflows/example.ts" });
    const run = vi.fn().mockResolvedValue(undefined);

    const result = await runInitSmokeTest({
      ...defaultInput,
      deps: { validateWorkflowService: validate, runWorkflowService: run }
    });

    expect(result).toEqual({
      requested: true,
      reportMode: "pretty",
      validateStatus: "succeeded",
      runStatus: "succeeded"
    });

    expect(validate).toHaveBeenCalledWith({
      workflowFile: defaultInput.workflowPath,
      rawOptions: { cwd: defaultInput.cwd }
    });

    expect(run).toHaveBeenCalledWith({
      workflowFile: defaultInput.workflowPath,
      rawOptions: {
        cwd: defaultInput.cwd,
        provider: "mock",
        report: "pretty"
      },
      deps: {
        stdout: undefined,
        stderr: undefined
      }
    });
  });

  it("reports validate failure and does not call run", async () => {
    const error = new OpenFlowError(ErrorCode.WORKFLOW_PARSE_ERROR, "failed to parse");
    const validate = vi.fn().mockRejectedValue(error);
    const run = vi.fn();

    const result = await runInitSmokeTest({
      ...defaultInput,
      deps: { validateWorkflowService: validate, runWorkflowService: run }
    });

    expect(result.validateStatus).toBe("failed");
    expect(result.runStatus).toBeUndefined();
    expect(result.error).toBe(error);
    expect(run).not.toHaveBeenCalled();
  });

  it("reports run failure after validate success", async () => {
    const error = new OpenFlowError(ErrorCode.PROVIDER_PROCESS_FAILED, "run failed");
    const validate = vi.fn().mockResolvedValue({ workflowName: "example", workflowFileRelative: "workflows/example.ts" });
    const run = vi.fn().mockRejectedValue(error);

    const result = await runInitSmokeTest({
      ...defaultInput,
      deps: { validateWorkflowService: validate, runWorkflowService: run }
    });

    expect(result.validateStatus).toBe("succeeded");
    expect(result.runStatus).toBe("failed");
    expect(result.error).toBe(error);
  });

  it("passes requested report mode to run service", async () => {
    const validate = vi.fn().mockResolvedValue({});
    const run = vi.fn().mockResolvedValue(undefined);

    await runInitSmokeTest({
      ...defaultInput,
      report: "json",
      deps: { validateWorkflowService: validate, runWorkflowService: run }
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      rawOptions: expect.objectContaining({
        report: "json"
      })
    }));
  });
});
