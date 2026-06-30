import { describe, expect, it, vi } from "vitest";
import { discoverWorkflowRegistry } from "../../../src/workflow/discovery.js";
import { loadWorkflow } from "../../../src/workflow/load.js";
import { parseWorkflow } from "../../../src/workflow/parse.js";
import { assertWorkflowValid } from "../../../src/workflow/validate.js";

vi.mock("../../../src/workflow/load.js");
vi.mock("../../../src/workflow/parse.js");
vi.mock("../../../src/workflow/validate.js");

describe("Workflow Discovery", () => {
  it("discovers workflows including root", async () => {
    const rootPath = "root.ts";
    const childPath = "child.ts";
    const cwd = "/test";

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => ({
      meta: { name: loaded.sourcePath === "/test/root.ts" ? "root" : "child", description: "test" },
      body: "",
      sourcePath: loaded.sourcePath,
      sourceText: loaded.sourceText,
      sourceHash: "123"
    }));

    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      include: ["workflows/**/*.ts"],
      candidatePaths: [childPath]
    });

    expect(registry.names()).toEqual(new Set(["root", "child"]));
    expect(vi.mocked(assertWorkflowValid)).toHaveBeenCalled();
  });



  it("fails on duplicate names during discovery", async () => {
    const rootPath = "root.ts";
    const childPath = "child.ts";
    const cwd = "/test";

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation(() => ({
      meta: { name: "duplicate", description: "test" },
      body: "",
      sourcePath: "any",
      sourceText: "any",
      sourceHash: "123"
    }));

    await expect(discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      include: [],
      candidatePaths: [childPath]
    })).rejects.toThrow(/Duplicate workflow name/);
  });

  it("rejects discovered paths escaping the project root", async () => {
    const rootPath = "root.ts";
    const childPath = "../outside.ts";
    const cwd = "/test/project";

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    await expect(discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      include: [],
      candidatePaths: [childPath]
    })).rejects.toThrow(/Workflow file outside project root/);
  });

  it("rejects symlinks pointing outside workspace during discovery", async () => {
    const { mkdtemp, rm, writeFile, symlink, realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    // Create a temp workspace directory
    const tempWorkspaceDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-ws-")));
    const tempOutsideDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-out-")));

    try {
      const rootPath = join(tempWorkspaceDir, "root.workflow.js");
      await writeFile(rootPath, "export const meta = { name: 'root', description: 'test' };");

      const outsideFile = join(tempOutsideDir, "outside.workflow.js");
      await writeFile(outsideFile, "export const meta = { name: 'outside', description: 'test' };");

      const symlinkPath = join(tempWorkspaceDir, "symlinked.workflow.js");
      await symlink(outsideFile, symlinkPath, "file");

      // Setup the mocks for load/parse to succeed if it reaches them
      vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
        sourcePath: p,
        sourceText: "content"
      }));

      vi.mocked(parseWorkflow).mockImplementation((loaded) => ({
        meta: { name: loaded.sourcePath === rootPath ? "root" : "symlinked", description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      }));

      // Now run discovery with the symlinked path included as a candidate or discovered
      await expect(discoverWorkflowRegistry({
        rootWorkflowPath: rootPath,
        cwd: tempWorkspaceDir,
        include: [],
        candidatePaths: [symlinkPath]
      })).rejects.toThrow(/Workflow file outside project root/);

    } finally {
      await rm(tempWorkspaceDir, { recursive: true, force: true });
      await rm(tempOutsideDir, { recursive: true, force: true });
    }
  });

  it("rejects root workflow path escaping the project root", async () => {
    const rootPath = "../outside-root.ts";
    const cwd = "/test/project";

    await expect(discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      include: [],
      candidatePaths: []
    })).rejects.toThrow(/Workflow file outside project root/);
  });

  it("deduplicates discovery by canonical path to avoid duplicate definition errors via symlinks", async () => {
    const { mkdtemp, rm, writeFile, symlink, realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempWorkspaceDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-ws-")));

    try {
      const rootPath = join(tempWorkspaceDir, "root.workflow.js");
      await writeFile(rootPath, "export const meta = { name: 'root', description: 'test' };");

      const symlinkPath = join(tempWorkspaceDir, "alias.workflow.js");
      await symlink(rootPath, symlinkPath, "file");

      // Setup the mocks for load/parse to succeed
      vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
        sourcePath: p,
        sourceText: "content"
      }));

      vi.mocked(parseWorkflow).mockImplementation((loaded) => ({
        meta: { name: "root", description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      }));

      const registry = await discoverWorkflowRegistry({
        rootWorkflowPath: rootPath,
        cwd: tempWorkspaceDir,
        include: [],
        candidatePaths: [symlinkPath]
      });

      expect(registry.names()).toEqual(new Set(["root"]));
    } finally {
      await rm(tempWorkspaceDir, { recursive: true, force: true });
    }
  });



  it("loads root plus pre-collected workflow candidates", async () => {
    const rootPath = "root.js";
    const cwd = "/test";

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => ({
      meta: { name: loaded.sourcePath === "/test/root.js" ? "root" : "child", description: "test" },
      body: "",
      sourcePath: loaded.sourcePath,
      sourceText: loaded.sourceText,
      sourceHash: "123"
    }));

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/workflows/child.js",
          relativePath: "workflows/child.js",
          realPath: "/test/workflows/child.js",
          sourcePattern: "workflows/*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: {
        exclude: [],
      }
    };

    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected
    });

    expect(registry.names()).toEqual(new Set(["root", "child"]));
  });

  it("supports all runtime extensions through pre-collected candidates", async () => {
    const rootPath = "root.ts";
    const cwd = "/test";

    const extensions = ["js", "ts", "mjs", "cjs"];
    const candidateFiles = extensions.map((ext) => ({
      resourceType: "workflow" as const,
      absolutePath: `/test/child.${ext}`,
      relativePath: `child.${ext}`,
      realPath: `/test/child.${ext}`,
      sourcePattern: `*.${ext}`,
      sourceConfigPath: "workflow.include[0]",
      source: "new" as const,
    }));

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => {
      const ext = loaded.sourcePath.split(".").pop();
      return {
        meta: { name: ext === "ts" && loaded.sourcePath.endsWith("root.ts") ? "root" : `child_${ext}`, description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      };
    });

    const precollected = {
      candidateFiles,
      discoveryPolicy: { exclude: [] }
    };

    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected
    });

    expect(registry.names()).toEqual(new Set(["root", "child_js", "child_ts", "child_mjs", "child_cjs"]));
  });

  it("does not rediscover when pre-collected input is present", async () => {
    const rootPath = "root.ts";
    const cwd = "/test";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/precollected.ts",
          relativePath: "precollected.ts",
          realPath: "/test/precollected.ts",
          sourcePattern: "*.ts",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: { exclude: [] }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => ({
      meta: { name: loaded.sourcePath === "/test/root.ts" ? "root" : "precollected", description: "test" },
      body: "",
      sourcePath: loaded.sourcePath,
      sourceText: loaded.sourceText,
      sourceHash: "123"
    }));

    const collectFiles = await import("../../../src/discovery/collect-files.js");
    const spy = vi.spyOn(collectFiles, "collectResourceCandidateFiles");

    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected,
      include: ["other/**/*.ts"],
      discovery: {
        include: ["other/**/*.ts"],
        exclude: [],
        compatibilityMode: "new-suffix-specific",
      }
    });

    expect(registry.names()).toEqual(new Set(["root", "precollected"]));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("narrows pre-collected candidates when candidatePaths is also provided", async () => {
    const rootPath = "root.js";
    const cwd = "/test";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/child-a.js",
          relativePath: "child-a.js",
          realPath: "/test/child-a.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        },
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/child-b.js",
          relativePath: "child-b.js",
          realPath: "/test/child-b.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: { exclude: [] }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => {
      let name = "unknown";
      if (loaded.sourcePath === "/test/root.js") name = "root";
      else if (loaded.sourcePath === "/test/child-a.js") name = "child-a";
      else if (loaded.sourcePath === "/test/child-b.js") name = "child-b";
      return {
        meta: { name, description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      };
    });

    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected,
      candidatePaths: ["child-a.js"]
    });

    expect(registry.names()).toEqual(new Set(["root", "child-a"]));
  });

  it("throws for invalid pre-collected candidate parse/load errors", async () => {
    const rootPath = "root.js";
    const cwd = "/test";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/invalid-child.js",
          relativePath: "invalid-child.js",
          realPath: "/test/invalid-child.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: { exclude: [] }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => {
      if (loaded.sourcePath.endsWith("invalid-child.js")) {
        throw new Error("Parse error");
      }
      return {
        meta: { name: "root", description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      };
    });

    await expect(discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected
    })).rejects.toThrow("Parse error");
  });

  it("preserves workspace safety for pre-collected candidates outside cwd", async () => {
    const rootPath = "root.js";
    const cwd = "/test/project";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/outside.js",
          relativePath: "../outside.js",
          realPath: "/test/outside.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: { exclude: [] }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    await expect(discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected
    })).rejects.toThrow(/Workflow file outside project root/);
  });

  it("ignores non-workflow resource types in precollected candidates", async () => {
    const rootPath = "root.js";
    const cwd = "/test";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/child-wf.js",
          relativePath: "child-wf.js",
          realPath: "/test/child-wf.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        },
        {
          resourceType: "agent" as const,
          absolutePath: "/test/child-agent.js",
          relativePath: "child-agent.js",
          realPath: "/test/child-agent.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: { exclude: [] }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => {
      let name = "unknown";
      if (loaded.sourcePath === "/test/root.js") name = "root";
      else if (loaded.sourcePath === "/test/child-wf.js") name = "child-wf";
      else if (loaded.sourcePath === "/test/child-agent.js") name = "child-agent";
      return {
        meta: { name, description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      };
    });

    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected
    });

    expect(registry.names()).toEqual(new Set(["root", "child-wf"]));
  });

  it("ignores excludes on preselected workflows", async () => {
    const rootPath = "root.js";
    const cwd = "/test";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/child.js",
          relativePath: "child.js",
          realPath: "/test/child.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: {
        exclude: ["child.js"] // Excludes should be ignored by the loader
      }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => ({
      meta: { name: loaded.sourcePath === "/test/root.js" ? "root" : "child", description: "test" },
      body: "",
      sourcePath: loaded.sourcePath,
      sourceText: loaded.sourceText,
      sourceHash: "123"
    }));

    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected
    });

    expect(registry.names()).toEqual(new Set(["root", "child"]));
  });

  it("sorts workflow candidates deterministically by relativePath", async () => {
    const rootPath = "root.js";
    const cwd = "/test";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/z.js",
          relativePath: "z.js",
          realPath: "/test/z.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        },
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/a.js",
          relativePath: "a.js",
          realPath: "/test/a.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: { exclude: [] }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    const parsedPathsOrder: string[] = [];
    vi.mocked(parseWorkflow).mockImplementation((loaded) => {
      parsedPathsOrder.push(loaded.sourcePath);
      let name = "unknown";
      if (loaded.sourcePath === "/test/root.js") name = "root";
      else if (loaded.sourcePath === "/test/a.js") name = "a";
      else if (loaded.sourcePath === "/test/z.js") name = "z";
      return {
        meta: { name, description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      };
    });

    await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected
    });

    // Root is processed first, then candidates sorted by relativePath: a.js, then z.js
    expect(parsedPathsOrder).toEqual(["/test/root.js", "/test/a.js", "/test/z.js"]);
  });

  it("comprehensive WF-001 to WF-005 workflow discovery handoff verification", async () => {
    // WF-001 to WF-003 (Arrange):
    // Set up a root workflow, mixed precollected candidates (workflows, agents, tools).
    // Include candidatePaths (to narrow options, so only 'child-a' gets loaded).
    // Include a candidate matching the exclude policy (child-a.js is excluded in discoveryPolicy but must load).
    const rootPath = "root.js";
    const cwd = "/test";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/child-a.js",
          relativePath: "child-a.js",
          realPath: "/test/child-a.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        },
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/child-b.js",
          relativePath: "child-b.js",
          realPath: "/test/child-b.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        },
        {
          resourceType: "agent" as const,
          absolutePath: "/test/agent-a.js",
          relativePath: "agent-a.js",
          realPath: "/test/agent-a.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: {
        exclude: ["child-a.js"] // Matches candidate child-a.js
      }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    const parsedPathsOrder: string[] = [];
    vi.mocked(parseWorkflow).mockImplementation((loaded) => {
      parsedPathsOrder.push(loaded.sourcePath);
      let name = "unknown";
      if (loaded.sourcePath === "/test/root.js") name = "root";
      else if (loaded.sourcePath === "/test/child-a.js") name = "child-a";
      else if (loaded.sourcePath === "/test/child-b.js") name = "child-b";
      return {
        meta: { name, description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      };
    });

    // Mock/Spy the candidate file collector to verify directory walking does NOT occur.
    const collectFiles = await import("../../../src/discovery/collect-files.js");
    const spy = vi.spyOn(collectFiles, "collectResourceCandidateFiles");

    // WF-004 (Act):
    // Invoke workflow discovery with precollected candidates and candidatePaths to narrow.
    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected,
      candidatePaths: ["child-a.js"] // Narrowing works
    });

    // WF-005 (Assert):
    // Verify only workflows are processed in deterministic order, candidatePaths narrowing works,
    // excludes are ignored for preselected workflows, and no directory walking occurs.
    expect(registry.names()).toEqual(new Set(["root", "child-a"]));

    // Verify ordering
    expect(parsedPathsOrder).toEqual(["/test/root.js", "/test/child-a.js"]);

    // Verify collectResourceCandidateFiles was NOT called
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("precollected wins over conflicting candidatePaths input", async () => {
    const rootPath = "root.js";
    const cwd = "/test";

    const precollected = {
      candidateFiles: [
        {
          resourceType: "workflow" as const,
          absolutePath: "/test/child-precollected.js",
          relativePath: "child-precollected.js",
          realPath: "/test/child-precollected.js",
          sourcePattern: "*.js",
          sourceConfigPath: "workflow.include[0]",
          source: "new" as const,
        }
      ],
      discoveryPolicy: { exclude: [] }
    };

    vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
      sourcePath: p,
      sourceText: "content"
    }));

    vi.mocked(parseWorkflow).mockImplementation((loaded) => {
      let name = "unknown";
      if (loaded.sourcePath === "/test/root.js") name = "root";
      else if (loaded.sourcePath === "/test/child-precollected.js") name = "child-precollected";
      else if (loaded.sourcePath === "/test/child-candidate-path.js") name = "child-candidate-path";
      return {
        meta: { name, description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      };
    });

    const registry = await discoverWorkflowRegistry({
      rootWorkflowPath: rootPath,
      cwd,
      precollected,
      candidatePaths: ["child-candidate-path.js"]
    });

    expect(registry.names()).toEqual(new Set(["root"]));
  });
});
