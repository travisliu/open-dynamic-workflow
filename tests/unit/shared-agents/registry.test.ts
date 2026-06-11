import { describe, expect, it } from "vitest";
import { SharedAgentRegistry } from "../../../src/shared-agents/registry.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenFlowError } from "../../../src/errors/types.js";

describe("SharedAgentRegistry", () => {
  it("registers and retrieves an entry", () => {
    const registry = new SharedAgentRegistry();
    const entry: any = {
      id: "test-agent",
      sourcePath: "/path/to/agent.yaml",
      definition: { id: "test-agent", description: "test" },
    };
    registry.register(entry);
    expect(registry.get("test-agent")).toBe(entry);
    expect(registry.has("test-agent")).toBe(true);
  });

  it("throws error for empty ID", () => {
    const registry = new SharedAgentRegistry();
    const entry: any = {
      id: "",
      sourcePath: "/path/to/agent.yaml",
      definition: { id: "", description: "test" },
    };
    expect(() => registry.register(entry)).toThrow(OpenFlowError);
    try {
        registry.register(entry);
    } catch (err: any) {
        expect(err.code).toBe(ErrorCode.SHARED_AGENT_INVALID_DEFINITION);
    }
  });

  it("throws error for duplicate ID", () => {
    const registry = new SharedAgentRegistry();
    const entry1: any = {
      id: "test-agent",
      sourcePath: "/path/to/agent1.yaml",
      definition: { id: "test-agent", description: "test" },
    };
    const entry2: any = {
      id: "test-agent",
      sourcePath: "/path/to/agent2.yaml",
      definition: { id: "test-agent", description: "test" },
    };
    registry.register(entry1);
    expect(() => registry.register(entry2)).toThrow(OpenFlowError);
    try {
        registry.register(entry2);
    } catch (err: any) {
        expect(err.code).toBe(ErrorCode.SHARED_AGENT_DUPLICATE_ID);
        expect(err.message).toContain("/path/to/agent1.yaml");
        expect(err.message).toContain("/path/to/agent2.yaml");
    }
  });

  it("lists entries in deterministic order", () => {
    const registry = new SharedAgentRegistry();
    const entry1: any = { id: "agent1", sourcePath: "p1", definition: { id: "agent1", description: "d" } };
    const entry2: any = { id: "agent2", sourcePath: "p2", definition: { id: "agent2", description: "d" } };
    registry.register(entry1);
    registry.register(entry2);
    const list = registry.list();
    expect(list).toEqual([entry1, entry2]);
  });
});
