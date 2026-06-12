import { describe, it, expect } from "vitest";
import { defineTool, isDefinedTool } from "../../../src/tools/define-tool.js";
import * as runtimePublic from "../../../src/runtime/public.js";

describe("defineTool", () => {
  it("should brand and freeze a tool definition", () => {
    const definition = {
      id: "test-tool",
      description: "A test tool",
      inputSchema: { type: "object" },
      run: (input: any) => input
    };

    const tool = defineTool(definition);

    expect(isDefinedTool(tool)).toBe(true);
    expect(Object.isFrozen(tool)).toBe(true);
    expect(tool.id).toBe("test-tool");
    
    // Original should not be mutated or branded
    expect(isDefinedTool(definition)).toBe(false);
    expect(Object.isFrozen(definition)).toBe(false);

    // Marker should be non-enumerable
    const descriptor = Object.getOwnPropertyDescriptor(tool, Symbol.for("openflow.toolDefinition"));
    expect(descriptor?.enumerable).toBe(false);
  });

  it("should not perform registry validation in the declaration helper (Case 2)", () => {
    // Malformed definition that would fail registry validation
    const malformed = {
      id: "invalid ID with spaces",
      description: "missing inputSchema",
      run: "not-a-function"
    };

    const tool = defineTool(malformed as any);

    expect(isDefinedTool(tool)).toBe(true);
    expect(Object.isFrozen(tool)).toBe(true);
    expect(tool.id).toBe("invalid ID with spaces");
    // Should NOT throw here
  });

  it("should be exported from public package entry points (Case 3)", () => {
    expect(typeof runtimePublic.defineTool).toBe("function");
    
    const tool = runtimePublic.defineTool({
      id: "exported-tool",
      description: "desc",
      inputSchema: {},
      run: () => {}
    });
    expect(isDefinedTool(tool)).toBe(true);
  });

  it("should reject non-branded objects in isDefinedTool", () => {
    expect(isDefinedTool({})).toBe(false);
    expect(isDefinedTool(null)).toBe(false);
    expect(isDefinedTool(undefined)).toBe(false);
    expect(isDefinedTool({ id: "test" })).toBe(false);
  });
});
