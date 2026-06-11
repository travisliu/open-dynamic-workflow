import { describe, expect, it } from "vitest";
import { createWorkflowRegistry, createRootWorkflowRegistry } from "../../../src/workflow/registry.js";
import { OpenFlowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("WorkflowRegistry", () => {
  const mockParsed = (name: string, path: string = "test.js") => ({
    meta: { name, description: "test" },
    body: "",
    sourcePath: path,
    sourceText: "",
    sourceHash: "123"
  });

  it("registers and resolves workflow definitions by exact meta name", () => {
    const p1 = mockParsed("main-review", "main.js");
    const p2 = mockParsed("security-review", "sec.js");
    const registry = createWorkflowRegistry([
      { name: "main-review", description: "d1", sourcePath: "main.js", meta: p1.meta, parsedWorkflow: p1 },
      { name: "security-review", description: "d2", sourcePath: "sec.js", meta: p2.meta, parsedWorkflow: p2 }
    ]);

    expect(registry.get("security-review")?.name).toBe("security-review");
    expect(registry.require("security-review").name).toBe("security-review");
    expect(registry.get("Security-Review")).toBeUndefined();
    
    const list = registry.list();
    expect(list).toHaveLength(2);
    // Registry should be immutable after construction in the sense that list returns a stable copy or the internal array
    expect(Object.isFrozen(list)).toBe(false); // list() returns a new array from Array.from
  });

  it("rejects duplicate workflow names with both source paths", () => {
    const p1 = mockParsed("security-review", "/repo/workflows/a.ts");
    const p2 = mockParsed("security-review", "/repo/workflows/b.ts");
    
    expect(() => createWorkflowRegistry([
      { name: "security-review", description: "d1", sourcePath: "/repo/workflows/a.ts", meta: p1.meta, parsedWorkflow: p1 },
      { name: "security-review", description: "d2", sourcePath: "/repo/workflows/b.ts", meta: p2.meta, parsedWorkflow: p2 }
    ])).toThrow(/Duplicate workflow name 'security-review' found in:\n  - \/repo\/workflows\/a.ts\n  - \/repo\/workflows\/b.ts/);
  });

  it("throws on missing required definition", () => {
    const registry = createWorkflowRegistry([]);
    expect(() => registry.require("missing")).toThrow(OpenFlowError);
    try {
      registry.require("missing");
    } catch (e: any) {
      expect(e.code).toBe(ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND);
    }
  });

  it("creates root workflow registry", () => {
    const p = mockParsed("root", "root.js");
    const registry = createRootWorkflowRegistry(p);
    expect(registry.get("root")?.name).toBe("root");
    expect(registry.list()).toHaveLength(1);
  });
});
