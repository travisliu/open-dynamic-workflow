import { describe, it, expect } from "vitest";
import { activeToolRuntimeApi } from "../../../src/tools/runtime-api.js";
import { defineTool, isDefinedTool } from "../../../src/tools/define-tool.js";

describe("runtime-api", () => {
  it("should export a frozen activeToolRuntimeApi object containing defineTool", () => {
    expect(Object.isFrozen(activeToolRuntimeApi)).toBe(true);
    expect(activeToolRuntimeApi.defineTool).toBe(defineTool);
  });

  it("should create a valid branded and frozen definition when using activeToolRuntimeApi.defineTool", () => {
    const definition = {
      id: "api-test-tool",
      description: "A tool created via runtime-api",
      inputSchema: { type: "object" },
      run: (input: any) => input
    };

    const tool = activeToolRuntimeApi.defineTool(definition);

    expect(isDefinedTool(tool)).toBe(true);
    expect(Object.isFrozen(tool)).toBe(true);
    expect(tool.id).toBe("api-test-tool");
    expect(isDefinedTool(definition)).toBe(false);
  });
});
