import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { main } from "../../../src/cli/index.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { runCommand } from "../../../src/cli/commands/run.js";
import { validateCommand } from "../../../src/cli/commands/validate.js";

vi.mock("../../../src/cli/commands/run.js", () => ({
  runCommand: vi.fn(),
}));

vi.mock("../../../src/cli/commands/validate.js", () => ({
  validateCommand: vi.fn(),
}));

// Mock process.exit during Commander execution
const originalExit = process.exit;

describe("CLI Profile Options Parsing", () => {
  let stdoutContent = "";
  let stderrContent = "";
  let writeStdoutSpy: any;
  let writeStderrSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutContent = "";
    stderrContent = "";
    writeStdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((str: any) => {
      stdoutContent += str;
      return true;
    });
    writeStderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((str: any) => {
      stderrContent += str;
      return true;
    });
    (process as any).exit = vi.fn();
  });

  afterEach(() => {
    writeStdoutSpy.mockRestore();
    writeStderrSpy.mockRestore();
    process.exit = originalExit;
  });

  const runHelp = async (cmd: string) => {
    try {
      await main(["node", "odw", cmd, "--help"]);
    } catch (err: any) {
      if (err.code !== "commander.helpDisplayed" && err.code !== "commander.help") {
        throw err;
      }
    }
  };

  it("run --help and validate --help show profile flags and examples", async () => {
    await runHelp("run");
    expect(stdoutContent).toContain("--profile <name>");
    expect(stdoutContent).toContain("--profiles <path>");
    expect(stdoutContent).toContain("Select a named run profile");
    expect(stdoutContent).toContain("Load an external YAML");
    expect(stdoutContent).toContain("odw run my-workflow --profile fast");
    expect(stdoutContent).toContain("odw run my-workflow --profiles .profiles.yml --profile ci");

    stdoutContent = "";
    await runHelp("validate");
    expect(stdoutContent).toContain("--profile <name>");
    expect(stdoutContent).toContain("--profiles <path>");
    expect(stdoutContent).toContain("Select a named run profile");
    expect(stdoutContent).toContain("Load an external YAML");
    expect(stdoutContent).toContain("odw validate my-workflow --profile fast");
    expect(stdoutContent).toContain("odw validate my-workflow --profiles .profiles.yml --profile ci");
  });

  it("resume --help, doctor --help, list --help, and init --help do not advertise either flag", async () => {
    for (const cmd of ["resume", "doctor", "list", "init"]) {
      stdoutContent = "";
      await runHelp(cmd);
      expect(stdoutContent).not.toContain("--profile <name>");
      expect(stdoutContent).not.toContain("--profiles <path>");
    }
  });

  it("run and validate commands forward profile and profiles options", async () => {
    await main(["node", "odw", "run", "my-wf", "--profile", "test-prof", "--profiles", "test-profs.yml"]);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowFile: "my-wf",
        rawOptions: expect.objectContaining({
          profile: "test-prof",
          profiles: "test-profs.yml",
        }),
      })
    );

    await main(["node", "odw", "validate", "my-wf", "--profile", "test-prof", "--profiles", "test-profs.yml"]);
    expect(validateCommand).toHaveBeenCalledTimes(1);
    expect(validateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowFile: "my-wf",
        rawOptions: expect.objectContaining({
          profile: "test-prof",
          profiles: "test-profs.yml",
        }),
      })
    );
  });

  it("rejects duplicate --profile or --profiles", async () => {
    await expect(
      main(["node", "odw", "run", "my-wf", "--profile", "p1", "--profile", "p2"])
    ).rejects.toThrow(expect.objectContaining({
      code: "CLI_USAGE_ERROR",
      message: expect.stringContaining("Duplicate option '--profile'"),
    }));

    await expect(
      main(["node", "odw", "run", "my-wf", "--profile=p1", "--profile=p2"])
    ).rejects.toThrow(expect.objectContaining({
      code: "CLI_USAGE_ERROR",
      message: expect.stringContaining("Duplicate option '--profile'"),
    }));

    await expect(
      main(["node", "odw", "run", "my-wf", "--profiles", "f1.yml", "--profiles", "f2.yml"])
    ).rejects.toThrow(expect.objectContaining({
      code: "CLI_USAGE_ERROR",
      message: expect.stringContaining("Duplicate option '--profiles'"),
    }));

    await expect(
      main(["node", "odw", "run", "my-wf", "--profiles=f1.yml", "--profiles=f2.yml"])
    ).rejects.toThrow(expect.objectContaining({
      code: "CLI_USAGE_ERROR",
      message: expect.stringContaining("Duplicate option '--profiles'"),
    }));
  });

  it("allows single occurrence of each flag together", async () => {
    await expect(
      main(["node", "odw", "run", "my-wf", "--profile", "p1", "--profiles", "f1.yml"])
    ).resolves.not.toThrow();
  });

  it("missing option value throws Commander usage error mapped to CLI_USAGE_ERROR", async () => {
    await expect(
      main(["node", "odw", "run", "my-wf", "--profile"])
    ).rejects.toThrow(expect.objectContaining({
      code: "CLI_USAGE_ERROR",
    }));

    await expect(
      main(["node", "odw", "run", "my-wf", "--profiles"])
    ).rejects.toThrow(expect.objectContaining({
      code: "CLI_USAGE_ERROR",
    }));
  });
});
