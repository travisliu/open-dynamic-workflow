import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyInitPlan } from "../../src/cli/init/writer.js";
import * as fs from "node:fs/promises";
import { ErrorCode } from "../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../src/errors/types.js";

vi.mock("node:fs/promises");

describe("Init Writer Services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies create actions", async () => {
    const mockMkdir = vi.mocked(fs.mkdir);
    const mockWriteFile = vi.mocked(fs.writeFile);

    const plan = {
      targets: [
        {
          kind: "file",
          action: "create",
          path: "/p/.open-dynamic-workflow/config.yaml",
          displayPath: ".open-dynamic-workflow/config.yaml",
          content: "config content"
        },
        {
          kind: "directory",
          action: "create",
          path: "/p/workflows",
          displayPath: "workflows"
        }
      ]
    } as any;

    const result = await applyInitPlan(plan);

    expect(mockMkdir).toHaveBeenCalledWith("/p/.open-dynamic-workflow", { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/p/.open-dynamic-workflow/config.yaml",
      "config content",
      { flag: "wx" }
    );
    expect(mockMkdir).toHaveBeenCalledWith("/p/workflows", { recursive: true });

    expect(result.created).toContain(".open-dynamic-workflow/config.yaml");
    expect(result.created).toContain("workflows");
  });

  it("applies overwrite actions", async () => {
    const mockWriteFile = vi.mocked(fs.writeFile);

    const plan = {
      targets: [
        {
          kind: "file",
          action: "overwrite",
          path: "/p/workflows/example.workflow.ts",
          displayPath: "workflows/example.workflow.ts",
          content: "workflow content"
        }
      ]
    } as any;

    const result = await applyInitPlan(plan);

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/p/workflows/example.workflow.ts",
      "workflow content",
      { flag: "w" }
    );
    expect(result.overwritten).toContain("workflows/example.workflow.ts");
  });

  it("skips skip actions", async () => {
    const mockWriteFile = vi.mocked(fs.writeFile);

    const plan = {
      targets: [
        {
          kind: "file",
          action: "skip",
          displayPath: "existing.ts"
        }
      ]
    } as any;

    const result = await applyInitPlan(plan);

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(result.skipped).toContain("existing.ts");
  });

  it("handles reuse-directory actions with safety check", async () => {
    const mockMkdir = vi.mocked(fs.mkdir);
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);

    const plan = {
      targets: [
        {
          kind: "directory",
          action: "reuse-directory",
          path: "/p/workflows",
          displayPath: "workflows"
        }
      ]
    } as any;

    const result = await applyInitPlan(plan);
    expect(mockMkdir).not.toHaveBeenCalled();
    expect(result.reusedDirectories).toContain("workflows");
  });

  it("fails if reuse-directory target is actually a file", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockResolvedValue({ isDirectory: () => false } as any);

    const plan = {
      targets: [
        {
          kind: "directory",
          action: "reuse-directory",
          path: "/p/workflows",
          displayPath: "workflows"
        }
      ]
    } as any;

    await expect(applyInitPlan(plan)).rejects.toThrow(/is not a directory/);
  });

  it("throws ARTIFACT_WRITE_FAILED on write race (EEXIST)", async () => {
    const mockWriteFile = vi.mocked(fs.writeFile);
    const error = new Error("File already exists") as any;
    error.code = "EEXIST";
    mockWriteFile.mockRejectedValue(error);

    const plan = {
      targets: [
        {
          kind: "file",
          action: "create",
          path: "/p/race.ts",
          displayPath: "race.ts",
          content: ""
        }
      ]
    } as any;

    await expect(applyInitPlan(plan)).rejects.toThrow(OpenDynamicWorkflowError);
    await expect(applyInitPlan(plan)).rejects.toMatchObject({
      code: ErrorCode.ARTIFACT_WRITE_FAILED,
      message: expect.stringContaining("write race")
    });
  });
});
