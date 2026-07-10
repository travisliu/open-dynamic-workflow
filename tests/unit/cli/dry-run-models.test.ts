import { describe, expect, it, vi } from "vitest";
import { printDryRunSummary } from "../../../src/cli/print.js";

describe("Dry Run Models Output", () => {
  it("prints global default model and provider model details for direct provider", () => {
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

    expect(output).toContain("Default provider: mock");
    expect(output).not.toContain("Alias chain:");
    expect(output).toContain("Global default model: my-global-model");
    expect(output).toContain("mock: default model = mock-model, [model flag: --custom]");
    expect(output).toContain("gemini: default model = none, [no model selection]");

    logSpy.mockRestore();
  });

  it("prints alias default provider details and chain when providerAlias is present", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printDryRunSummary({
      workflowFile: "test-workflow.js",
      workflowName: "test-workflow",
      description: "testing dry run with alias",
      phases: ["phase1"],
      provider: "my-alias",
      requestedProvider: "my-alias",
      resolvedProvider: "mock",
      providerAlias: "my-alias",
      providerAliasChain: ["root-alias", "mid-alias", "my-alias"],
      defaultModel: "my-global-model",
      providers: {
        mock: {
          command: "mock",
          args: [],
          defaultModel: "mock-model",
          modelArg: { flag: "--custom" }
        }
      },
      concurrency: 2,
      timeoutMs: 1000,
      reportMode: "pretty",
      outDir: "runs"
    });

    const calls = logSpy.mock.calls.map(c => c[0] || "");
    const output = calls.join("\n");

    expect(output).toContain("Default provider: my-alias (alias -> mock)");
    expect(output).toContain("Alias chain: root-alias -> mid-alias -> my-alias");
    expect(output).toContain("No providers were invoked.");
    
    // Ensure no internal configuration details or secret fields are printed
    expect(output).not.toContain("command:");
    expect(output).not.toContain("env:");
    expect(output).not.toContain("args:");
    expect(output).not.toContain("credentials");

    logSpy.mockRestore();
  });
});
