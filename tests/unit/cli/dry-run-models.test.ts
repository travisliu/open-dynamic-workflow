import { describe, expect, it, vi } from "vitest";
import { printDryRunSummary } from "../../../src/cli/print.js";

describe("Dry Run Models Output", () => {
  it("prints global default model and provider model details", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printDryRunSummary({
      workflowFile: "test-workflow.js",
      workflowName: "test-workflow",
      description: "testing dry run",
      phases: ["phase1"],
      provider: "mock",
      defaultModel: "my-global-model",
      providers: {
        mock: {
          command: "mock",
          args: [],
          defaultModel: "mock-model",
          modelArg: { flag: "--custom" }
        },
        gemini: {
          command: "gemini",
          args: [],
          defaultModel: null,
          modelArg: false
        }
      },
      concurrency: 2,
      timeoutMs: 1000,
      reportMode: "pretty",
      outDir: "runs"
    });

    const calls = logSpy.mock.calls.map(c => c[0] || "");
    const output = calls.join("\n");

    expect(output).toContain("Global default model: my-global-model");
    expect(output).toContain("mock: default model = mock-model, [model flag: --custom]");
    expect(output).toContain("gemini: default model = none, [no model selection]");

    logSpy.mockRestore();
  });
});
