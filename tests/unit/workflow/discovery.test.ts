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

  it("discovers workflows via include patterns when candidatePaths is omitted", async () => {
    const { mkdtemp, rm, writeFile, mkdir, realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempWorkspaceDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-omit-cp-")));

    try {
      const rootPath = join(tempWorkspaceDir, "root.ts");
      await writeFile(rootPath, "export const meta = { name: 'root', description: 'test' };");

      await mkdir(join(tempWorkspaceDir, "workflows"));
      await writeFile(join(tempWorkspaceDir, "workflows/child.ts"), "export const meta = { name: 'child', description: 'test' };");

      // Setup the mocks for load/parse to return names based on filename
      vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
        sourcePath: p,
        sourceText: "content"
      }));

      vi.mocked(parseWorkflow).mockImplementation((loaded) => ({
        meta: { name: loaded.sourcePath.endsWith("root.ts") ? "root" : "child", description: "test" },
        body: "",
        sourcePath: loaded.sourcePath,
        sourceText: loaded.sourceText,
        sourceHash: "123"
      }));

      const registry = await discoverWorkflowRegistry({
        rootWorkflowPath: rootPath,
        cwd: tempWorkspaceDir,
        include: ["workflows/*.ts"],
        candidatePaths: undefined // Omitted
      });

      expect(registry.names()).toEqual(new Set(["root", "child"]));
    } finally {
      await rm(tempWorkspaceDir, { recursive: true, force: true });
    }
  });

  it("gracefully skips invalid workflows when scanning from include patterns", async () => {
    const { mkdtemp, rm, writeFile, mkdir, realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempWorkspaceDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-invalid-")));

    try {
      const rootPath = join(tempWorkspaceDir, "root.ts");
      await writeFile(rootPath, "export const meta = { name: 'root', description: 'test' };");

      await mkdir(join(tempWorkspaceDir, "workflows"));
      await writeFile(join(tempWorkspaceDir, "workflows/child.ts"), "export const meta = { name: 'child', description: 'test' };");
      // This file will fail parseWorkflow
      await writeFile(join(tempWorkspaceDir, "workflows/helper.ts"), "console.log('not a workflow');");

      // Setup the mocks for load/parse
      vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
        sourcePath: p,
        sourceText: p.endsWith("helper.ts") ? "console.log('not a workflow');" : "content"
      }));

      vi.mocked(parseWorkflow).mockImplementation((loaded) => {
        if (loaded.sourcePath.endsWith("helper.ts")) {
          throw new OpenDynamicWorkflowError(ErrorCode.WORKFLOW_PARSE_ERROR, "Metadata name is required");
        }
        return {
          meta: { name: loaded.sourcePath.endsWith("root.ts") ? "root" : "child", description: "test" },
          body: "",
          sourcePath: loaded.sourcePath,
          sourceText: loaded.sourceText,
          sourceHash: "123"
        };
      });

      const registry = await discoverWorkflowRegistry({
        rootWorkflowPath: rootPath,
        cwd: tempWorkspaceDir,
        include: ["workflows/*.ts"],
        candidatePaths: undefined
      });

      expect(registry.names()).toEqual(new Set(["root", "child"]));
    } finally {
      await rm(tempWorkspaceDir, { recursive: true, force: true });
    }
  });

  it("prioritizes root workflow and skips other duplicates when scanning from include patterns", async () => {
    const { mkdtemp, rm, writeFile, mkdir, realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempWorkspaceDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-duplicates-")));

    try {
      const rootPath = join(tempWorkspaceDir, "root.ts");
      // Root workflow named 'duplicate'
      await writeFile(rootPath, "export const meta = { name: 'duplicate', description: 'root' };");

      await mkdir(join(tempWorkspaceDir, "workflows"));
      // Another workflow also named 'duplicate'
      await writeFile(join(tempWorkspaceDir, "workflows/other.ts"), "export const meta = { name: 'duplicate', description: 'other' };");
      
      // A unique child workflow
      await writeFile(join(tempWorkspaceDir, "workflows/child.ts"), "export const meta = { name: 'child', description: 'test' };");
      
      // Three workflows with same name 'ambiguous' (neither is root)
      await writeFile(join(tempWorkspaceDir, "workflows/ambiguous-1.ts"), "export const meta = { name: 'ambiguous', description: 'a1' };");
      await writeFile(join(tempWorkspaceDir, "workflows/ambiguous-2.ts"), "export const meta = { name: 'ambiguous', description: 'a2' };");
      await writeFile(join(tempWorkspaceDir, "workflows/ambiguous-3.ts"), "export const meta = { name: 'ambiguous', description: 'a3' };");

      vi.mocked(loadWorkflow).mockImplementation(async (p) => ({ sourcePath: p, sourceText: "content" }));

      vi.mocked(parseWorkflow).mockImplementation((loaded) => {
        let name = "unknown";
        if (loaded.sourcePath.endsWith("root.ts")) name = "duplicate";
        else if (loaded.sourcePath.endsWith("other.ts")) name = "duplicate";
        else if (loaded.sourcePath.endsWith("child.ts")) name = "child";
        else if (loaded.sourcePath.includes("ambiguous")) name = "ambiguous";
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
        cwd: tempWorkspaceDir,
        include: ["workflows/*.ts"],
        candidatePaths: undefined
      });

      // 'duplicate' should be the root one
      expect(registry.names()).toEqual(new Set(["duplicate", "child"]));
      expect(registry.get("duplicate")?.sourcePath).toBe(rootPath);
      // 'ambiguous' should have been removed because it was a duplicate and neither was root
      expect(registry.get("ambiguous")).toBeUndefined();

    } finally {
      await rm(tempWorkspaceDir, { recursive: true, force: true });
    }
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

  it("respects glob pattern specificity and file extensions", async () => {
    const { mkdtemp, rm, writeFile, mkdir, realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempWorkspaceDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-glob-")));

    try {
      const rootPath = join(tempWorkspaceDir, "root.ts");
      await writeFile(rootPath, "export const meta = { name: 'root', description: 'test' };");

      await mkdir(join(tempWorkspaceDir, "workflows"));
      await writeFile(join(tempWorkspaceDir, "workflows/child.ts"), "export const meta = { name: 'child', description: 'test' };");

      await mkdir(join(tempWorkspaceDir, "workflows/nested"));
      await writeFile(join(tempWorkspaceDir, "workflows/nested/grandchild.ts"), "export const meta = { name: 'grandchild', description: 'test' };");

      await writeFile(join(tempWorkspaceDir, "workflows/extra.js"), "export const meta = { name: 'extra', description: 'test' };");

      // Setup the mocks for load/parse to return actual names matching filenames
      vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
        sourcePath: p,
        sourceText: "content"
      }));

      vi.mocked(parseWorkflow).mockImplementation((loaded) => {
        let name = "unknown";
        if (loaded.sourcePath.endsWith("root.ts")) name = "root";
        if (loaded.sourcePath.endsWith("child.ts")) name = "child";
        if (loaded.sourcePath.endsWith("grandchild.ts")) name = "grandchild";
        if (loaded.sourcePath.endsWith("extra.js")) name = "extra";
        return {
          meta: { name, description: "test" },
          body: "",
          sourcePath: loaded.sourcePath,
          sourceText: loaded.sourceText,
          sourceHash: "123"
        };
      });

      // Assert: include ["workflows/*.ts"] discovers only workflows/child.ts (plus the explicit root)
      const registry1 = await discoverWorkflowRegistry({
        rootWorkflowPath: rootPath,
        cwd: tempWorkspaceDir,
        include: ["workflows/*.ts"]
      });
      expect(registry1.names()).toEqual(new Set(["root", "child"]));

      // Assert: include ["workflows/**/*.ts"] does not discover workflows/extra.js (discovers grandchild)
      const registry2 = await discoverWorkflowRegistry({
        rootWorkflowPath: rootPath,
        cwd: tempWorkspaceDir,
        include: ["workflows/**/*.ts"]
      });
      expect(registry2.names()).toEqual(new Set(["root", "child", "grandchild"]));

    } finally {
      await rm(tempWorkspaceDir, { recursive: true, force: true });
    }
  });

  it("resolves root-level and nested include globs correctly", async () => {
    const { mkdtemp, rm, writeFile, mkdir, realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempWorkspaceDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-rootglob-")));

    try {
      const rootPath = join(tempWorkspaceDir, "root.workflow.js");
      await writeFile(rootPath, "export const meta = { name: 'root', description: 'test' };");

      const childPath = join(tempWorkspaceDir, "child.workflow.js");
      await writeFile(childPath, "export const meta = { name: 'child', description: 'test' };");

      await mkdir(join(tempWorkspaceDir, "workflows"));
      const nestedChildPath = join(tempWorkspaceDir, "workflows/nested.workflow.js");
      await writeFile(nestedChildPath, "export const meta = { name: 'nested-child', description: 'test' };");

      // Setup the mocks for load/parse to return names based on filename
      vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
        sourcePath: p,
        sourceText: "content"
      }));

      vi.mocked(parseWorkflow).mockImplementation((loaded) => {
        let name = "unknown";
        if (loaded.sourcePath.endsWith("root.workflow.js")) name = "root";
        if (loaded.sourcePath.endsWith("child.workflow.js")) name = "child";
        if (loaded.sourcePath.endsWith("nested.workflow.js")) name = "nested-child";
        return {
          meta: { name, description: "test" },
          body: "",
          sourcePath: loaded.sourcePath,
          sourceText: loaded.sourceText,
          sourceHash: "123"
        };
      });

      // Assert 1: root-level glob "*.workflow.js" discovers root.workflow.js and sibling child.workflow.js
      const registry1 = await discoverWorkflowRegistry({
        rootWorkflowPath: "root.workflow.js",
        cwd: tempWorkspaceDir,
        include: ["*.workflow.js"]
      });
      expect(registry1.names()).toEqual(new Set(["root", "child"]));

      // Assert 2: nested-level glob "workflows/*.workflow.js" discovers nested-child (plus explicit root)
      const registry2 = await discoverWorkflowRegistry({
        rootWorkflowPath: "root.workflow.js",
        cwd: tempWorkspaceDir,
        include: ["workflows/*.workflow.js"]
      });
      expect(registry2.names()).toEqual(new Set(["root", "nested-child"]));

    } finally {
      await rm(tempWorkspaceDir, { recursive: true, force: true });
    }
  });

  it("uses discovery parameter with include, exclude and compatibilityMode", async () => {
    const { mkdtemp, rm, writeFile, mkdir, realpath } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tempWorkspaceDir = await realpath(await mkdtemp(join(tmpdir(), "open-dynamic-workflow-discovery-param-")));

    try {
      const rootPath = join(tempWorkspaceDir, "root.ts");
      await writeFile(rootPath, "export const meta = { name: 'root', description: 'test' };");

      await mkdir(join(tempWorkspaceDir, "workflows"));
      await writeFile(join(tempWorkspaceDir, "workflows/child1.workflow.ts"), "export const meta = { name: 'child1', description: 'test' };");
      await writeFile(join(tempWorkspaceDir, "workflows/child2.workflow.ts"), "export const meta = { name: 'child2', description: 'test' };");

      vi.mocked(loadWorkflow).mockImplementation(async (p) => ({
        sourcePath: p,
        sourceText: "content"
      }));

      vi.mocked(parseWorkflow).mockImplementation((loaded) => {
        let name = "unknown";
        if (loaded.sourcePath.endsWith("root.ts")) name = "root";
        if (loaded.sourcePath.endsWith("child1.workflow.ts")) name = "child1";
        if (loaded.sourcePath.endsWith("child2.workflow.ts")) name = "child2";
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
        cwd: tempWorkspaceDir,
        discovery: {
          include: ["workflows/**/*.ts"],
          exclude: ["workflows/child2.workflow.ts"],
          compatibilityMode: "new-suffix-specific",
        }
      });

      expect(registry.names()).toEqual(new Set(["root", "child1"]));
    } finally {
      await rm(tempWorkspaceDir, { recursive: true, force: true });
    }
  });
});
