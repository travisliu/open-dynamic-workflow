import { beforeEach, describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../../../src/cli/commands/doctor.js";
import { loadConfig } from "../../../src/config/load.js";
import { resolveRunProfile } from "../../../src/cli/profile-resolution.js";
import { precollectAllResourcesForLoad } from "../../../src/discovery/precollect.js";

vi.mock("../../../src/config/load.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../../src/cli/profile-resolution.js", () => ({ resolveRunProfile: vi.fn() }));
vi.mock("../../../src/tools/load.js", () => ({ loadToolRegistry: vi.fn().mockResolvedValue({ list: () => [] }) }));
vi.mock("../../../src/discovery/precollect.js", () => ({
  precollectAllResourcesForLoad: vi.fn().mockResolvedValue({
    workflow: { collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] } },
    sharedAgents: { collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] } },
    tools: { collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }, loadInput: {} },
  }),
}));

function config(outDir: string, source: "profile" | "config" | "built-in-default" = "config", selectedProfile?: string) {
  return {
    cwd: "/project",
    configPath: "/project/config.yaml",
    outDir,
    _resolution: { outDir: { path: outDir, rawValue: outDir, source, ...(selectedProfile ? { selectedProfile } : {}) } },
    defaultProvider: "mock",
    providers: { mock: { command: "mock", defaultModel: null } },
    providerAliases: {},
    _normalizedDiscovery: {},
    _configDiagnostics: [],
    tools: { maxDefinitions: 100 },
  } as any;
}

describe("doctor artifact root orchestration", () => {
  const providerHealthChecker = { checkAll: vi.fn().mockResolvedValue({ ok: true, providers: [] }) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveRunProfile).mockResolvedValue({ profileRunAsCli: { config: {} }, finalCliArgs: {}, diagnostics: [] } as any);
  });

  it("finalizes config before checking the resolved root exactly once", async () => {
    const base = config("/base/root");
    const finalized = config("/final/root");
    vi.mocked(loadConfig).mockResolvedValueOnce(base).mockResolvedValueOnce(finalized);
    const checker = vi.fn().mockResolvedValue({ ok: true, path: "/final/root", created: false, writable: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await doctorCommand({ rawOptions: { cwd: "/project" }, deps: { providerHealthChecker, artifactRootHealthChecker: checker } });

    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(checker).toHaveBeenCalledTimes(1);
    expect(checker).toHaveBeenCalledWith({ runsRoot: "/final/root", createIfMissing: true });
    expect(vi.mocked(loadConfig).mock.invocationCallOrder[1]).toBeLessThan(checker.mock.invocationCallOrder[0]);
    expect(precollectAllResourcesForLoad).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/project" }));
    log.mockRestore();
  });

  it("resolves an inherited selected profile before checking its root", async () => {
    const base = config("/global/root");
    const finalized = config("/profile/root", "profile", "child");
    const selection = { selected: "child", resolved: { outDir: "/profile/root", run: {}, args: {}, context: {} } };
    vi.mocked(loadConfig).mockResolvedValueOnce(base).mockResolvedValueOnce(finalized);
    vi.mocked(resolveRunProfile).mockResolvedValue({ profileRunAsCli: { config: {} }, finalCliArgs: {}, selection, diagnostics: [] } as any);
    const checker = vi.fn().mockResolvedValue({ ok: true, path: "/profile/root", created: false, writable: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await doctorCommand({ rawOptions: { cwd: "/project", profile: "child" }, deps: { providerHealthChecker, artifactRootHealthChecker: checker } });

    expect(resolveRunProfile).toHaveBeenCalledWith(expect.objectContaining({ rawOptions: { profile: "child" }, explicitArgs: {} }));
    expect(vi.mocked(loadConfig)).toHaveBeenLastCalledWith(expect.objectContaining({ selectedProfileName: "child", selectedProfile: selection.resolved }));
    expect(checker).toHaveBeenCalledWith({ runsRoot: "/profile/root", createIfMissing: true });
    log.mockRestore();
  });

  it("reports source and selected profile independently in verbose output", async () => {
    const selected = "child";
    vi.mocked(loadConfig).mockResolvedValue(config("/global/root", "config", selected));
    vi.mocked(resolveRunProfile).mockResolvedValue({
      profileRunAsCli: { config: {} }, finalCliArgs: {}, selection: { selected, resolved: { run: {}, args: {}, context: {} } }, diagnostics: [],
    } as any);
    const checker = vi.fn().mockResolvedValue({ ok: true, path: "/global/root", created: false, writable: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await doctorCommand({ rawOptions: { cwd: "/project", profile: selected, verbose: true }, deps: { providerHealthChecker, artifactRootHealthChecker: checker } });

    const output = log.mock.calls.map(([line]) => line).join("\n");
    expect(output).toContain("Output-root source: config");
    expect(output).toContain("Selected profile: child");
    log.mockRestore();
  });

  it("renders detailed root health failures", async () => {
    vi.mocked(loadConfig).mockResolvedValue(config("/final/root"));
    const checker = vi.fn().mockResolvedValue({ ok: false, path: "/final/root", created: false, writable: false, message: "directory is required" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await doctorCommand({ rawOptions: { cwd: "/project" }, deps: { providerHealthChecker, artifactRootHealthChecker: checker } });

    expect(log.mock.calls.map(([line]) => line).join("\n")).toContain("Artifact runs root unavailable: /final/root: directory is required");
    log.mockRestore();
  });

  it("does not check a root when config or profile resolution fails", async () => {
    const checker = vi.fn();
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error("invalid config"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(doctorCommand({ rawOptions: { cwd: "/project" }, deps: { providerHealthChecker, artifactRootHealthChecker: checker } })).rejects.toThrow("invalid config");
    expect(checker).not.toHaveBeenCalled();
  });
});
