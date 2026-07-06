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

  it("rejects schema references to later top-level const declarations", async () => {
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";

      const inputSchema = schemaFragment;
      const schemaFragment = { type: "object" };

      export default defineTool({
        id: "forward-schema-tool",
        description: "A tool with a forward schema reference",
        inputSchema: inputSchema,
        run: async () => {}
      });
    `;
    const file = await createTestFile("forward-schema.ts", content);
    const result = await extractTool(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Tool inputSchema must be a static object literal");
    }
  });

  it("rejects defineTool metadata that references const declarations defined later", async () => {
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";

      export default defineTool({
        id: "later-schema-tool",
        description: "A tool with a later schema declaration",
        inputSchema: schema,
        run: async () => {}
      });

      const schema = { type: "object" };
    `;
    const file = await createTestFile("later-schema.ts", content);
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

  it("accepts accepted static forms including inline literals, same-file const, static property access, and valid JSON metadata", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";

      const schemaFragment = {
        properties: {
          ok: { type: "boolean" }
        },
        required: ["ok"]
      };

      const outputSchema = {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"]
      };

      const toolMetadata = {
        category: "quality",
        nested: { level: 1 },
        flags: [true, false, null]
      };

      export default defineTool({
        id: "static-contract-tool",
        description: "Static contract test tool",
        inputSchema: {
          type: "object",
          properties: schemaFragment.properties,
          required: schemaFragment.required
        },
        outputSchema: outputSchema,
        metadata: toolMetadata,
        run: async () => {}
      });
    `;
    const file = await createTestFile("accepted-static-forms.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("static-contract-tool");
      expect(result.resource.requiredInputs).toEqual(["ok"]);
      expect(result.resource.outputSchema).toEqual({
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"]
      });
    }
  });

  it("accepts declarations in the same const statement", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";

      const inputSchema = { type: "object" }, outputSchema = { type: "object" };

      export default defineTool({
        id: "same-statement-tool",
        description: "Same statement test tool",
        inputSchema: inputSchema,
        outputSchema: outputSchema,
        run: async () => {}
      });
    `;
    const file = await createTestFile("same-statement-const.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("same-statement-tool");
      expect(result.resource.inputSchema).toEqual({ type: "object" });
      expect(result.resource.outputSchema).toEqual({ type: "object" });
    }
  });

  it("rejects unsafe IDs", async () => {
    const unsafeIds = [
      { rawValue: `"../secret"`, messageFragment: "safe" },
      { rawValue: `"tools/read"`, messageFragment: "safe" },
      { rawValue: `"a\\\\b"`, messageFragment: "safe" },
      { rawValue: `"tool name"`, messageFragment: "safe" },
      { rawValue: `"tool\\nname"`, messageFragment: "safe" },
      { rawValue: `""`, messageFragment: "non-empty string" },
      { rawValue: `"   "`, messageFragment: "safe" },
      { rawValue: `" padded"`, messageFragment: "safe" },
      { rawValue: `"padded "`, messageFragment: "safe" }
    ];

    for (let i = 0; i < unsafeIds.length; i++) {
      const { rawValue, messageFragment } = unsafeIds[i];
      // Arrange
      const content = `
        import { defineTool } from "@travisliu/open-dynamic-workflow";
        export default defineTool({
          id: ${rawValue},
          description: "Unsafe ID test",
          inputSchema: { type: "object" },
          run: async () => {}
        });
      `;
      const file = await createTestFile(`unsafe-id-${i}.ts`, content);

      // Act
      const result = await extractTool(file);

      // Assert
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const message = result.diagnostics[0].message;
      expect(message).toContain("Tool id");
      expect(
        message.toLowerCase().includes(messageFragment.toLowerCase()) ||
        message.toLowerCase().includes("safe") ||
        message.toLowerCase().includes("path-like")
      ).toBe(true);
    }
  });

  it("fails if inputSchema is an invalid AJV schema", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "invalid-input-schema-tool",
        description: "A tool with invalid input schema",
        inputSchema: { type: "definitely-not-json-schema-type" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("invalid-input-schema.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("inputSchema");
  });

  it("fails if outputSchema is an invalid AJV schema", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "invalid-output-schema-tool",
        description: "A tool with invalid output schema",
        inputSchema: { type: "object" },
        outputSchema: { type: "definitely-not-json-schema-type" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("invalid-output-schema.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("outputSchema");
  });

  it("rejects metadata with function calls", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "metadata-fn",
        description: "Metadata with function call",
        inputSchema: { type: "object" },
        metadata: buildMetadata(),
        run: async () => {}
      });
      function buildMetadata() { return {}; }
    `;
    const file = await createTestFile("metadata-fn.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("metadata");
  });

  it("rejects metadata with imported references", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      import { metadata } from "./metadata.js";
      export default defineTool({
        id: "metadata-import",
        description: "Metadata with imported ref",
        inputSchema: { type: "object" },
        metadata: metadata,
        run: async () => {}
      });
    `;
    const file = await createTestFile("metadata-import.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("metadata");
  });

  it("rejects metadata with forward references", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "metadata-forward",
        description: "Metadata with forward ref",
        inputSchema: { type: "object" },
        metadata: metadata,
        run: async () => {}
      });
      const metadata = { category: "late" };
    `;
    const file = await createTestFile("metadata-forward.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("metadata");
  });

  it("rejects metadata with computed keys", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "metadata-computed",
        description: "Metadata with computed key",
        inputSchema: { type: "object" },
        metadata: { ["category"]: "x" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("metadata-computed.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("metadata");
  });

  it("rejects metadata with object spreads", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      const baseMetadata = { category: "base" };
      export default defineTool({
        id: "metadata-spread",
        description: "Metadata with object spread",
        inputSchema: { type: "object" },
        metadata: { ...baseMetadata },
        run: async () => {}
      });
    `;
    const file = await createTestFile("metadata-spread.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("metadata");
  });

  it("rejects metadata with runtime environment reads", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "metadata-env",
        description: "Metadata with env read",
        inputSchema: { type: "object" },
        metadata: { env: process.env.TOOL_METADATA },
        run: async () => {}
      });
    `;
    const file = await createTestFile("metadata-env.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("metadata");
  });

  it("rejects metadata with top-level array", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "metadata-array",
        description: "Metadata with array",
        inputSchema: { type: "object" },
        metadata: ["not", "object"],
        run: async () => {}
      });
    `;
    const file = await createTestFile("metadata-array.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("metadata");
  });

  it("fails if defaultTimeoutMs is a decimal", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        defaultTimeoutMs: 1.5,
        inputSchema: { type: "object" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("decimal-timeout.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].message).toContain("defaultTimeoutMs");
  });

  it("fails if defaultTimeoutMs is a non-static expression", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        defaultTimeoutMs: Number("5"),
        inputSchema: { type: "object" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("non-static-timeout.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].message).toContain("defaultTimeoutMs");
  });

  it("fails if defaultTimeoutMs is negative", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        defaultTimeoutMs: -5,
        inputSchema: { type: "object" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("negative-timeout.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].message).toContain("defaultTimeoutMs");
  });

  it("fails if defaultTimeoutMs is a string", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        defaultTimeoutMs: "5000",
        inputSchema: { type: "object" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("string-timeout.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].message).toContain("defaultTimeoutMs");
  });

  it("fails if defaultTimeoutMs references a forward declaration", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "test-tool",
        description: "A test tool",
        defaultTimeoutMs: timeout,
        inputSchema: { type: "object" },
        run: async () => {}
      });
      const timeout = 5000;
    `;
    const file = await createTestFile("forward-timeout.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].message).toContain("defaultTimeoutMs");
  });

  it("validates statically without importing or executing the module", async () => {
    // Arrange
    const content = `
      throw new Error("extractTool imported this file");

      import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "../unsafe",
        description: "Invalid before import",
        inputSchema: { type: "object" },
        run: async () => {}
      });
    `;
    const file = await createTestFile("no-execution.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const hasImportError = result.diagnostics.some(d => d.message.includes("extractTool imported this file"));
    expect(hasImportError).toBe(false);
    expect(result.diagnostics[0].message).toContain("Tool id");
    expect(result.diagnostics[0].message).toContain("safe");
  });

  it("fails if a shorthand property is used in the tool definition object", async () => {
    // Arrange
    const content = `
      import { defineTool } from "@travisliu/open-dynamic-workflow";
      const inputSchema = { type: "object" };
      export default defineTool({
        id: "shorthand-tool",
        description: "A tool with shorthand properties",
        inputSchema,
        run: async () => {}
      });
    `;
    const file = await createTestFile("shorthand-property.ts", content);

    // Act
    const result = await extractTool(file);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain('Property "inputSchema" must be a static literal, not a shorthand property.');
  });
});
