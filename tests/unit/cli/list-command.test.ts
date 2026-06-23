import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { listCommand } from "../../../src/cli/commands/list.js";
import { ExitCode } from "../../../src/errors/exit-codes.js";
import { PassThrough } from "node:stream";
import * as fs from "node:fs";
import { createListReporter } from "../../../src/output/list-reporter.js";

describe("listCommand", () => {
  let stdout: PassThrough;
  let stderr: PassThrough;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    stdout = new PassThrough();
    stderr = new PassThrough();
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  const mockDiscoveryService = {
    discover: vi.fn().mockResolvedValue({
      schemaVersion: "open-dynamic-workflow.list.v1",
      status: "succeeded",
      resourceTypes: ["workflow", "agent", "tool"],
      resources: [
        { type: "workflow", name: "test-workflow", description: "test desc", path: "test.ts", valid: true },
      ],
      warnings: [],
      errors: [],
      summary: {
        discoveredCount: 1,
        validCount: 1,
        warningCount: 0,
        errorCount: 0,
        countsByType: { workflow: 1 },
      },
    }),
  };

  it("successfully lists all resources by default", async () => {
    await listCommand({
      rawOptions: {},
      deps: {
        discoveryService: mockDiscoveryService as any,
        stdout,
        stderr,
      },
    });

    expect(mockDiscoveryService.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceTypes: ["workflow", "agent", "tool"],
      })
    );
    expect(process.exitCode).toBe(0);
  });

  const pluralTypes = [
    { plural: "workflows", expected: "workflow" },
    { plural: "agents", expected: "agent" },
    { plural: "tools", expected: "tool" },
  ];

  pluralTypes.forEach(({ plural, expected }) => {
    it(`targeted list ${plural} works`, async () => {
      await listCommand({
        resourceType: plural,
        rawOptions: {},
        deps: {
          discoveryService: mockDiscoveryService as any,
          stdout,
          stderr,
        },
      });

      expect(mockDiscoveryService.discover).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceTypes: [expected],
        })
      );
    });
  });

  const singularTypes = ["workflow", "agent", "tool", "unknown"];
  singularTypes.forEach((type) => {
    it(`fails on singular or unknown resource type: ${type}`, async () => {
      await expect(
        listCommand({
          resourceType: type,
          rawOptions: {},
          deps: {
            discoveryService: mockDiscoveryService as any,
            stdout,
            stderr,
          },
        })
      ).rejects.toThrow(/Invalid list resource type/);
    });
  });

  it("fails when --dir is used with 'all'", async () => {
    await expect(
      listCommand({
        rawOptions: { dir: "some/dir" },
        deps: {
          discoveryService: mockDiscoveryService as any,
          stdout,
          stderr,
        },
      })
    ).rejects.toThrow(/Option '--dir' is ambiguous/);
  });

  it("targeted list workflows accepts --dir", async () => {
    await listCommand({
      resourceType: "workflows",
      rawOptions: { dir: "my/workflows" },
      deps: {
        discoveryService: mockDiscoveryService as any,
        stdout,
        stderr,
      },
    });

    expect(mockDiscoveryService.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        directories: expect.objectContaining({
          workflowInclude: expect.arrayContaining([
            expect.stringContaining("my/workflows"),
          ]),
        }),
      })
    );
  });

  it("fails when resource-specific flag is used with targeted command", async () => {
    await expect(
      listCommand({
        resourceType: "workflows",
        rawOptions: { agentsDir: "some/dir" },
        deps: {
          discoveryService: mockDiscoveryService as any,
          stdout,
          stderr,
        },
      })
    ).rejects.toThrow(/Resource-specific directory flags.*are invalid on targeted list commands/);
  });

  it("sets exit code 3 in strict mode with errors", async () => {
    mockDiscoveryService.discover.mockResolvedValueOnce({
      schemaVersion: "open-dynamic-workflow.list.v1",
      status: "failed",
      resourceTypes: ["workflow"],
      resources: [],
      warnings: [],
      errors: [
        { severity: "error", resourceType: "workflow", path: "test.ts", code: "ERR", message: "error" }
      ],
      summary: {
        discoveredCount: 1,
        validCount: 0,
        warningCount: 0,
        errorCount: 1,
        countsByType: {},
      },
    });

    await listCommand({
      rawOptions: { strict: true },
      deps: {
        discoveryService: mockDiscoveryService as any,
        stdout,
        stderr,
      },
    });

    expect(process.exitCode).toBe(ExitCode.WorkflowInvalid);
  });

  it("sets exit code 8 on internal discovery failure", async () => {
    mockDiscoveryService.discover.mockResolvedValueOnce({
      schemaVersion: "open-dynamic-workflow.list.v1",
      status: "failed",
      resourceTypes: ["workflow"],
      resources: [],
      warnings: [],
      errors: [
        { severity: "error", resourceType: "workflow", path: "test.ts", code: "LIST_INTERNAL_ERROR", message: "boom" }
      ],
      summary: {
        discoveredCount: 0,
        validCount: 0,
        warningCount: 0,
        errorCount: 1,
        countsByType: {},
      },
    });

    await listCommand({
      rawOptions: {},
      deps: {
        discoveryService: mockDiscoveryService as any,
        stdout,
        stderr,
      },
    });

    expect(process.exitCode).toBe(ExitCode.InternalError);
  });

  describe("initialization hints", () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReset();
    });

    afterEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it("attaches hint to eligible warning diagnostics when config is missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false); // missing config

      const warningDiag = {
        severity: "warning" as const,
        resourceType: "workflow" as const,
        path: "workflows",
        code: "LIST_DIRECTORY_NOT_FOUND",
        message: "warning message",
      };

      mockDiscoveryService.discover.mockResolvedValueOnce({
        schemaVersion: "open-dynamic-workflow.list.v1",
        status: "succeeded",
        resourceTypes: ["workflow"],
        resources: [],
        warnings: [warningDiag],
        errors: [],
        summary: {
          discoveredCount: 0,
          validCount: 0,
          warningCount: 1,
          errorCount: 0,
          countsByType: {},
        },
      });

      const renderSpy = vi.fn();
      vi.mocked(createListReporter).mockReturnValueOnce({
        render: renderSpy,
      } as any);

      await listCommand({
        rawOptions: {},
        deps: {
          discoveryService: mockDiscoveryService as any,
          stdout,
          stderr,
        },
      });

      expect(renderSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          warnings: [
            expect.objectContaining({
              code: "LIST_DIRECTORY_NOT_FOUND",
              hint: expect.objectContaining({
                code: "PROJECT_INIT_MISSING",
                command: "odw init",
              }),
            }),
          ],
        })
      );
    });

    it("attaches hint to eligible error diagnostics when config is missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false); // missing config

      const errorDiag = {
        severity: "error" as const,
        resourceType: "agent" as const,
        path: "agents",
        code: "AGENT_DEFINITION_MISSING",
        message: "error message",
      };

      mockDiscoveryService.discover.mockResolvedValueOnce({
        schemaVersion: "open-dynamic-workflow.list.v1",
        status: "failed",
        resourceTypes: ["agent"],
        resources: [],
        warnings: [],
        errors: [errorDiag],
        summary: {
          discoveredCount: 0,
          validCount: 0,
          warningCount: 0,
          errorCount: 1,
          countsByType: {},
        },
      });

      const renderSpy = vi.fn();
      vi.mocked(createListReporter).mockReturnValueOnce({
        render: renderSpy,
      } as any);

      await listCommand({
        rawOptions: {},
        deps: {
          discoveryService: mockDiscoveryService as any,
          stdout,
          stderr,
        },
      });

      expect(renderSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          errors: [
            expect.objectContaining({
              code: "AGENT_DEFINITION_MISSING",
              hint: expect.objectContaining({
                code: "PROJECT_INIT_MISSING",
              }),
            }),
          ],
        })
      );
    });

    it("does not attach hint to ineligible diagnostics", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false); // missing config

      const ineligibleDiag = {
        severity: "warning" as const,
        resourceType: "workflow" as const,
        path: "workflows",
        code: "WORKFLOW_METADATA_INVALID",
        message: "warning message",
      };

      mockDiscoveryService.discover.mockResolvedValueOnce({
        schemaVersion: "open-dynamic-workflow.list.v1",
        status: "succeeded",
        resourceTypes: ["workflow"],
        resources: [],
        warnings: [ineligibleDiag],
        errors: [],
        summary: {
          discoveredCount: 0,
          validCount: 0,
          warningCount: 1,
          errorCount: 0,
          countsByType: {},
        },
      });

      const renderSpy = vi.fn();
      vi.mocked(createListReporter).mockReturnValueOnce({
        render: renderSpy,
      } as any);

      await listCommand({
        rawOptions: {},
        deps: {
          discoveryService: mockDiscoveryService as any,
          stdout,
          stderr,
        },
      });

      expect(renderSpy).toHaveBeenCalled();
      const calledArg = renderSpy.mock.calls[0]?.[0];
      expect(calledArg?.warnings?.[0]?.code).toBe("WORKFLOW_METADATA_INVALID");
      expect(calledArg?.warnings?.[0]?.hint).toBeUndefined();
    });

    it("strict-mode exit behavior is unchanged", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false); // missing config

      mockDiscoveryService.discover.mockResolvedValueOnce({
        schemaVersion: "open-dynamic-workflow.list.v1",
        status: "failed",
        resourceTypes: ["workflow"],
        resources: [],
        warnings: [],
        errors: [
          { severity: "error", resourceType: "workflow", path: "test.ts", code: "LIST_DIRECTORY_NOT_FOUND", message: "error" }
        ],
        summary: {
          discoveredCount: 1,
          validCount: 0,
          warningCount: 0,
          errorCount: 1,
          countsByType: {},
        },
      });

      await listCommand({
        rawOptions: { strict: true },
        deps: {
          discoveryService: mockDiscoveryService as any,
          stdout,
          stderr,
        },
      });

      expect(process.exitCode).toBe(ExitCode.WorkflowInvalid);
    });
  });
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

vi.mock("../../../src/output/list-reporter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/output/list-reporter.js")>();
  return {
    ...actual,
    createListReporter: vi.fn().mockImplementation((opts) => {
      const real = actual.createListReporter(opts);
      return {
        render: vi.fn(real.render.bind(real)),
      };
    }),
  };
});


