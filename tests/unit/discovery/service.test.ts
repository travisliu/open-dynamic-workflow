import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDiscoveryService } from "../../../src/discovery/service.js";
import { resolveDiscoveryDirectories } from "../../../src/discovery/directories.js";
import { ResourceExtractor } from "../../../src/discovery/types.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";

describe("discovery-service", () => {
  let tempDir: string;
  const directories = {
    workflowInclude: ["workflows/**/*.ts", "workflows/**/*.js"],
    agentsDir: "agents",
    toolsDir: "tools"
  };

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "discovery-service-test-"));
  });

  beforeEach(async () => {
    // Clear tempDir content
    const files = await fs.readdir(tempDir);
    for (const file of files) {
      await fs.rm(join(tempDir, file), { recursive: true, force: true });
    }
    await fs.mkdir(join(tempDir, "workflows"), { recursive: true });
    await fs.mkdir(join(tempDir, "agents"), { recursive: true });
    await fs.mkdir(join(tempDir, "tools"), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const fakeAgentExtractor: ResourceExtractor = {
    resourceType: "agent",
    async extract(file) {
      if (file.relativePath.includes("fail")) {
        return { ok: false, diagnostics: [{ severity: "error", resourceType: "agent", code: "EXTRACT_FAIL", path: file.relativePath, message: "fail" }] };
      }
      return {
        ok: true,
        resource: {
          type: "agent",
          id: file.relativePath.replace("agents/", "").replace(".ts", ""),
          description: "desc",
          path: file.relativePath,
          valid: true
        }
      };
    }
  };

  it("performs full discovery with fake extractors", async () => {
    await fs.writeFile(join(tempDir, "workflows/w1.ts"), "export const meta = { name: 'w1', description: 'd1' }");
    await fs.writeFile(join(tempDir, "agents/a1.ts"), "agent content");

    const service = createDiscoveryService({
      extractors: { agent: fakeAgentExtractor }
    });

    const result = await service.discover({
      cwd: tempDir,
      resourceTypes: ["workflow", "agent"],
      directories,
      verbose: false,
      strict: false
    });

    expect(result.status).toBe("succeeded");
    expect(result.resources).toHaveLength(2);
    expect(result.summary.discoveredCount).toBe(2);
    expect(result.summary.validCount).toBe(2);
    expect(result.resources[0].type).toBe("workflow");
    expect(result.resources[1].type).toBe("agent");
  });

  it("handles duplicates and sorting", async () => {
    await fs.writeFile(join(tempDir, "workflows/dup1.ts"), "export const meta = { name: 'dup', description: 'd1' }");
    await fs.writeFile(join(tempDir, "workflows/dup2.ts"), "export const meta = { name: 'dup', description: 'd2' }");

    const service = createDiscoveryService();
    const result = await service.discover({
      cwd: tempDir,
      resourceTypes: ["workflow"],
      directories,
      verbose: false,
      strict: false
    });

    expect(result.status).toBe("partially_succeeded");
    expect(result.resources).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("WORKFLOW_DUPLICATE_NAME");
    // Sorted by name then path
    expect(result.resources[0].path).toBe("workflows/dup1.ts");
    expect(result.resources[1].path).toBe("workflows/dup2.ts");
  });

  it("handles duplicate agents", async () => {
    await fs.writeFile(join(tempDir, "agents/dup1.ts"), "agent 1 content");
    await fs.writeFile(join(tempDir, "agents/dup2.ts"), "agent 2 content");

    const fakeDuplicateExtractor: ResourceExtractor = {
      resourceType: "agent",
      async extract(file) {
        return {
          ok: true,
          resource: {
            type: "agent",
            id: "duplicate-agent",
            description: "desc",
            path: file.relativePath,
            valid: true
          }
        };
      }
    };

    const service = createDiscoveryService({
      extractors: { agent: fakeDuplicateExtractor }
    });
    const result = await service.discover({
      cwd: tempDir,
      resourceTypes: ["agent"],
      directories,
      verbose: false,
      strict: false
    });

    expect(result.status).toBe("partially_succeeded");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("AGENT_DUPLICATE_ID");
  });

  it("handles duplicate tools", async () => {
    await fs.writeFile(join(tempDir, "tools/dup1.ts"), "tool 1 content");
    await fs.writeFile(join(tempDir, "tools/dup2.ts"), "tool 2 content");

    const fakeDuplicateExtractor: ResourceExtractor = {
      resourceType: "tool",
      async extract(file) {
        return {
          ok: true,
          resource: {
            type: "tool",
            id: "duplicate-tool",
            description: "desc",
            path: file.relativePath,
            valid: true
          }
        };
      }
    };

    const service = createDiscoveryService({
      extractors: { tool: fakeDuplicateExtractor }
    });
    const result = await service.discover({
      cwd: tempDir,
      resourceTypes: ["tool"],
      directories,
      verbose: false,
      strict: false
    });

    expect(result.status).toBe("partially_succeeded");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("TOOL_DUPLICATE_ID");
  });

  it("handles strict mode", async () => {
    await fs.writeFile(join(tempDir, "workflows/invalid.ts"), "invalid content");

    const service = createDiscoveryService();
    const result = await service.discover({
      cwd: tempDir,
      resourceTypes: ["workflow"],
      directories,
      verbose: false,
      strict: true
    });

    expect(result.status).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("handles internal extractor exceptions", async () => {
    const crashingExtractor: ResourceExtractor = {
      resourceType: "agent",
      async extract() {
        throw new Error("BOOM");
      }
    };
    await fs.writeFile(join(tempDir, "agents/boom.ts"), "content");

    const service = createDiscoveryService({
      extractors: { agent: crashingExtractor }
    });

    const result = await service.discover({
      cwd: tempDir,
      resourceTypes: ["agent"],
      directories,
      verbose: false,
      strict: false
    });

    expect(result.status).toBe("failed");
    expect(result.errors[0].code).toBe("LIST_INTERNAL_ERROR");
  });

  describe("directory resolution", () => {
    const mockConfig: any = {
      ...DEFAULT_CONFIG,
      cwd: tempDir,
      workflow: {
        discovery: {
          include: ["config-workflows/**/*.ts"]
        }
      },
      sharedAgents: { dir: "config-agents" },
      tools: { dir: "config-tools" }
    };

    it("resolves from CLI flags with highest priority (targeted)", () => {
      const dirs = resolveDiscoveryDirectories({
        resourceType: "workflow",
        rawOptions: { dir: "cli-dir" },
        config: mockConfig,
        cwd: tempDir
      });

      expect(dirs.workflowInclude).toEqual([
        expect.stringContaining("cli-dir/**/*.ts"),
        expect.stringContaining("cli-dir/**/*.js"),
        expect.stringContaining("cli-dir/**/*.mjs"),
        expect.stringContaining("cli-dir/**/*.cjs"),
      ]);
    });

    it("resolves from CLI flags with highest priority (all)", () => {
      const dirs = resolveDiscoveryDirectories({
        resourceType: "all",
        rawOptions: { workflowsDir: "cli-workflows" },
        config: mockConfig,
        cwd: tempDir
      });

      expect(dirs.workflowInclude).toEqual([
        expect.stringContaining("cli-workflows/**/*.ts"),
        expect.stringContaining("cli-workflows/**/*.js"),
        expect.stringContaining("cli-workflows/**/*.mjs"),
        expect.stringContaining("cli-workflows/**/*.cjs"),
      ]);
      expect(dirs.agentsDir).toBe(join(tempDir, "config-agents"));
    });

    it("resolves from config when no CLI flags provided", () => {
      const dirs = resolveDiscoveryDirectories({
        resourceType: "all",
        rawOptions: {},
        config: mockConfig,
        cwd: tempDir
      });

      expect(dirs.workflowInclude).toEqual(["config-workflows/**/*.ts"]);
    });

    it("resolves from defaults when no config or flags provided", () => {
      const minimalConfig: any = { 
        ...DEFAULT_CONFIG,
        cwd: tempDir,
        workflow: {
          discovery: {
            include: ["workflows/**/*.ts"]
          }
        },
        sharedAgents: { dir: ".openflow/agents" },
        tools: { dir: ".openflow/tools" }
      };
      const dirs = resolveDiscoveryDirectories({
        resourceType: "all",
        rawOptions: {},
        config: minimalConfig,
        cwd: tempDir
      });

      expect(dirs.workflowInclude).toEqual(["workflows/**/*.ts"]);
      expect(dirs.agentsDir).toBe(join(tempDir, ".openflow/agents"));
    });
  });
});
