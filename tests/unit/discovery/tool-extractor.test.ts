import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
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
      import { defineTool } from "@travisliu/open-dynamic-workflow";
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
      import { defineTool } from "@travisliu/open-dynamic-workflow";
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
      import { defineTool } from "@travisliu/open-dynamic-workflow";
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
      import { defineTool } from "@travisliu/open-dynamic-workflow";
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
      import { defineTool } from "@travisliu/open-dynamic-workflow";
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
      import { defineTool } from "@travisliu/open-dynamic-workflow";
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
      import { defineTool } from "@travisliu/open-dynamic-workflow";
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

  it("resolves same-file const schema fragments and property access", async () => {
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";

      const schemaFragment = {
        properties: {
          ok: { type: "boolean" },
          count: { type: "number" }
        },
        required: ["ok"]
      };

      const outputSchema = {
        type: "object",
        properties: {
          result: {
            type: "object",
            properties: schemaFragment.properties,
            required: schemaFragment.required,
            additionalProperties: false
          }
        },
        required: ["result"],
        additionalProperties: false
      };

      export default defineTool({
        id: "fragment-tool",
        description: "A tool with referenced schema fragments",
        inputSchema: {
          type: "object",
          properties: schemaFragment.properties,
          required: schemaFragment.required,
          additionalProperties: false
        },
        outputSchema: outputSchema,
        run: async () => {}
      });
    `;
    const file = await createTestFile("schema-fragment.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.requiredInputs).toEqual(["ok"]);
      expect(result.resource.outputSchema).toEqual({
        type: "object",
        properties: {
          result: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              count: { type: "number" }
            },
            required: ["ok"],
            additionalProperties: false
          }
        },
        required: ["result"],
        additionalProperties: false
      });
    }
  });

  it("rejects imported schema references", async () => {
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      import { schema } from "./schema.js";

      export default defineTool({
        id: "imported-schema-tool",
        description: "A tool with imported schema",
        inputSchema: schema,
        run: async () => {}
      });
    `;
    const file = await createTestFile("imported-schema.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Tool inputSchema must be a static object literal");
    }
  });

  it("rejects circular const references", async () => {
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";

      const first = second;
      const second = first;

      export default defineTool({
        id: "circular-schema-tool",
        description: "A tool with circular schema references",
        inputSchema: first,
        run: async () => {}
      });
    `;
    const file = await createTestFile("circular-schema.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Tool inputSchema must be a static object literal");
    }
  });

  it("accepts the quality-gate example tool metadata", async () => {
    const file: CandidateFile = {
      resourceType: "tool",
      absolutePath: resolve(process.cwd(), "examples/quality-gate/tools/npm-quality-gate.js"),
      relativePath: "examples/quality-gate/tools/npm-quality-gate.js"
    };

    const result = await extractTool(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("npm-quality-gate");
      expect(result.resource.defaultTimeoutMs).toBe(900000);
      expect(result.resource.outputSchema).toBeDefined();
    }
  });
});
