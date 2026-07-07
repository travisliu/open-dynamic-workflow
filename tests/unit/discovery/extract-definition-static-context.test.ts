import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractAgent } from "../../../src/discovery/extract-agent.js";
import { extractWorkflow } from "../../../src/discovery/extract-workflow.js";
import { CandidateFile } from "../../../src/discovery/types.js";

describe("extract-definition-static-context", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "static-context-test-"));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createTestFile(name: string, content: string, resourceType: "agent" | "workflow"): Promise<CandidateFile> {
    const absolutePath = join(tempDir, name);
    await fs.writeFile(absolutePath, content);
    return {
      resourceType,
      absolutePath,
      relativePath: name
    };
  }

  it("extractAgent accepts same-file earlier constants for all static fields", async () => {
    // Arrange
    const content = `
      import { defineAgent } from "@travisliu/open-dynamic-workflow";
      const agentId = "example.agent";
      const agentDescription = "Example agent";
      const metadata = { category: "test" };
      const inputSchema = {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } }
      };

      export default defineAgent({
        id: agentId,
        description: agentDescription,
        metadata: metadata,
        inputSchema: inputSchema,
        run: async () => ({})
      });
    `;

    const file = await createTestFile("earlier-constants.ts", content, "agent");
    // Act
    const result = await extractAgent(file);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("example.agent");
      expect(result.resource.description).toBe("Example agent");
      expect(result.resource.metadata).toEqual({ category: "test" });
      expect(result.resource.inputSchema).toEqual({
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } }
      });
    }
  });

  it("extractAgent still rejects a later same-file reference for a static field", async () => {
    // Arrange
    const content = `
      import { defineAgent } from "@travisliu/open-dynamic-workflow";
      export default defineAgent({
        id: agentId,
        description: "Example agent",
        run: async () => ({})
      });
      const agentId = "example.agent";
    `;

    const file = await createTestFile("later-constants.ts", content, "agent");
    // Act
    const result = await extractAgent(file);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].message).toContain("referenced before initialization");
    }
  });

  it("extractWorkflow accepts wrapper syntax inside the required first-statement metadata declaration", async () => {
    // Arrange
    const content = `
      export const meta = (<Record<string, unknown>>(({
        name: "Static Wrapper Workflow",
        description: "Static wrapper workflow",
        tags: ["regression"] as const,
        inputSchema: ({ type: "object" } as const)
      } as const) satisfies Record<string, unknown>);
    `;

    const file = await createTestFile("workflow-wrappers.ts", content, "workflow");
    // Act
    const result = await extractWorkflow(file);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.name).toBe("Static Wrapper Workflow");
      expect(result.resource.description).toBe("Static wrapper workflow");
      expect(result.resource.tags).toEqual(["regression"]);
      expect(result.resource.inputSchema).toEqual({ type: "object" });
    }
  });

  it("extractWorkflow still rejects any declaration before export const meta", async () => {
    // Arrange
    const content = `
      const schema = { type: "object" };
      export const meta = {
        name: "Invalid",
        description: "Invalid",
        inputSchema: schema
      };
    `;

    const file = await createTestFile("workflow-decl-before-meta.ts", content, "workflow");
    // Act
    const result = await extractWorkflow(file);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].message).toContain("First statement must");
    }
  });
});
