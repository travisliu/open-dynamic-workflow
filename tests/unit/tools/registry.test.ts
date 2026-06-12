import { describe, it, expect } from "vitest";
import { defineTool } from "../../../src/tools/define-tool.js";
import { buildToolRegistry } from "../../../src/tools/registry.js";
import { OpenFlowError } from "../../../src/errors/types.js";

describe("ToolRegistry", () => {
  it("should register valid tool definitions and compile schemas (Case 4)", () => {
    const tool1 = defineTool({
      id: "tool1",
      description: "desc 1",
      inputSchema: { type: "object", properties: { foo: { type: "string" } }, required: ["foo"] },
      run: (input: any) => input
    });

    const registry = buildToolRegistry({
      definitions: [{ definition: tool1, sourcePath: "file1.ts" }],
      maxDefinitions: 10
    });

    expect(registry.has("tool1")).toBe(true);
    expect(registry.list()).toHaveLength(1);
    const entry = registry.get("tool1")!;
    expect(entry.definition.id).toBe("tool1");
    expect(entry.sourcePath).toBe("file1.ts");

    // Test input validation (confirms schema compilation worked)
    expect(entry.validateInput({ foo: "bar" }).ok).toBe(true);
    expect(entry.validateInput({ foo: 123 }).ok).toBe(false);
  });

  it("should reject duplicate IDs with both source paths (Case 5)", () => {
    const tool1 = defineTool({
      id: "tool1",
      description: "desc 1",
      inputSchema: { type: "object" },
      run: () => {}
    });

    const action = () => buildToolRegistry({
      definitions: [
        { definition: tool1, sourcePath: "file1.ts" },
        { definition: tool1, sourcePath: "file2.ts" }
      ],
      maxDefinitions: 10
    });

    expect(action).toThrow(OpenFlowError);
    try {
      action();
    } catch (err: any) {
      expect(err.code).toBe("TOOL_DUPLICATE_DEFINITION");
      expect(err.message).toContain("file1.ts");
      expect(err.message).toContain("file2.ts");
    }
  });

  it("should reject missing required definition fields (Case 6)", () => {
    const noDesc = defineTool({ id: "no-desc", inputSchema: {}, run: () => {} } as any);
    expect(() => buildToolRegistry({
      definitions: [{ definition: noDesc, sourcePath: "f.ts" }],
      maxDefinitions: 10
    })).toThrow(/missing a description/);

    const noSchema = defineTool({ id: "no-schema", description: "d", run: () => {} } as any);
    expect(() => buildToolRegistry({
      definitions: [{ definition: noSchema, sourcePath: "f.ts" }],
      maxDefinitions: 10
    })).toThrow(/missing 'inputSchema'/);

    const noRun = defineTool({ id: "no-run", description: "d", inputSchema: {} } as any);
    expect(() => buildToolRegistry({
      definitions: [{ definition: noRun, sourcePath: "f.ts" }],
      maxDefinitions: 10
    })).toThrow(/missing a 'run' function/);
  });

  it("should reject unsafe or path-like IDs (Case 7)", () => {
    const unsafeIds = ["", " ", "../secret", "tools/read", "a\\b", "tool\nname"];
    
    for (const id of unsafeIds) {
      const tool = defineTool({ id, description: "d", inputSchema: {}, run: () => {} });
      expect(() => buildToolRegistry({
        definitions: [{ definition: tool, sourcePath: "f.ts" }],
        maxDefinitions: 10
      }), `Should have rejected ID: "${id}"`).toThrow(/Invalid tool ID/);
    }
  });

  it("should reject invalid schemas with input/output context (Case 8)", () => {
    const badInput = defineTool({
      id: "bad-input",
      description: "d",
      inputSchema: { type: "invalid" } as any,
      run: () => {}
    });
    expect(() => buildToolRegistry({
      definitions: [{ definition: badInput, sourcePath: "f.ts" }],
      maxDefinitions: 10
    })).toThrow(/has an invalid 'inputSchema'/);

    const badOutput = defineTool({
      id: "bad-output",
      description: "d",
      inputSchema: {},
      outputSchema: { type: "invalid" } as any,
      run: () => {}
    });
    expect(() => buildToolRegistry({
      definitions: [{ definition: badOutput, sourcePath: "f.ts" }],
      maxDefinitions: 10
    })).toThrow(/has an invalid 'outputSchema'/);
  });

  it("should reject invalid default timeout and metadata (Case 9)", () => {
    const badTimeout = defineTool({
      id: "t1",
      description: "d",
      inputSchema: {},
      run: () => {},
      defaultTimeoutMs: -1
    });
    expect(() => buildToolRegistry({
      definitions: [{ definition: badTimeout, sourcePath: "f.ts" }],
      maxDefinitions: 10
    })).toThrow(/invalid 'defaultTimeoutMs'/);

    const badMetadata = defineTool({
      id: "m1",
      description: "d",
      inputSchema: {},
      run: () => {},
      metadata: { func: () => {} } as any
    });
    expect(() => buildToolRegistry({
      definitions: [{ definition: badMetadata, sourcePath: "f.ts" }],
      maxDefinitions: 10
    })).toThrow(/metadata.*JSON-compatible/);
  });

  it("should enforce maxDefinitions (Case 10)", () => {
    const tool1 = defineTool({ id: "t1", description: "d", inputSchema: {}, run: () => {} });
    const tool2 = defineTool({ id: "t2", description: "d", inputSchema: {}, run: () => {} });

    expect(() => buildToolRegistry({
      definitions: [
        { definition: tool1, sourcePath: "f1.ts" },
        { definition: tool2, sourcePath: "f2.ts" }
      ],
      maxDefinitions: 1
    })).toThrow(/Too many tool definitions/);
  });

  it("should return immutable registry entries in deterministic order (Case 11)", () => {
    const toolZ = defineTool({ id: "z", description: "d", inputSchema: {}, run: () => {} });
    const toolA = defineTool({ id: "a", description: "d", inputSchema: {}, run: () => {} });
    
    const registry = buildToolRegistry({
      definitions: [
        { definition: toolZ, sourcePath: "z.ts" },
        { definition: toolA, sourcePath: "a.ts" }
      ],
      maxDefinitions: 10
    });

    const list = registry.list();
    expect(list[0].definition.id).toBe("z"); // Follows input order
    expect(list[1].definition.id).toBe("a");

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    expect(Object.isFrozen(list[0].definition)).toBe(true);
  });
});
