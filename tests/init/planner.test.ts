import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildInitPlan } from "../../src/cli/init/planner.js";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises");

describe("Init Planner Services", () => {
  const options = {
    cwd: "/project",
    interactive: false,
    force: false,
    strict: false,
    runSmokeTest: false,
    smokeReport: "pretty" as const,
    workflowsDir: "/project/workflows",
    agentsDir: "/project/.open-dynamic-workflow/agents",
    toolsDir: "/project/.open-dynamic-workflow/tools"
  };

  const providerSelection = {
    defaultProvider: "mock" as const,
    selectedReason: "auto-detected" as const
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("mock globals content");
  });

  it("plans create actions for empty project", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const plan = await buildInitPlan({ options, providerSelection });

    expect(plan.targets.every(t => t.action === "create")).toBe(true);
    expect(plan.strictConflicts).toHaveLength(0);

    const globals = plan.targets.find(t => t.generatedFileKind === "globals");
    const tool = plan.targets.find(t => t.generatedFileKind === "tool-template");
    expect(globals).toBeDefined();
    expect(globals?.path).toBe("/project/.open-dynamic-workflow/globals.d.ts");
    expect(tool).toBeDefined();
    expect(tool?.path).toBe("/project/.open-dynamic-workflow/tools/example.tool.ts");
  });

  it("plans skip actions for existing files by default", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockResolvedValue({ isFile: () => true } as any);

    const plan = await buildInitPlan({ options, providerSelection });

    const configTarget = plan.targets.find(t => t.displayPath === ".open-dynamic-workflow/config.yaml");
    const workflowTarget = plan.targets.find(t => t.displayPath === "workflows/example.workflow.ts");
    const globalsTarget = plan.targets.find(t => t.generatedFileKind === "globals");
    const toolTarget = plan.targets.find(t => t.generatedFileKind === "tool-template");

    expect(configTarget?.action).toBe("skip");
    expect(workflowTarget?.action).toBe("skip");
    expect(globalsTarget?.action).toBe("skip");
    expect(toolTarget?.action).toBe("skip");
  });

  it("plans overwrite actions for existing files with --force", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockResolvedValue({ isFile: () => true } as any);

    const forceOptions = { ...options, force: true };
    const plan = await buildInitPlan({ options: forceOptions, providerSelection });

    const configTarget = plan.targets.find(t => t.displayPath === ".open-dynamic-workflow/config.yaml");
    const workflowTarget = plan.targets.find(t => t.displayPath === "workflows/example.workflow.ts");
    const globalsTarget = plan.targets.find(t => t.generatedFileKind === "globals");
    const toolTarget = plan.targets.find(t => t.generatedFileKind === "tool-template");

    expect(configTarget?.action).toBe("overwrite");
    expect(workflowTarget?.action).toBe("overwrite");
    expect(globalsTarget?.action).toBe("overwrite");
    expect(toolTarget?.action).toBe("overwrite");
  });

  it("detects strict conflicts", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockResolvedValue({ isFile: () => true } as any);

    const strictOptions = { ...options, strict: true };
    const plan = await buildInitPlan({ options: strictOptions, providerSelection });

    expect(plan.strictConflicts.length).toBeGreaterThan(0);
    expect(plan.strictConflicts.some(t => t.displayPath === ".open-dynamic-workflow/config.yaml")).toBe(true);
    expect(plan.strictConflicts.some(t => t.generatedFileKind === "globals")).toBe(true);
    expect(plan.strictConflicts.some(t => t.generatedFileKind === "tool-template")).toBe(true);
  });

  it("generates correct next steps", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const plan = await buildInitPlan({ options, providerSelection });

    expect(plan.nextSteps).toContain("odw doctor");
    expect(plan.nextSteps).toContain("odw run workflows/example.workflow.ts --provider mock");
  });

  it("marks a file at .open-dynamic-workflow/agents as a conflict, not reuse-directory", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockImplementation(async (p: any) => {
      if (p === "/project/.open-dynamic-workflow/agents") {
        return { isDirectory: () => false, isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const plan = await buildInitPlan({ options, providerSelection });
    const agentsTarget = plan.targets.find(t => t.displayPath === ".open-dynamic-workflow/agents");

    expect(agentsTarget?.conflictReason).toMatch(/Cannot reuse "\.open-dynamic-workflow\/agents" as a directory/);
    expect(plan.pathConflicts).toContain(agentsTarget);
  });

  it("detects parent-path file conflict for workflows/example.workflow.ts", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockImplementation(async (p: any) => {
      if (p === "/project/workflows") {
        return { isDirectory: () => false, isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const plan = await buildInitPlan({ options, providerSelection });
    const workflowTarget = plan.targets.find(t => t.displayPath === "workflows/example.workflow.ts");

    expect(workflowTarget?.conflictReason).toMatch(/parent path "workflows" is a file, not a directory/);
    expect(plan.pathConflicts).toContain(workflowTarget);
  });

  it("detects parent-path file conflict for unplanned parent .open-dynamic-workflow", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockImplementation(async (p: any) => {
      if (p === "/project/.open-dynamic-workflow") {
        return { isDirectory: () => false, isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const plan = await buildInitPlan({ options, providerSelection });
    const configTarget = plan.targets.find(t => t.displayPath === ".open-dynamic-workflow/config.yaml");

    expect(configTarget?.conflictReason).toMatch(/parent path "\.open-dynamic-workflow" is a file, not a directory/);
    expect(plan.pathConflicts).toContain(configTarget);
  });

  it("detects conflict when a directory exists at file target path, even with force mode", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockImplementation(async (p: any) => {
      if (p === "/project/.open-dynamic-workflow/globals.d.ts" || p === "/project/.open-dynamic-workflow/tools/example.tool.ts") {
        return { isDirectory: () => true, isFile: () => false } as any;
      }
      throw new Error("ENOENT");
    });

    // Default mode
    const plan = await buildInitPlan({ options, providerSelection });
    const globalsTarget = plan.targets.find(t => t.generatedFileKind === "globals");
    const toolTarget = plan.targets.find(t => t.generatedFileKind === "tool-template");

    expect(globalsTarget?.conflictReason).toMatch(/Cannot reuse "\.open-dynamic-workflow\/globals\.d\.ts" as a file because it is a directory/);
    expect(toolTarget?.conflictReason).toMatch(/Cannot reuse "\.open-dynamic-workflow\/tools\/example\.tool\.ts" as a file because it is a directory/);
    expect(plan.pathConflicts).toContain(globalsTarget);
    expect(plan.pathConflicts).toContain(toolTarget);

    // Force mode
    const forceOptions = { ...options, force: true };
    const forcePlan = await buildInitPlan({ options: forceOptions, providerSelection });
    const forceGlobalsTarget = forcePlan.targets.find(t => t.generatedFileKind === "globals");
    const forceToolTarget = forcePlan.targets.find(t => t.generatedFileKind === "tool-template");

    expect(forceGlobalsTarget?.conflictReason).toMatch(/Cannot reuse "\.open-dynamic-workflow\/globals\.d\.ts" as a file because it is a directory/);
    expect(forceToolTarget?.conflictReason).toMatch(/Cannot reuse "\.open-dynamic-workflow\/tools\/example\.tool\.ts" as a file because it is a directory/);
    expect(forcePlan.pathConflicts).toContain(forceGlobalsTarget);
    expect(forcePlan.pathConflicts).toContain(forceToolTarget);
  });
});
