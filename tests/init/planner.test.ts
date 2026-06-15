import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildInitPlan } from "../../src/cli/init/planner.js";
import * as fs from "node:fs/promises";
import { join } from "node:path";

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
    agentsDir: "/project/.openflow/agents",
    toolsDir: "/project/.openflow/tools"
  };

  const providerSelection = {
    defaultProvider: "mock" as const,
    selectedReason: "auto-detected" as const
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plans create actions for empty project", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const plan = await buildInitPlan({ options, providerSelection });

    expect(plan.targets.every(t => t.action === "create")).toBe(true);
    expect(plan.strictConflicts).toHaveLength(0);
  });

  it("plans skip actions for existing files by default", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockResolvedValue({ isFile: () => true } as any);

    const plan = await buildInitPlan({ options, providerSelection });

    const configTarget = plan.targets.find(t => t.displayPath === ".openflow/config.yaml");
    const workflowTarget = plan.targets.find(t => t.displayPath === "workflows/example.ts");

    expect(configTarget?.action).toBe("skip");
    expect(workflowTarget?.action).toBe("skip");
  });

  it("plans overwrite actions for existing files with --force", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockResolvedValue({ isFile: () => true } as any);

    const forceOptions = { ...options, force: true };
    const plan = await buildInitPlan({ options: forceOptions, providerSelection });

    const configTarget = plan.targets.find(t => t.displayPath === ".openflow/config.yaml");
    const workflowTarget = plan.targets.find(t => t.displayPath === "workflows/example.ts");

    expect(configTarget?.action).toBe("overwrite");
    expect(workflowTarget?.action).toBe("overwrite");
  });

  it("detects strict conflicts", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockResolvedValue({ isFile: () => true } as any);

    const strictOptions = { ...options, strict: true };
    const plan = await buildInitPlan({ options: strictOptions, providerSelection });

    expect(plan.strictConflicts.length).toBeGreaterThan(0);
    expect(plan.strictConflicts.some(t => t.displayPath === ".openflow/config.yaml")).toBe(true);
  });

  it("generates correct next steps", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const plan = await buildInitPlan({ options, providerSelection });

    expect(plan.nextSteps).toContain("openflow doctor");
    expect(plan.nextSteps).toContain("openflow run workflows/example.ts --provider mock");
  });

  it("marks a file at .openflow/agents as a conflict, not reuse-directory", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockImplementation(async (p: any) => {
      if (p === "/project/.openflow/agents") {
        return { isDirectory: () => false, isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const plan = await buildInitPlan({ options, providerSelection });
    const agentsTarget = plan.targets.find(t => t.displayPath === ".openflow/agents");

    expect(agentsTarget?.conflictReason).toMatch(/Cannot reuse "\.openflow\/agents" as a directory/);
    expect(plan.pathConflicts).toContain(agentsTarget);
  });

  it("detects parent-path file conflict for workflows/example.ts", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockImplementation(async (p: any) => {
      if (p === "/project/workflows") {
        return { isDirectory: () => false, isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const plan = await buildInitPlan({ options, providerSelection });
    const workflowTarget = plan.targets.find(t => t.displayPath === "workflows/example.ts");

    expect(workflowTarget?.conflictReason).toMatch(/parent path "workflows" is a file, not a directory/);
    expect(plan.pathConflicts).toContain(workflowTarget);
  });

  it("detects parent-path file conflict for unplanned parent .openflow", async () => {
    const mockStat = vi.mocked(fs.stat);
    mockStat.mockImplementation(async (p: any) => {
      if (p === "/project/.openflow") {
        return { isDirectory: () => false, isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const plan = await buildInitPlan({ options, providerSelection });
    const configTarget = plan.targets.find(t => t.displayPath === ".openflow/config.yaml");

    expect(configTarget?.conflictReason).toMatch(/parent path "\.openflow" is a file, not a directory/);
    expect(plan.pathConflicts).toContain(configTarget);
  });
});
