import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractWorkflow } from "../../../src/discovery/extract-workflow.js";
import { CandidateFile } from "../../../src/discovery/types.js";

describe("workflow-extractor", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "workflow-extractor-test-"));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createTestFile(name: string, content: string): Promise<CandidateFile> {
    const absolutePath = join(tempDir, name);
    await fs.writeFile(absolutePath, content);
    return {
      resourceType: "workflow",
      absolutePath,
      relativePath: name
    };
  }

  it("extracts valid workflow metadata", async () => {
    const content = `
      export const meta = {
        name: "test-workflow",
        description: "A test workflow",
        phases: ["phase1"],
        version: "1.0.0",
        tags: ["test"]
      };
      export function run() {}
    `;
    const file = await createTestFile("valid.ts", content);
    const result = await extractWorkflow(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource).toEqual({
        type: "workflow",
        name: "test-workflow",
        description: "A test workflow",
        phases: ["phase1"],
        version: "1.0.0",
        tags: ["test"],
        path: "valid.ts",
        valid: true
      });
    }
  });

  it("extracts valid workflow metadata with inputSchema", async () => {
     const content = `
      export const meta = {
        name: "test-workflow",
        description: "A test workflow",
        inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] }
      };
      export function run() {}
    `;
    const file = await createTestFile("with-schema.ts", content);
    const result = await extractWorkflow(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.inputSchema).toEqual({ type: "object", properties: { topic: { type: "string" } }, required: ["topic"] });
    }
  });

  it("fails if meta is missing", async () => {
    const content = `const x = 1;`;
    const file = await createTestFile("missing-meta.ts", content);
    const result = await extractWorkflow(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("WORKFLOW_METADATA_MISSING");
    }
  });

  it("fails if meta is not exported", async () => {
    const content = `const meta = { name: "n", description: "d" };`;
    const file = await createTestFile("not-exported.ts", content);
    const result = await extractWorkflow(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("WORKFLOW_METADATA_MISSING");
    }
  });

  it("fails if name is missing or empty", async () => {
    const content = `export const meta = { description: "d" };`;
    const file = await createTestFile("missing-name.ts", content);
    const result = await extractWorkflow(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("WORKFLOW_METADATA_INVALID");
    }
  });

  it("fails if metadata contains non-static values", async () => {
    const content = `export const meta = { name: "n", description: someVar };`;
    const file = await createTestFile("non-static.ts", content);
    const result = await extractWorkflow(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("WORKFLOW_METADATA_INVALID");
    }
  });

  it("fails if metadata contains unknown fields", async () => {
    const content = `export const meta = { name: "n", description: "d", unknown: 1 };`;
    const file = await createTestFile("unknown-field.ts", content);
    const result = await extractWorkflow(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("WORKFLOW_METADATA_INVALID");
      expect(result.diagnostics[0].message).toContain("Unknown metadata fields");
    }
  });
});
