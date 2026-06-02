import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../../src/workflow/parse.js";
import { ExecflowError } from "../../../src/errors/types.js";

describe("Parse Workflow Metadata", () => {
  it("parses valid simple metadata", () => {
    const sourceText = `export const meta = {
      name: "test-workflow",
      description: "A simple test workflow"
    };
    phase("run");`;

    const parsed = parseWorkflow({ sourcePath: "test.js", sourceText });
    expect(parsed.meta.name).toBe("test-workflow");
    expect(parsed.meta.description).toBe("A simple test workflow");
    expect(parsed.body).toBe('phase("run");');
    expect(parsed.sourceHash).toBeDefined();
  });

  it("parses valid metadata with phases", () => {
    const sourceText = `export const meta = {
      name: "phases-workflow",
      description: "A workflow with phases",
      phases: ["prep", "exec"]
    };
    log("hello");`;

    const parsed = parseWorkflow({ sourcePath: "test.js", sourceText });
    expect(parsed.meta.phases).toEqual(["prep", "exec"]);
  });

  it("throws on missing metadata", () => {
    const sourceText = `phase("run");`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata is not first statement", () => {
    const sourceText = `const x = 1;
    export const meta = {
      name: "bad",
      description: "Metadata is not first"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata is missing name", () => {
    const sourceText = `export const meta = {
      description: "No name"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata name is empty", () => {
    const sourceText = `export const meta = {
      name: "",
      description: "Empty name"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata description is missing", () => {
    const sourceText = `export const meta = {
      name: "valid-name"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata name is dynamic", () => {
    const sourceText = `export const meta = {
      name: "bad-" + Date.now(),
      description: "Dynamic name"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata description is dynamic (e.g. template literal expression)", () => {
    const sourceText = `export const meta = {
      name: "bad",
      description: \`Dynamic \${1+1}\`
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata phases contain non-literal strings", () => {
    const sourceText = `export const meta = {
      name: "bad",
      description: "description",
      phases: ["prep", String(123)]
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata contains spread properties", () => {
    const sourceText = `const extra = {};
    export const meta = {
      name: "bad",
      description: "description",
      ...extra
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });

  it("throws when metadata contains computed properties", () => {
    const sourceText = `export const meta = {
      name: "bad",
      description: "description",
      ["extra"]: "value"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(ExecflowError);
  });
});
