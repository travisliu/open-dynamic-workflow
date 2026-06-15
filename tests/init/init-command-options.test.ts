import { describe, it, expect, vi, beforeEach } from "vitest";
import { initCommand } from "../../src/cli/commands/init.js";
import { ErrorCode } from "../../src/errors/codes.js";
import { OpenFlowError } from "../../src/errors/types.js";

describe("init command orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultDeps = {
    stdin: {} as any,
    stdout: { write: vi.fn() } as any,
    stderr: { write: vi.fn() } as any,
    isTty: false,
    detectProviders: vi.fn().mockResolvedValue([{ name: "mock", detected: true, builtIn: true }]),
    selectProviderNonInteractive: vi.fn().mockReturnValue({ defaultProvider: "mock", selectedReason: "mock-fallback" }),
    buildInitPlan: vi.fn().mockResolvedValue({
      cwd: "/test",
      providerSelection: { defaultProvider: "mock" },
      targets: [],
      strictConflicts: [],
      pathConflicts: [],
      nextSteps: []
    }),
    applyInitPlan: vi.fn().mockResolvedValue({ created: [], overwritten: [], skipped: [], reusedDirectories: [] }),
    runInitSmokeTest: vi.fn().mockResolvedValue({ requested: true, validateStatus: "succeeded", runStatus: "succeeded" }),
    promptProviderSelection: vi.fn(),
    promptUnavailableRequestedProvider: vi.fn(),
    confirmInitPlan: vi.fn()
  };

  it("succeeds with --yes in non-TTY environment", async () => {
    await initCommand({
      rawOptions: { yes: true },
      deps: defaultDeps
    });

    expect(defaultDeps.detectProviders).toHaveBeenCalled();
    expect(defaultDeps.selectProviderNonInteractive).toHaveBeenCalled();
    expect(defaultDeps.applyInitPlan).toHaveBeenCalled();
    expect(defaultDeps.promptProviderSelection).not.toHaveBeenCalled();
  });

  it("fails with --force and --strict", async () => {
    await expect(initCommand({
      rawOptions: { force: true, strict: true },
      deps: defaultDeps
    })).rejects.toThrow("Cannot combine --force and --strict.");
    expect(defaultDeps.detectProviders).not.toHaveBeenCalled();
  });

  it("fails with --report without --run-smoke-test", async () => {
    await expect(initCommand({
      rawOptions: { report: "pretty" },
      deps: defaultDeps
    })).rejects.toThrow("--report requires --run-smoke-test.");
    expect(defaultDeps.detectProviders).not.toHaveBeenCalled();
  });

  it("fails with --report jsonl", async () => {
    await expect(initCommand({
      rawOptions: { runSmokeTest: true, report: "jsonl" },
      deps: defaultDeps
    })).rejects.toThrow("Invalid report mode for init: 'jsonl'");
    expect(defaultDeps.detectProviders).not.toHaveBeenCalled();
  });

  it("fails with unsupported provider", async () => {
    await expect(initCommand({
      rawOptions: { provider: "unsupported" },
      deps: defaultDeps
    })).rejects.toThrow("Unsupported provider: unsupported");
    expect(defaultDeps.detectProviders).not.toHaveBeenCalled();
  });

  it("fails with empty directory path for agentsDir", async () => {
    await expect(initCommand({
      rawOptions: { agentsDir: "" },
      deps: defaultDeps
    })).rejects.toThrow('Option "agents-dir" cannot be empty.');
    expect(defaultDeps.detectProviders).not.toHaveBeenCalled();
  });

  it("fails with path outside cwd for toolsDir", async () => {
    await expect(initCommand({
      rawOptions: { toolsDir: "../outside" },
      deps: defaultDeps
    })).rejects.toThrow(/must be inside the project directory/);
    expect(defaultDeps.detectProviders).not.toHaveBeenCalled();
  });

  it("fails with path outside cwd for agentsDir", async () => {
    await expect(initCommand({
      rawOptions: { agentsDir: "/absolute/outside" },
      deps: defaultDeps
    })).rejects.toThrow(/must be inside the project directory/);
    expect(defaultDeps.detectProviders).not.toHaveBeenCalled();
  });

  it("handles user cancellation in interactive provider selection", async () => {
    const deps = {
      ...defaultDeps,
      isTty: true,
      promptProviderSelection: vi.fn().mockResolvedValue("cancel")
    };

    await expect(initCommand({
      rawOptions: {},
      deps
    })).rejects.toThrow(new OpenFlowError(ErrorCode.USER_CANCELLED, "Initialization cancelled by user."));

    expect(deps.buildInitPlan).not.toHaveBeenCalled();
    expect(deps.applyInitPlan).not.toHaveBeenCalled();
  });

  it("handles strict mode conflicts", async () => {
    const deps = {
      ...defaultDeps,
      buildInitPlan: vi.fn().mockResolvedValue({
        strictConflicts: [{ displayPath: "conflict.ts" }],
        pathConflicts: []
      })
    };

    await expect(initCommand({
      rawOptions: { yes: true, strict: true },
      deps
    })).rejects.toThrow("Init target paths already exist in strict mode.");

    expect(deps.applyInitPlan).not.toHaveBeenCalled();
  });

  it("runs smoke test only when requested", async () => {
    await initCommand({
      rawOptions: { yes: true, runSmokeTest: true },
      deps: defaultDeps
    });
    expect(defaultDeps.runInitSmokeTest).toHaveBeenCalled();

    vi.clearAllMocks();

    await initCommand({
      rawOptions: { yes: true, runSmokeTest: false },
      deps: defaultDeps
    });
    expect(defaultDeps.runInitSmokeTest).not.toHaveBeenCalled();
  });

  it("handles interactive confirmation refusal", async () => {
    const deps = {
      ...defaultDeps,
      isTty: true,
      promptProviderSelection: vi.fn().mockResolvedValue({ defaultProvider: "mock", selectedReason: "interactive-choice" }),
      confirmInitPlan: vi.fn().mockResolvedValue(false)
    };

    await expect(initCommand({
      rawOptions: {},
      deps
    })).rejects.toThrow(new OpenFlowError(ErrorCode.USER_CANCELLED, "Initialization cancelled by user."));

    expect(deps.applyInitPlan).not.toHaveBeenCalled();
  });
});
