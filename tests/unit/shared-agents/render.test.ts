import { describe, it, expect } from "vitest";
import { renderAgentPrompt } from "../../../src/shared-agents/render.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("renderAgentPrompt", () => {
  it("renders simple variables", () => {
    const result = renderAgentPrompt({
      agentPrompt: "Hello {{name}}!",
      context: { name: "World" },
      declaredFields: new Set(["name"]),
      strictVariables: true,
    });
    expect(result).toBe("Hello World!");
  });

  it("renders multiple variables", () => {
    const result = renderAgentPrompt({
      agentPrompt: "{{greeting}}, {{name}}!",
      context: { greeting: "Hi", name: "User" },
      declaredFields: new Set(["greeting", "name"]),
      strictVariables: true,
    });
    expect(result).toBe("Hi, User!");
  });

  it("stringifies non-string values", () => {
    const result = renderAgentPrompt({
      agentPrompt: "Count: {{count}}, Data: {{data}}",
      context: { count: 42, data: { foo: "bar" } },
      declaredFields: new Set(["count", "data"]),
      strictVariables: true,
    });
    expect(result).toBe('Count: 42, Data: {"foo":"bar"}');
  });

  it("throws for undeclared variables", () => {
    expect(() => {
      renderAgentPrompt({
        agentPrompt: "Hello {{name}}!",
        context: { name: "World" },
        declaredFields: new Set(),
        strictVariables: true,
      });
    }).toThrow(/references undeclared context field 'name'/);
  });

  it("throws for missing variables in strict mode", () => {
    expect(() => {
      renderAgentPrompt({
        agentPrompt: "Hello {{name}}!",
        context: {},
        declaredFields: new Set(["name"]),
        strictVariables: true,
      });
    }).toThrow(/variable 'name' was not provided/);
  });

  it("renders empty string for missing variables when not in strict mode", () => {
    const result = renderAgentPrompt({
      agentPrompt: "Hello {{name}}!",
      context: {},
      declaredFields: new Set(["name"]),
      strictVariables: false,
    });
    expect(result).toBe("Hello !");
  });

  it("throws for unclosed tokens", () => {
    expect(() => {
      renderAgentPrompt({
        agentPrompt: "Hello {{name",
        context: { name: "World" },
        declaredFields: new Set(["name"]),
        strictVariables: true,
      });
    }).toThrow(/contains unclosed tokens/);
  });

  it("throws for expression-like templates", () => {
    expect(() => {
      renderAgentPrompt({
        agentPrompt: "Hello {{name.toUpperCase()}}!",
        context: { name: "World" },
        declaredFields: new Set(["name"]),
        strictVariables: true,
      });
    }).toThrow(/contains unclosed tokens or unsupported expression-like templates/);
  });

  it("throws for empty rendered prompt", () => {
    expect(() => {
      renderAgentPrompt({
        agentPrompt: "{{empty}}",
        context: { empty: "" },
        declaredFields: new Set(["empty"]),
        strictVariables: true,
      });
    }).toThrow(/Rendered prompt must be non-empty/);
  });

  it("allows variables whose values contain double curly braces", () => {
    const result = renderAgentPrompt({
      agentPrompt: "Value is: {{val}}",
      context: { val: "some {{value}} with braces" },
      declaredFields: new Set(["val"]),
      strictVariables: true,
    });
    expect(result).toBe("Value is: some {{value}} with braces");
  });
});
