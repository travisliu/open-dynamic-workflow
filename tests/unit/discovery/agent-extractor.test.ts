import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractAgent } from "../../../src/discovery/extract-agent.js";
import { CandidateFile } from "../../../src/discovery/types.js";

describe("agent-extractor", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "agent-extractor-test-"));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createTestFile(name: string, content: string): Promise<CandidateFile> {
    const absolutePath = join(tempDir, name);
    await fs.writeFile(absolutePath, content);
    return {
      resourceType: "agent",
      absolutePath,
      relativePath: name
    };
  }

  it("extracts valid agent metadata", async () => {
    const content = `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "test-agent",
        description: "A test agent",
        metadata: { category: "test" },
        inputSchema: { type: "object", required: ["input1"] },
        run: async () => {}
      });
    `;
    const file = await createTestFile("valid.ts", content);
    const result = await extractAgent(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("test-agent");
      expect(result.resource.requiredInputs).toEqual(["input1"]);
    }
  });

  it("preserves empty requiredInputs", async () => {
    const content = `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "test-agent",
        description: "A test agent",
        inputSchema: { type: "object", required: [] },
        run: async () => {}
      });
    `;
    const file = await createTestFile("empty-required.ts", content);
    const result = await extractAgent(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.requiredInputs).toEqual([]);
    }
  });

  it("extracts valid agent metadata without description", async () => {
    const content = `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "test-agent",
        inputSchema: { type: "object", required: ["input1"] },
        run: async () => {}
      });
    `;
    const file = await createTestFile("no-desc.ts", content);
    const result = await extractAgent(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("test-agent");
      expect(result.resource.description).toBe("");
    }
  });

  it("fails if description is not a string", async () => {
    const content = `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "test-agent",
        description: 123,
        run: async () => {}
      });
    `;
    const file = await createTestFile("bad-desc.ts", content);
    const result = await extractAgent(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Agent description must be a static string");
    }
  });

  it("fails if run method is missing", async () => {
    const content = `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "test-agent",
        description: "A test agent"
      });
    `;
    const file = await createTestFile("missing-run.ts", content);
    const result = await extractAgent(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Agent must have a run method or property");
    }
  });

  it("extracts valid agent metadata with method syntax", async () => {
    const content = `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "test-agent",
        async run() {}
      });
    `;
    const file = await createTestFile("method-syntax.ts", content);
    const result = await extractAgent(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resource.id).toBe("test-agent");
    }
  });

  it("fails if metadata is null", async () => {
    const content = `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "test-agent",
        description: "A test agent",
        metadata: null,
        run: async () => {}
      });
    `;
    const file = await createTestFile("null-metadata.ts", content);
    const result = await extractAgent(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Agent metadata must be a static object literal");
    }
  });

  it("fails if inputSchema is null", async () => {
    const content = `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "test-agent",
        description: "A test agent",
        inputSchema: null,
        run: async () => {}
      });
    `;
    const file = await createTestFile("null-schema.ts", content);
    const result = await extractAgent(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("Agent inputSchema must be a static object literal");
    }
  });
});
