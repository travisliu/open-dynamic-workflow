import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { validateCommand } from "../../../src/cli/commands/validate.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { resolve } from "node:path";
import * as fs from "node:fs";

describe("Validate Command", () => {
  it("valid workflow prints success", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fixturePath = resolve(process.cwd(), "tests/fixtures/workflows/valid-simple.js");
    
    await expect(
      validateCommand({
        workflowFile: fixturePath,
        rawOptions: {}
      })
    ).resolves.not.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("✓ Validated workflow \"valid-simple\" at"));
    logSpy.mockRestore();
  });

  it("invalid workflow throws WORKFLOW_VALIDATION_ERROR", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fixturePath = resolve(process.cwd(), "tests/fixtures/workflows/invalid-pipeline.js");

    await expect(
      validateCommand({
        workflowFile: fixturePath,
        rawOptions: {}
      })
    ).rejects.toThrow(OpenDynamicWorkflowError);

    try {
      await validateCommand({
        workflowFile: fixturePath,
        rawOptions: {}
      });
    } catch (err: any) {
      expect(err.code).toBe("WORKFLOW_VALIDATION_ERROR");
    }
    logSpy.mockRestore();
  });

  describe("initialization hints", () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReset();
    });

    afterEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it("attaches hint to eligible target resolution failure when config is missing", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes("config.yaml") || p.toString().includes(".open-dynamic-workflow")) {
          return false;
        }
        return true;
      });

      await expect(
        validateCommand({
          workflowFile: "non-existent-workflow",
          rawOptions: {},
        })
      ).rejects.toThrow(expect.objectContaining({
        code: "WORKFLOW_TARGET_NOT_FOUND",
        hint: expect.objectContaining({
          code: "PROJECT_INIT_MISSING",
        }),
      }));
    });

    it("does not attach hint to eligible target resolution failure when config exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true); // config exists

      await expect(
        validateCommand({
          workflowFile: "non-existent-workflow",
          rawOptions: {},
        })
      ).rejects.toThrow(expect.objectContaining({
        code: "WORKFLOW_TARGET_NOT_FOUND",
        hint: undefined,
      }));
    });

    it("does not attach hint to ineligible workflow validation errors even when config is missing", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes("config.yaml") || p.toString().includes(".open-dynamic-workflow")) {
          return false;
        }
        return true;
      });
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const fixturePath = resolve(process.cwd(), "tests/fixtures/workflows/invalid-pipeline.js");

      await expect(
        validateCommand({
          workflowFile: fixturePath,
          rawOptions: {},
        })
      ).rejects.toThrow(expect.objectContaining({
        code: "WORKFLOW_VALIDATION_ERROR",
        hint: undefined,
      }));

      logSpy.mockRestore();
    });
  });
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    promises: {
      ...actual.promises,
      stat: vi.fn().mockImplementation(async (p: any) => {
        if (p.toString().includes("workflows") || p.toString().includes("agents") || p.toString().includes("tools")) {
          return {
            isDirectory: () => true,
          } as any;
        }
        return actual.promises.stat(p);
      }),
      readdir: vi.fn().mockImplementation(async (p: any) => {
        if (p.toString().includes("workflows") || p.toString().includes("agents") || p.toString().includes("tools")) {
          return [];
        }
        return actual.promises.readdir(p);
      }),
    },
  };
});


