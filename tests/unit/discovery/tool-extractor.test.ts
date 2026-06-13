import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractTool } from "../../../src/discovery/extract-tool.js";
import { CandidateFile } from "../../../src/discovery/types.js";

describe("tool-extractor", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "tool-extractor-test-"));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createTestFile(name: string, content: string): Promise<CandidateFile> {
    const absolutePath = join(tempDir, name);
    await fs.writeFile(absolutePath, content);
    return {
      resourceType: "tool",
      absolutePath,
      relativePath: name
    };
  }

  it("extracts valid tool metadata", async () => {
    const content = `
      import { defineTool } from "@prmflow/openflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        defaultTimeoutMs: 5000,
        inputSchema: { type: "object", required: ["input1"] },
        run: async () => {}
      });
    `;
    const file = await createTestFile("valid.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("test-tool");
      expect(result.resource.defaultTimeoutMs).toBe(5000);
      expect(result.resource.requiredInputs).toEqual(["input1"]);
    }
  });

  it("fails if defaultTimeoutMs is 0", async () => {
    const content = `
      import { defineTool } from "@prmflow/openflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        defaultTimeoutMs: 0,
        inputSchema: { type: "object" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("zero-timeout.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Tool defaultTimeoutMs must be a static positive integer");
    }
  });

  it("fails if inputSchema is missing", async () => {
    const content = `
      import { defineTool } from "@prmflow/openflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        run: async () => {}
      });
    `;
    const file = await createTestFile("missing-schema.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Tool must have an inputSchema");
    }
  });

  it("fails if run method is missing", async () => {
    const content = `
      import { defineTool } from "@prmflow/openflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        inputSchema: { type: "object" }
      });
    `;
    const file = await createTestFile("missing-run.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Tool must have a run method or property");
    }
  });

  it("extracts valid tool metadata with method syntax", async () => {
    const content = `
      import { defineTool } from "@prmflow/openflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        inputSchema: { type: "object" },
        async run() {}
      });
    `;
    const file = await createTestFile("method-syntax.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("test-tool");
    }
  });

  it("fails if inputSchema is null", async () => {
    const content = `
      import { defineTool } from "@prmflow/openflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        inputSchema: null,
        run: async () => {}
      });
    `;
    const file = await createTestFile("null-schema.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Tool inputSchema must be a static object literal");
    }
  });

  it("preserves empty requiredInputs", async () => {
    const content = `
      import { defineTool } from "@prmflow/openflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        inputSchema: { type: "object", required: [] },
        run: async () => {}
      });
    `;
    const file = await createTestFile("empty-required.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.requiredInputs).toEqual([]);
    }
  });
});
