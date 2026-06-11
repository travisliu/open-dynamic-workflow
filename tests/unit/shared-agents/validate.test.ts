import { describe, expect, it } from "vitest";
import { validateSharedAgentDefinition, validateSharedAgentSource } from "../../../src/shared-agents/validate.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenFlowError } from "../../../src/errors/types.js";
import type { SharedAgentDefinition } from "../../../src/shared-agents/types.js";

describe("SharedAgent Validation", () => {
  describe("validateSharedAgentDefinition", () => {
    it("rejects a declarative definition without run", () => {
      const def = {
        id: "invalid-agent",
        description: "An agent without run",
        agentPrompt: "Hello {{name}}"
      };
      expect(() => validateSharedAgentDefinition(def, "test.yaml")).toThrow(OpenFlowError);
    });

    it("accepts a valid function definition", () => {
      const def = {
        id: "func-agent",
        description: "A valid function agent",
        run: async () => ({ ok: true })
      };
      const result = validateSharedAgentDefinition(def, "test.js");
      expect(result).toEqual(def);
    });

    it("rejects invalid IDs", () => {
      const trulyInvalid = ["", "Invalid-ID", "agent!"];
      for (const id of trulyInvalid) {
        const def = { id, description: "desc", run: async () => ({ ok: true }) };
        expect(() => validateSharedAgentDefinition(def, "test.yaml")).toThrow(OpenFlowError);
      }
    });

    it("accepts missing description but rejects non-string description", () => {
      const def1: SharedAgentDefinition = { id: "agent", run: async () => ({ ok: true }) };
      expect(validateSharedAgentDefinition(def1, "test.yaml").id).toBe("agent");

      const def2 = { id: "agent", description: 123, run: async () => ({ ok: true }) };
      expect(() => validateSharedAgentDefinition(def2, "test.yaml")).toThrow(OpenFlowError);
    });

    it("accepts both agentPrompt and run", () => {
      const def = { id: "agent", description: "desc", agentPrompt: "p", run: async () => ({ ok: true, status: "succeeded" }) };
      const result = validateSharedAgentDefinition(def, "test.yaml");
      expect(result).toEqual(def);
    });

    it("rejects invalid JSON schema", () => {
      const def = {
        id: "agent",
        description: "desc",
        run: async () => ({ ok: true }),
        inputSchema: { type: "invalid" }
      };
      expect(() => validateSharedAgentDefinition(def, "test.yaml")).toThrow(OpenFlowError);
    });

    it("rejects malformed schema objects like type: 123", () => {
      const def = {
        id: "agent",
        description: "desc",
        run: async () => ({ ok: true }),
        inputSchema: { type: 123 }
      };
      expect(() => validateSharedAgentDefinition(def, "test.yaml")).toThrow(OpenFlowError);
    });

    it("rejects undeclared prompt variables in strict mode", () => {
      const def = {
        id: "agent",
        description: "desc",
        agentPrompt: "Hello {{name}}",
        run: async () => ({ ok: true }),
        inputSchema: {
          type: "object",
          properties: {
            other: { type: "string" }
          }
        }
      };
      expect(() => validateSharedAgentDefinition(def, "test.yaml", { strictPromptTemplateVariables: true }))
        .toThrow(OpenFlowError);
      try {
        validateSharedAgentDefinition(def, "test.yaml", { strictPromptTemplateVariables: true });
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.SHARED_AGENT_UNDECLARED_PROMPT_VARIABLE);
      }
    });
  });

  describe("validateSharedAgentSource", () => {
    it("accepts safe source", () => {
      const source = `
        defineAgent({
          id: "safe",
          description: "safe",
          run: async (ctx, runtime) => {
            runtime.log("hello");
            return { ok: true };
          }
        });
      `;
      expect(() => validateSharedAgentSource(source, "safe.js")).not.toThrow();
    });

    it("rejects imports", () => {
      const source = `import fs from "fs";`;
      expect(() => validateSharedAgentSource(source, "bad.js")).toThrow(OpenFlowError);
    });

    it("rejects require", () => {
      const source = `const fs = require("fs");`;
      expect(() => validateSharedAgentSource(source, "bad.js")).toThrow(OpenFlowError);
    });

    it("rejects restricted globals like process", () => {
      const source = `console.log(process.env);`;
      expect(() => validateSharedAgentSource(source, "bad.js")).toThrow(OpenFlowError);
    });

    it("rejects access to constructor", () => {
      const source = `const x = {}.constructor;`;
      expect(() => validateSharedAgentSource(source, "bad.js")).toThrow(OpenFlowError);
    });

    it("rejects restricted host APIs", () => {
      const forbidden = ["fs", "path", "os", "child_process", "net", "http", "https", "shell"];
      for (const api of forbidden) {
        const source = `const x = ${api}.someMethod();`;
        expect(() => validateSharedAgentSource(source, "bad.js"), `Should reject ${api}`).toThrow(OpenFlowError);
      }
    });

    it("rejects restricted property access", () => {
      const source = `const x = globalThis.process;`;
      expect(() => validateSharedAgentSource(source, "bad.js")).toThrow(OpenFlowError);
    });

    it("rejects element access aliases and computed escapes", () => {
      const aliases = [
        'globalThis["process"]',
        'globalThis["fetch"]',
        'obj["constructor"]',
        'obj["__proto__"]',
        'obj["prototype"]',
        'obj["con" + "structor"]',
        'obj[`constructor`]',
      ];
      for (const alias of aliases) {
        const source = `const x = ${alias};`;
        expect(() => validateSharedAgentSource(source, "bad.js"), `Should reject ${alias}`).toThrow(OpenFlowError);
      }
    });

    it("rejects dynamic element access", () => {
      const source = `const x = obj[someVar];`;
      expect(() => validateSharedAgentSource(source, "bad.js")).toThrow(OpenFlowError);
      try {
        validateSharedAgentSource(source, "bad.js");
      } catch (err: any) {
        expect(err.message).toContain("Dynamic element access is not allowed");
      }
    });

    it("rejects 'this' keyword", () => {
      const source = `const x = this;`;
      expect(() => validateSharedAgentSource(source, "bad.js")).toThrow(OpenFlowError);
      try {
        validateSharedAgentSource(source, "bad.js");
      } catch (err: any) {
        expect(err.message).toContain("'this' keyword is not allowed");
      }
    });

    it("rejects expanded restricted built-ins", () => {
      const forbidden = ["Object", "Reflect", "Proxy", "AsyncFunction"];
      for (const api of forbidden) {
        const source = `const x = ${api}.keys({});`;
        expect(() => validateSharedAgentSource(source, "bad.js"), `Should reject ${api}`).toThrow(OpenFlowError);
      }
    });

    it("rejects workflow globals", () => {
      const globals = ["phase", "parallel", "pipeline", "args"];
      for (const g of globals) {
        const source = `const x = ${g};`;
        expect(() => validateSharedAgentSource(source, "bad.js"), `Should reject ${g}`).toThrow(OpenFlowError);
      }
    });

    it("rejects access to restricted built-in properties", () => {
      const builtins = ["Function", "Object", "Reflect", "Proxy", "AsyncFunction"];
      for (const b of builtins) {
        const variants = [
          `const x = obj.${b};`,
          `const x = obj["${b}"];`,
        ];
        for (const source of variants) {
          expect(() => validateSharedAgentSource(source, "bad.js"), `Should reject ${source}`).toThrow(OpenFlowError);
        }
      }
    });

    it("allows runtime access", () => {
      const source = `
        defineAgent({
          id: "test",
          run: async (ctx, runtime) => {
            runtime.log("ok");
            await runtime.agent("other").run({});
            return { ok: true };
          }
        });
      `;
      expect(() => validateSharedAgentSource(source, "good.js")).not.toThrow();
    });

    it("allows comments, descriptions, and prompts containing restricted terms like path, fs, process", () => {
      const source = `
        // This is a comment about path handling and fs or process
        defineAgent({
          id: "safe-text-agent",
          description: "Review the path handling, process logs, and fs updates in this patch",
          agentPrompt: "Review the path handling or fs details and log to process output",
          run: async (ctx, runtime) => {
            const doc = "Here is some process information and file system path.";
            runtime.log(doc);
            return { ok: true };
          }
        });
      `;
      expect(() => validateSharedAgentSource(source, "safe-text-agent.js")).not.toThrow();
    });
  });
});
