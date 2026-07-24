import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolveRunProfile: vi.fn(),
  resolvePreviousRun: vi.fn(),
  selectRunProfile: vi.fn(),
  legacyRunsRoot: vi.fn((cwd: string) => `${cwd}/.open-dynamic-workflow/runs`),
  readRunInput: vi.fn(),
  loadWorkflow: vi.fn(),
  parseWorkflow: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock("../../../src/config/load.js", () => ({ loadConfig: mocks.loadConfig }));
vi.mock("../../../src/cli/profile-resolution.js", () => ({ resolveRunProfile: mocks.resolveRunProfile }));
vi.mock("../../../src/cli/artifact-paths.js", () => ({
  legacyRunsRoot: mocks.legacyRunsRoot,
  resolvePreviousRun: mocks.resolvePreviousRun,
  selectRunProfile: mocks.selectRunProfile,
}));
vi.mock("../../../src/cli/run-input.js", () => ({ readRunInput: mocks.readRunInput }));
vi.mock("../../../src/workflow/load.js", () => ({ loadWorkflow: mocks.loadWorkflow }));
vi.mock("../../../src/workflow/parse.js", () => ({ parseWorkflow: mocks.parseWorkflow }));
vi.mock("../../../src/cli/commands/run.js", () => ({ runCommand: mocks.runCommand }));

import { resumeCommand } from "../../../src/cli/commands/resume.js";

const cwd = "/current";
const configPath = "/current/config.yaml";
const previous = { runDir: "/previous-runs/previous-id" };
const invocation = { args: ["saved=value"], report: "json" as const, noCache: false, failFast: false, verbose: false };

function config(outDir = "/current/runs", profiles: Record<string, unknown> = {}) {
  return { cwd, configPath, outDir, profiles };
}

function selection(name: string, outDir: string) {
  return {
    selected: name,
    resolved: { outDir, args: {}, run: {} },
    source: "config",
    hash: "profile-hash",
  };
}

function profileResult(name?: string, outDir = "/current/profile-runs") {
  return {
    profileRunAsCli: { config: {} },
    finalCliArgs: {},
    diagnostics: [],
    ...(name === undefined ? {} : { selection: selection(name, outDir) }),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    workflowFile: "/current/workflows/demo.workflow.js",
    workflowName: "demo",
    cwd,
    configPath,
    invocation,
    ...overrides,
  };
}

describe("resumeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockResolvedValue(config());
    mocks.resolveRunProfile.mockResolvedValue(profileResult());
    mocks.resolvePreviousRun.mockResolvedValue(previous);
    mocks.readRunInput.mockResolvedValue(input());
    mocks.loadWorkflow.mockResolvedValue("export default async () => {};");
    mocks.parseWorkflow.mockReturnValue({ meta: { name: "demo" } });
    mocks.runCommand.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the resolved explicit profile root for lookup and passes its metadata to final config loading", async () => {
    const selected = selection("current", "profile-runs");
    mocks.resolveRunProfile.mockResolvedValue({ ...profileResult(), selection: selected });
    mocks.loadConfig
      .mockResolvedValueOnce(config("/current/runs", { current: {} }))
      .mockResolvedValueOnce(config("/current/profile-runs", { current: {} }));

    await resumeCommand({ runIdOrPath: "previous-id", rawOptions: { cwd, config: configPath, profile: "current" } });

    expect(mocks.loadConfig).toHaveBeenLastCalledWith(expect.objectContaining({
      selectedProfileName: "current",
      selectedProfile: selected.resolved,
    }));
    expect(mocks.resolvePreviousRun).toHaveBeenCalledWith(expect.objectContaining({ effectiveRunsRoot: "/current/profile-runs" }));
  });

  it("looks up and reads first, then resolves a recorded profile fresh and delegates its name", async () => {
    const order: string[] = [];
    mocks.resolvePreviousRun.mockImplementation(async () => { order.push("resolve"); return previous; });
    mocks.readRunInput.mockImplementation(async () => { order.push("read"); return input({ recordedProfileName: "saved", output: { effectiveRunsRoot: "/old", explicitCliOut: "/historical-cli" } }); });
    mocks.resolveRunProfile.mockImplementation(async (value: any) => {
      order.push(value.rawOptions.profile === "saved" ? "profile" : "unexpected-profile");
      return profileResult("saved", "/current/saved-runs");
    });
    mocks.loadConfig.mockImplementation(async (value: any) => {
      order.push(value.selectedProfileName === "saved" ? "final-config" : "base-config");
      return config(value.selectedProfileName === "saved" ? "/current/saved-runs" : "/current/runs", { saved: {} });
    });

    await resumeCommand({ runIdOrPath: "previous-id", rawOptions: { cwd, config: configPath } });

    expect(order).toEqual(["base-config", "resolve", "read", "profile", "final-config"]);
    expect(mocks.runCommand).toHaveBeenCalledWith(expect.objectContaining({ rawOptions: expect.objectContaining({ profile: "saved" }) }));
    expect(mocks.runCommand.mock.calls[0][0].rawOptions.out).toBeUndefined();
  });

  it("uses raw current --out over a selected profile root and delegates only that raw value", async () => {
    const selected = selection("current", "profile-runs");
    mocks.resolveRunProfile.mockResolvedValue({ ...profileResult(), selection: selected });
    mocks.loadConfig
      .mockResolvedValueOnce(config("/cli-root", { current: {} }))
      .mockResolvedValueOnce(config("/cli-root", { current: {} }));

    await resumeCommand({ runIdOrPath: "previous-id", rawOptions: { cwd, config: configPath, profile: "current", out: "cli-root" } });

    expect(mocks.resolvePreviousRun).toHaveBeenCalledWith(expect.objectContaining({ effectiveRunsRoot: "/cli-root" }));
    expect(mocks.runCommand).toHaveBeenCalledWith(expect.objectContaining({ rawOptions: expect.objectContaining({ out: "cli-root", profile: "current" }) }));
  });

  it("rejects retry tuning with --no-retry before any previous-run I/O", async () => {
    await expect(resumeCommand({ runIdOrPath: "previous-id", rawOptions: { cwd, noRetry: true, retryDelayMs: "1" } }))
      .rejects.toMatchObject({ code: ErrorCode.CLI_USAGE_ERROR });
    expect(mocks.resolvePreviousRun).not.toHaveBeenCalled();
    expect(mocks.readRunInput).not.toHaveBeenCalled();
    expect(mocks.runCommand).not.toHaveBeenCalled();
  });

  it("fails an explicit missing profile before resolving or reading the previous run", async () => {
    mocks.selectRunProfile.mockImplementation(() => { throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, "Profile 'missing' was not found."); });

    await expect(resumeCommand({ runIdOrPath: "previous-id", rawOptions: { cwd, profile: "missing" } })).rejects.toMatchObject({ code: ErrorCode.CLI_USAGE_ERROR });
    expect(mocks.resolvePreviousRun).not.toHaveBeenCalled();
    expect(mocks.readRunInput).not.toHaveBeenCalled();
  });

  it("fails a missing recorded profile after resolving and reading, before delegation", async () => {
    mocks.readRunInput.mockResolvedValue(input({ recordedProfileName: "missing" }));
    mocks.selectRunProfile.mockImplementation(() => { throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, "Profile 'missing' was not found."); });

    await expect(resumeCommand({ runIdOrPath: "previous-id", rawOptions: { cwd, config: configPath } })).rejects.toMatchObject({ code: ErrorCode.CLI_USAGE_ERROR });
    expect(mocks.resolvePreviousRun).toHaveBeenCalledOnce();
    expect(mocks.readRunInput).toHaveBeenCalledWith(previous.runDir);
    expect(mocks.runCommand).not.toHaveBeenCalled();
  });
});
