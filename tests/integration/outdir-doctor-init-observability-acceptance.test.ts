import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { main } from "../../src/cli/index.js";
import { doctorCommand } from "../../src/cli/commands/doctor.js";
import { loadConfig } from "../../src/config/load.js";
import { buildProfileCatalog, resolveSelectedProfile } from "../../src/config/profiles.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const legacyRootRelative = path.join(".open-dynamic-workflow", "runs");
const temporaryProjects: string[] = [];

interface CapturedInvocation {
  stdout: string;
  stderr: string;
  error: unknown;
}

async function createProject(): Promise<string> {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "odw-outdir-acceptance-"));
  temporaryProjects.push(project);
  return project;
}

async function invokeMain(args: string[]): Promise<CapturedInvocation> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  const logSpy = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    stdout.push(`${values.join(" ")}\n`);
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
    stderr.push(`${values.join(" ")}\n`);
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...values: unknown[]) => {
    stderr.push(`${values.join(" ")}\n`);
  });

  let error: unknown;
  try {
    await main(["node", "odw", ...args]);
  } catch (caught) {
    error = caught;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
  return { stdout: stdout.join(""), stderr: stderr.join(""), error };
}

function commanderHelpError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeCode = cause && typeof cause === "object" && "code" in cause ? (cause as { code?: unknown }).code : undefined;
  return code === "commander.helpDisplayed" || code === "commander.help" ||
    causeCode === "commander.helpDisplayed" || causeCode === "commander.help";
}

async function captureHelp(command: string): Promise<string> {
  const captured = await invokeMain([command, "--help"]);
  if (captured.error && !commanderHelpError(captured.error)) {
    throw captured.error;
  }
  return captured.stdout + captured.stderr;
}

async function writeDoctorProject(project: string, configYaml: string): Promise<string> {
  const configPath = path.join(project, ".open-dynamic-workflow", "config.yaml");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.mkdir(path.join(project, "workflows"), { recursive: true });
  await fs.writeFile(configPath, `defaultProvider: mock\n${configYaml}`);
  return configPath;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readYaml(target: string): Promise<unknown> {
  return parseYaml(await fs.readFile(target, "utf8"));
}

async function probeEntries(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root)).filter((entry) => entry.startsWith(".odw-write-probe-"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function invokeDoctorWithInjectedHealth(input: {
  rawOptions: Record<string, unknown>;
  healthResult: { ok: boolean; path: string; created: boolean; writable: boolean; message?: string };
}): Promise<CapturedInvocation & { checker: ReturnType<typeof vi.fn> }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => stdout.push(`${values.join(" ")}\n`));
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => stderr.push(`${values.join(" ")}\n`));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...values: unknown[]) => stderr.push(`${values.join(" ")}\n`));
  const checker = vi.fn(async () => input.healthResult);
  let error: unknown;
  try {
    await doctorCommand({
      rawOptions: input.rawOptions,
      deps: {
        artifactRootHealthChecker: checker,
        providerHealthChecker: {
          checkAll: async () => ({
            ok: true,
            providers: [{ provider: "mock", ok: true, message: "available", supportsModelSelection: true }],
          }),
        },
      },
    });
  } catch (caught) {
    error = caught;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
  return { stdout: stdout.join(""), stderr: stderr.join(""), error, checker };
}

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map((project) => fs.rm(project, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("configurable artifact runs root final acceptance: doctor, init, help, example, and release documents", () => {
  it("doctor creates and probes only the configured global relative root", async () => {
    // Arrange
    const project = await createProject();
    const configPath = await writeDoctorProject(project, "outDir: artifacts/runs\n");
    const root = path.join(project, "artifacts", "runs");
    const legacyRoot = path.join(project, legacyRootRelative);

    // Act
    const result = await invokeMain(["doctor", "--config", configPath, "--cwd", project]);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain(`Artifact runs root available: ${root}`);
    expect(await pathExists(root)).toBe(true);
    expect(await probeEntries(root)).toEqual([]);
    expect(await pathExists(legacyRoot)).toBe(false);
  });

  it("doctor selects an inherited profile root and reports its provenance", async () => {
    // Arrange
    const project = await createProject();
    const configPath = await writeDoctorProject(project, `outDir: global-runs
profiles:
  base:
    outDir: inherited-runs
  child:
    extends: base
`);
    const inheritedRoot = path.join(project, "inherited-runs");

    // Act
    const result = await invokeMain(["doctor", "--config", configPath, "--cwd", project, "--profile", "child", "--verbose"]);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain(`Artifact runs root available: ${inheritedRoot}`);
    expect(result.stdout).toContain("Output-root source: profile");
    expect(result.stdout).toContain("Selected profile: child");
    expect(await pathExists(inheritedRoot)).toBe(true);
    expect(await probeEntries(inheritedRoot)).toEqual([]);
    expect(await pathExists(path.join(project, "global-runs"))).toBe(false);
    expect(await pathExists(path.join(project, legacyRootRelative))).toBe(false);
  });

  it("doctor preserves a file conflict while completing healthy provider aggregation", async () => {
    // Arrange
    const project = await createProject();
    const rootFile = path.join(project, "runs-file");
    await fs.writeFile(rootFile, "sentinel bytes");
    const configPath = await writeDoctorProject(project, "outDir: runs-file\n");

    // Act
    const result = await invokeMain(["doctor", "--config", configPath, "--cwd", project]);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain(`Artifact runs root unavailable: ${rootFile}`);
    expect(result.stdout).toContain("directory is required");
    expect(result.stdout).not.toContain(`Artifact runs root available: ${rootFile}`);
    expect(result.stdout).toContain("mock");
    expect(await fs.readFile(rootFile, "utf8")).toBe("sentinel bytes");
    expect(await pathExists(path.join(project, legacyRootRelative))).toBe(false);
  });

  it("renders an injected EACCES readiness failure without creating a candidate root", async () => {
    // Arrange
    const project = await createProject();
    const configPath = await writeDoctorProject(project, "outDir: unavailable-runs\n");
    const root = path.join(project, "unavailable-runs");

    // Act
    const result = await invokeDoctorWithInjectedHealth({
      rawOptions: { config: configPath, cwd: project },
      healthResult: { ok: false, path: root, created: false, writable: false, message: "access failed: EACCES" },
    });

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.checker).toHaveBeenCalledOnce();
    expect(result.checker).toHaveBeenCalledWith({ runsRoot: root, createIfMissing: true });
    expect(result.stdout).toContain(`Artifact runs root unavailable: ${root}`);
    expect(result.stdout).toContain("EACCES");
    expect(result.stdout).not.toContain(`Artifact runs root available: ${root}`);
    expect(await pathExists(root)).toBe(false);
  });

  it("keeps global root provenance when a selected profile falls through", async () => {
    // Arrange
    const project = await createProject();
    const configPath = await writeDoctorProject(project, "outDir: global-runs\nprofiles:\n  selected: {}\n");
    const root = path.join(project, "global-runs");

    // Act
    const result = await invokeDoctorWithInjectedHealth({
      rawOptions: { config: configPath, cwd: project, profile: "selected", verbose: true },
      healthResult: { ok: true, path: root, created: false, writable: true },
    });

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.checker).toHaveBeenCalledWith({ runsRoot: root, createIfMissing: true });
    expect(result.stdout).toContain("Output-root source: config");
    expect(result.stdout).toContain("Selected profile: selected");
    expect(await pathExists(root)).toBe(false);
  });

  it("fails invalid config and missing explicit profiles before doctor readiness work", async () => {
    // Arrange
    const invalidProject = await createProject();
    const invalidConfig = await writeDoctorProject(invalidProject, "outDir: '   '\n");
    const invalidDefaultRoot = path.join(invalidProject, legacyRootRelative);
    const profileProject = await createProject();
    const profileConfig = await writeDoctorProject(profileProject, "outDir: candidate-runs\n");
    const candidateRoot = path.join(profileProject, "candidate-runs");

    // Act
    const invalidResult = await invokeMain(["doctor", "--config", invalidConfig, "--cwd", invalidProject]);
    const missingProfileResult = await invokeMain(["doctor", "--config", profileConfig, "--cwd", profileProject, "--profile", "missing"]);

    // Assert
    expect((invalidResult.error as { code?: string } | undefined)?.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(String((invalidResult.error as Error | undefined)?.message)).toMatch(/outDir/i);
    expect(invalidResult.stdout).not.toContain("Artifact runs root available");
    expect(await pathExists(invalidDefaultRoot)).toBe(false);
    expect((missingProfileResult.error as { code?: string } | undefined)?.code).toBe("CLI_USAGE_ERROR");
    expect(String((missingProfileResult.error as Error | undefined)?.message)).toMatch(/missing/i);
    expect(missingProfileResult.stdout).not.toContain("Artifact runs root available");
    expect(await pathExists(candidateRoot)).toBe(false);
    expect(await pathExists(path.join(profileProject, legacyRootRelative))).toBe(false);
  });

  it("ordinary init writes the exact default outDir but leaves its runs root absent", async () => {
    // Arrange
    const project = await createProject();

    // Act
    const result = await invokeMain(["init", "--yes", "--cwd", project]);
    const generatedConfig = await readYaml(path.join(project, ".open-dynamic-workflow", "config.yaml")) as { outDir?: unknown };

    // Assert
    expect(result.error).toBeUndefined();
    expect(generatedConfig.outDir).toBe(".open-dynamic-workflow/runs");
    expect(await pathExists(path.join(project, ".open-dynamic-workflow", "config.yaml"))).toBe(true);
    expect(await pathExists(path.join(project, "workflows", "example.workflow.ts"))).toBe(true);
    expect(await pathExists(path.join(project, legacyRootRelative))).toBe(false);
  });

  it("keeps run, resume, and doctor help aligned with artifact-root semantics", async () => {
    // Arrange
    const precedenceLevels = [
      "--out",
      "selected profile outDir",
      "explicit top-level config outDir",
      ".open-dynamic-workflow/runs",
    ];

    // Act
    const runHelp = await captureHelp("run");
    const resumeHelp = await captureHelp("resume");
    const doctorHelp = await captureHelp("doctor");

    // Assert
    expect(runHelp).toContain("Artifact runs root (parent of <runId>)");
    const normalizedRunHelp = runHelp.replace(/\s+/g, " ");
    let previousPrecedenceIndex = -1;
    for (const level of precedenceLevels) {
      const index = normalizedRunHelp.indexOf(level);
      expect(index).toBeGreaterThan(previousPrecedenceIndex);
      previousPrecedenceIndex = index;
    }
    expect(runHelp).toContain("Relative values resolve from\nthe active --cwd");
    expect(runHelp).toContain("literal and are not expanded");
    expect(runHelp).toContain("without creating or probing the output root");
    expect(resumeHelp).toContain("effective current lookup root, then legacy");
    expect(resumeHelp).toContain("never fall back");
    expect(resumeHelp).toContain("fresh ID under\nthe current effective artifact runs root");
    expect(resumeHelp).toContain("--profile <name>");
    expect(resumeHelp).not.toContain("--profiles <path>");
    expect(doctorHelp).toContain("--profile <name>");
    expect(doctorHelp).not.toContain("--profiles <path>");
    expect(doctorHelp).not.toContain("--out <path>");
    expect(doctorHelp).toContain("checks that profile's resolved\nartifact runs root");
  });

  it("loads the canonical example and resolves ci-retry to its inherited profile root", async () => {
    // Arrange
    const project = await createProject();
    const examplePath = fileURLToPath(new URL("../../examples/configurable-artifact-runs.config.yaml", import.meta.url));
    const originalBytes = await fs.readFile(examplePath);
    const parsed = parseYaml(originalBytes.toString()) as { outDir?: unknown; profiles?: Record<string, { outDir?: unknown; extends?: unknown }> };
    expect(parsed.outDir).toBe(".open-dynamic-workflow/runs");
    expect(parsed.profiles?.ci?.outDir).toBe(".artifacts/ci-runs");
    expect(parsed.profiles?.["ci-retry"]?.extends).toBe("ci");
    const baseConfig = await loadConfig({ cwd: project, configPath: examplePath, cli: {} });
    const catalogResult = buildProfileCatalog({ configProfiles: baseConfig.profiles, configPath: baseConfig.configPath });
    const selectedResult = resolveSelectedProfile({ selectedName: "ci-retry", catalog: catalogResult.catalog, hasExternalFile: false });
    if (!selectedResult.selection) {
      throw new Error("Expected canonical example to resolve the ci-retry profile.");
    }

    // Act
    const finalConfig = await loadConfig({
      cwd: project,
      configPath: examplePath,
      cli: {},
      selectedProfileName: "ci-retry",
      selectedProfile: selectedResult.selection.resolved,
    });

    // Assert
    expect(baseConfig.outDir).toBe(path.resolve(project, ".open-dynamic-workflow/runs"));
    expect(baseConfig._resolution.outDir.source).toBe("config");
    expect(finalConfig.outDir).toBe(path.resolve(project, ".artifacts/ci-runs"));
    expect(finalConfig._resolution.outDir.source).toBe("profile");
    expect(finalConfig._resolution.outDir.selectedProfile).toBe("ci-retry");
    expect(await fs.readFile(examplePath)).toEqual(originalBytes);
  });

  it("keeps release documents explicit about configurable roots and safe compatibility", async () => {
    // Arrange
    const documents = await Promise.all([
      fs.readFile(path.join(repositoryRoot, "README.md"), "utf8"),
      fs.readFile(path.join(repositoryRoot, "skills/open-dynamic-workflow/references/configuration.md"), "utf8"),
      fs.readFile(path.join(repositoryRoot, "skills/open-dynamic-workflow/references/cli-commands.md"), "utf8"),
      fs.readFile(path.join(repositoryRoot, "skills/open-dynamic-workflow/references/api-document.md"), "utf8"),
      fs.readFile(path.join(repositoryRoot, "CHANGELOG.md"), "utf8"),
    ]);
    const [readme, configuration, cliCommands, apiDocument, changelog] = documents;

    // Act
    const unreleased = changelog.match(/## \[Unreleased\][\s\S]*?(?=\n## \[|$)/)?.[0] ?? "";

    // Assert
    expect(readme).toContain("run directory       = <outDir>/<runId>");
    expect(readme).toMatch(/--out[\s\S]*selected profile[\s\S]*explicit top-level[\s\S]*built-in/i);
    expect(readme).toMatch(/literal[^.]*not expanded/i);
    expect(readme).toMatch(/Ordinary `init`[^.]*does not create the root/i);
    expect(readme).toMatch(/`validate`, `list`, and `run --dry-run` neither create nor readiness-probe/i);
    expect(readme).toMatch(/doctor[^.]*readiness/i);
    expect(configuration).toContain("| `outDir` | `string` | `\".open-dynamic-workflow/runs\"`");
    expect(configuration).toContain("optional artifact runs root");
    expect(configuration).toContain("direct or inherited `outDir`");
    expect(configuration).toContain("`cli`, `profile`, `config`, or `built-in-default`");
    expect(configuration).toContain("Command side effects for the runs root");
    expect(configuration).toMatch(/v2[\s\S]*v1 run input\. Stored roots/i);
    expect(cliCommands).toMatch(/bare ID[\s\S]*legacy[\s\S]*fallback/i);
    expect(cliCommands).toMatch(/Explicit relative and absolute paths[\s\S]*never fall back/i);
    expect(cliCommands).toMatch(/continuation writes a fresh directory/i);
    expect(cliCommands).toContain("open-dynamic-workflow doctor [--profile <name>]");
    expect(apiDocument).toContain("<outDir>/<runId>");
    expect(apiDocument).toContain("Path text is literal: no home-directory, environment-variable, or template interpolation occurs.");
    expect(apiDocument).toMatch(/custom, shared, and external roots need the same protection/i);
    expect(apiDocument).toMatch(/v1 run input[\s\S]*current configuration/i);
    expect(unreleased).toContain("Configurable Artifact Runs Roots");
    expect(unreleased).toContain("Strict Runs Layout");
    expect(unreleased).toContain("Safe Resume Root Lookup");
    expect(unreleased).toContain("Resolved-Root Doctor Readiness");
    expect(unreleased).toContain("No-Write Inspection Commands");
  });
});
