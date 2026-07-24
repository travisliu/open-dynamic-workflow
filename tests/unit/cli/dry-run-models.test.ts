import { afterEach, describe, expect, it, vi } from "vitest";
import { printDryRunSummary } from "../../../src/cli/print.js";

describe("Dry Run Models Output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  });

  it("prints verbose output-root provenance and selected profile independently", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printDryRunSummary({
      workflowFile: "workflow.ts", workflowName: "workflow", description: "test", phases: [], provider: "mock",
      concurrency: 1, timeoutMs: 1000, reportMode: "pretty", outDir: "/tmp/profile-runs",
      outDirSource: "profile", selectedProfile: "ci", verbose: true
    });

    const output = logSpy.mock.calls.map((call) => call[0] || "").join("\n");
    expect(output).toContain("Artifacts root: /tmp/profile-runs");
    expect(output).toContain("Output-root source: profile");
    expect(output).toContain("Selected profile: ci");
  });

  it("prints a selected profile when its root falls through to config", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printDryRunSummary({
      workflowFile: "workflow.ts", workflowName: "workflow", description: "test", phases: [], provider: "mock",
      concurrency: 1, timeoutMs: 1000, reportMode: "pretty", outDir: "/tmp/config-runs",
      outDirSource: "config", selectedProfile: "fast", verbose: true
    });

    const output = logSpy.mock.calls.map((call) => call[0] || "").join("\n");
    expect(output).toContain("Output-root source: config");
    expect(output).toContain("Selected profile: fast");
  });

  it("prints a CLI output root independently from the selected profile", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printDryRunSummary({
      workflowFile: "workflow.ts", workflowName: "workflow", description: "test", phases: [], provider: "mock",
      concurrency: 1, timeoutMs: 1000, reportMode: "pretty", outDir: "/tmp/cli-runs",
      outDirSource: "cli", selectedProfile: "ci", verbose: true
    });

    const output = logSpy.mock.calls.map((call) => call[0] || "").join("\n");
    expect(output).toContain("Output-root source: cli");
    expect(output).toContain("Selected profile: ci");
  });

  it("keeps provenance and selected profile out of non-verbose output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printDryRunSummary({
      workflowFile: "workflow.ts", workflowName: "workflow", description: "test", phases: [], provider: "mock",
      concurrency: 1, timeoutMs: 1000, reportMode: "pretty", outDir: "/tmp/runs",
      outDirSource: "built-in-default", selectedProfile: "ci"
    });

    const output = logSpy.mock.calls.map((call) => call[0] || "").join("\n");
    expect(output).toContain("Artifacts root: /tmp/runs");
    expect(output).not.toContain("Output-root source:");
    expect(output).not.toContain("Selected profile:");
  });
});
