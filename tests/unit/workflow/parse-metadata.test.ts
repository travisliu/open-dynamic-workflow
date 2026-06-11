import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../../src/workflow/parse.js";
import { OpenFlowError } from "../../../src/errors/types.js";

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
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata is not first statement", () => {
    const sourceText = `const x = 1;
    export const meta = {
      name: "bad",
      description: "Metadata is not first"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata is missing name", () => {
    const sourceText = `export const meta = {
      description: "No name"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata name is empty", () => {
    const sourceText = `export const meta = {
      name: "",
      description: "Empty name"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata description is missing", () => {
    const sourceText = `export const meta = {
      name: "valid-name"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata name is dynamic", () => {
    const sourceText = `export const meta = {
      name: "bad-" + Date.now(),
      description: "Dynamic name"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata description is dynamic (e.g. template literal expression)", () => {
    const sourceText = `export const meta = {
      name: "bad",
      description: \`Dynamic \${1+1}\`
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata phases contain non-literal strings", () => {
    const sourceText = `export const meta = {
      name: "bad",
      description: "description",
      phases: ["prep", String(123)]
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata contains spread properties", () => {
    const sourceText = `const extra = {};
    export const meta = {
      name: "bad",
      description: "description",
      ...extra
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("throws when metadata contains computed properties", () => {
    const sourceText = `export const meta = {
      name: "bad",
      description: "description",
      ["extra"]: "value"
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("parses static inputSchema metadata", () => {
    const sourceText = `export const meta = {
      name: "schema-workflow",
      description: "A workflow with schema",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" }
        },
        required: ["target"]
      }
    };`;

    const parsed = parseWorkflow({ sourcePath: "test.js", sourceText });
    expect(parsed.meta.inputSchema).toEqual({
      type: "object",
      properties: {
        target: { type: "string" }
      },
      required: ["target"]
    });
  });

  it("rejects dynamic inputSchema metadata", () => {
    const sourceText = `const schema = {};
    export const meta = {
      name: "bad-schema",
      description: "Dynamic schema",
      inputSchema: schema
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("rejects spread in inputSchema metadata", () => {
    const sourceText = `export const meta = {
      name: "bad-schema",
      description: "Spread schema",
      inputSchema: {
        ...{ type: "object" }
      }
    };`;
    expect(() => parseWorkflow({ sourcePath: "test.js", sourceText })).toThrow(OpenFlowError);
  });

  it("keeps inputSchema optional for existing workflows", () => {
    const sourceText = `export const meta = {
      name: "no-schema",
      description: "No schema"
    };`;
    const parsed = parseWorkflow({ sourcePath: "test.js", sourceText });
    expect(parsed.meta.inputSchema).toBeUndefined();
  });

  it("rejects non-JSON inputSchema constructs", () => {
    const cases = [
      { name: "shorthand", prop: "prop" },
      { name: "computed", prop: '["prop"]: "value"' },
      { name: "function", prop: 'prop: () => {}' },
      { name: "class", prop: 'prop: new class {}' },
      { name: "undefined", prop: 'prop: undefined' },
      { name: "template", prop: 'prop: `val ${1}`' },
      { name: "method", prop: 'method() {}' }
    ];

    for (const c of cases) {
      const sourceText = `export const meta = {
        name: "bad",
        description: "bad",
        inputSchema: {
          ${c.prop}
        }
      };`;
      expect(() => parseWorkflow({ sourcePath: "test.js", sourceText }), `Case ${c.name} should throw`).toThrow(OpenFlowError);
    }
  });
});
