import { describe, expect, it } from "vitest";
import { validateWorkflow } from "../../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../../src/workflow/types.js";

describe("Validate Workflow Restrictions", () => {
  const options = { allowImports: false as const, allowShell: false as const };

  const createParsed = (bodyText: string): ParsedWorkflow => ({
    meta: { name: "test", description: "test" },
    body: bodyText,
    sourcePath: "test.js",
    sourceText: `export const meta = { name: "test", description: "test" };\n${bodyText}`,
    sourceHash: "123"
  });

  it("passes a valid simple workflow using allowed primitives", () => {
    const parsed = createParsed(`
      phase("review");
      log("starting review");
      const res = await agent({ prompt: "hello" });
      export default res;
    `);

    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("flags require() calls", () => {
    const parsed = createParsed(`
      const fs = require("fs");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("require() is not supported"))).toBe(true);
  });

  it("flags import statements", () => {
    const parsed = createParsed(`
      import fs from "fs";
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Arbitrary imports"))).toBe(true);
  });

  it("flags process.env and process.cwd() access", () => {
    const parsed = createParsed(`
      const env = process.env;
      const cwd = process.cwd();
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Direct process access"))).toBe(true);
  });

  it("flags fs access", () => {
    const parsed = createParsed(`
      const files = fs.readdirSync(".");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Direct module access"))).toBe(true);
  });

  it("flags child_process access", () => {
    const parsed = createParsed(`
      const cp = child_process.spawn("ls");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Shell/process spawning"))).toBe(true);
  });

  it("flags fetch() calls", () => {
    const parsed = createParsed(`
      const res = await fetch("https://google.com");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Network APIs"))).toBe(true);
  });

  it("flags shell() calls", () => {
    const parsed = createParsed(`
      await shell("echo hello");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("shell() is not supported"))).toBe(true);
  });

  it("flags pipeline() calls using function shorthand", () => {
    const parsed = createParsed(`
      await pipeline([], x => x);
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("stages must be named stage objects"))).toBe(true);
  });

  it("flags Date.now() calls", () => {
    const parsed = createParsed(`
      const time = Date.now();
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Date.now() is not allowed"))).toBe(true);
  });

  it("flags Math.random() calls", () => {
    const parsed = createParsed(`
      const rand = Math.random();
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Math.random() is not allowed"))).toBe(true);
  });

  it("flags new Date() without arguments", () => {
    const parsed = createParsed(`
      const now = new Date();
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("new Date() without arguments is not allowed"))).toBe(true);
  });

  it("flags constructor access", () => {
    const parsed = createParsed(`
      const c = ({}).constructor;
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Access to 'constructor' is not allowed"))).toBe(true);
  });

  it("flags __proto__ access", () => {
    const parsed = createParsed(`
      const p = ({}).__proto__;
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Access to '__proto__' is not allowed"))).toBe(true);
  });

  it("flags globalThis access", () => {
    const parsed = createParsed(`
      const g = globalThis;
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Global object access is not allowed"))).toBe(true);
  });

  it("flags Function constructor", () => {
    const parsed = createParsed(`
      const f = new Function('return process');
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Dynamic function creation is not allowed"))).toBe(true);
  });

  it("flags indirect constructor access via bracket notation", () => {
    const parsed = createParsed(`
      const c = ({})['constructor'];
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("Access to 'constructor' is not allowed"))).toBe(true);
  });

  it("accepts agent() with valid permissions literal", () => {
    const parsed = createParsed(`
      await agent({ prompt: "hello", permissions: { mode: "dangerously-full-access" } });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("flags agent() with invalid mode in permissions literal", () => {
    const parsed = createParsed(`
      await agent({ prompt: "hello", permissions: { mode: "yolo" } });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() permissions.mode must be 'dangerously-full-access'"))).toBe(true);
  });

  it("flags agent() with missing mode in permissions literal", () => {
    const parsed = createParsed(`
      await agent({ prompt: "hello", permissions: {} });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() permissions must include a 'mode' property"))).toBe(true);
  });

  it("flags agent() with extra keys in permissions literal", () => {
    const parsed = createParsed(`
      await agent({ prompt: "hello", permissions: { mode: "dangerously-full-access", approval: "never" } });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() permissions contain unsupported key 'approval'"))).toBe(true);
  });

  it("flags agent() with non-object permissions literal", () => {
    const parsed = createParsed(`
      await agent({ prompt: "hello", permissions: "dangerously-full-access" });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() permissions must be an object literal"))).toBe(true);
  });

  it("accepts agent() with dynamic permissions variable", () => {
    const parsed = createParsed(`
      const myPerms = { mode: "dangerously-full-access" };
      await agent({ prompt: "hello", permissions: myPerms });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("accepts agent() with dynamic mode variable", () => {
    const parsed = createParsed(`
      const myMode = "dangerously-full-access";
      await agent({ prompt: "hello", permissions: { mode: myMode } });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("flags agent() with missing prompt in direct call", () => {
    const parsed = createParsed(`
      await agent({ provider: "mock" });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() is missing required 'prompt' property"))).toBe(true);
  });

  it("flags ctx.agent() with missing prompt in direct call inside stage", () => {
    const parsed = createParsed(`
      await pipeline([], [{
        name: "test",
        run: async (item, ctx) => {
          await ctx.agent({ provider: "mock" });
        }
      }]);
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("ctx.agent() is missing required 'prompt' property"))).toBe(true);
  });

  it("flags agent() with empty prompt string literal in direct call", () => {
    const parsed = createParsed(`
      await agent({ provider: "mock", prompt: "" });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() prompt cannot be empty"))).toBe(true);
  });

  it("flags agent() with non-string prompt literal in direct call", () => {
    const parsed = createParsed(`
      await agent({ provider: "mock", prompt: 123 });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() prompt must be a string literal"))).toBe(true);
  });

  it("accepts agent() with dynamic prompt variable", () => {
    const parsed = createParsed(`
      const myPrompt = "hello";
      await agent({ provider: "mock", prompt: myPrompt });
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("accepts ctx.agent() with dynamic prompt variable", () => {
    const parsed = createParsed(`
      await pipeline([], [{
        name: "test",
        run: async (item, ctx) => {
          const myPrompt = "hello";
          await ctx.agent({ provider: "mock", prompt: myPrompt });
        }
      }]);
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues).toHaveLength(0);
  });

  it("flags agent() with missing argument", () => {
    const parsed = createParsed(`
      await agent();
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() requires an object literal argument"))).toBe(true);
  });

  it("flags agent() with non-object literal argument", () => {
    const parsed = createParsed(`
      await agent("hello");
    `);
    const issues = validateWorkflow(parsed, options);
    expect(issues.some(i => i.message.includes("agent() argument must be an object literal"))).toBe(true);
  });

  describe("Shared Agent Validation", () => {
    it("accepts valid agent({ definition }) call", () => {
      const parsed = createParsed(`
        await agent({ definition: "security-review", prompt: "..." });
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues).toHaveLength(0);
    });

    it("flags agent({ definition }) with path-like ID", () => {
      const parsed = createParsed(`
        await agent({ definition: "./agents/security-review", prompt: "..." });
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues.some(i => i.message.includes("must use a registry ID, not a path"))).toBe(true);
    });

    it("flags agent({ definition }) with unknown literal ID when knownSharedAgentIds is provided", () => {
      const parsed = createParsed(`
        await agent({ definition: "unknown-agent", prompt: "..." });
      `);
      const issues = validateWorkflow(parsed, {
        ...options,
        knownSharedAgentIds: new Set(["security-review"])
      });
      expect(issues.some(i => i.message.includes("was not found in the configured registry"))).toBe(true);
    });

    it("flags agent({ definition }) with dynamic ID when allowDynamicSharedAgentIds is false", () => {
      const parsed = createParsed(`
        const name = "security-review";
        await agent({ definition: name, prompt: "..." });
      `);
      const issues = validateWorkflow(parsed, {
        ...options,
        allowDynamicSharedAgentIds: false
      });
      expect(issues.some(i => i.message.includes("ID must be a string literal"))).toBe(true);
    });

    it("flags ctx.agent({ definition }) with dynamic ID when allowDynamicSharedAgentIds is false", () => {
      const parsed = createParsed(`
        export default async (ctx) => {
          const name = "security-review";
          await ctx.agent({ definition: name, prompt: "..." });
        };
      `);
      const issues = validateWorkflow(parsed, {
        ...options,
        allowDynamicSharedAgentIds: false
      });
      expect(issues.some(i => i.message.includes("ID must be a string literal"))).toBe(true);
    });

    it("accepts ctx.agent({ definition }) call in pipeline stage", () => {
      const parsed = createParsed(`
        await pipeline([], [{
          name: "test",
          run: async (item, ctx) => {
            await ctx.agent({ definition: "security-review", item });
          }
        }]);
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues).toHaveLength(0);
    });

    it("flags agent({ definition }) with invalid input schema statically", () => {
      const parsed = createParsed(`
        await agent({ definition: "security-review", prompt: 123 });
      `);
      const mockRegistry: any = {
        list: () => [{ id: "security-review" }],
        get: (id: string) => {
          if (id === "security-review") {
            return {
              definition: {
                id: "security-review",
                inputSchema: {
                  type: "object",
                  properties: {
                    prompt: { type: "string" }
                  }
                }
              }
            };
          }
          return undefined;
        }
      };
      const issues = validateWorkflow(parsed, {
        ...options,
        sharedAgentRegistry: mockRegistry
      });
      expect(issues.some(i => i.message.includes("input validation failed"))).toBe(true);
    });

    it("flags agent({ definition }) with missing required properties and no dynamic props", () => {
      const parsed = createParsed(`
        await agent({ definition: "security-review" });
      `);
      const mockRegistry: any = {
        list: () => [{ id: "security-review" }],
        get: (id: string) => {
          if (id === "security-review") {
            return {
              definition: {
                id: "security-review",
                inputSchema: {
                  type: "object",
                  properties: {
                    prompt: { type: "string" }
                  },
                  required: ["prompt"]
                }
              }
            };
          }
          return undefined;
        }
      };
      const issues = validateWorkflow(parsed, {
        ...options,
        sharedAgentRegistry: mockRegistry
      });
      expect(issues.some(i => i.message.includes("must have required property"))).toBe(true);
    });

    it("does not flag missing required properties when dynamic properties are present", () => {
      const parsed = createParsed(`
        const myVal = "val";
        await agent({ definition: "security-review", myVal });
      `);
      const mockRegistry: any = {
        list: () => [{ id: "security-review" }],
        get: (id: string) => {
          if (id === "security-review") {
            return {
              definition: {
                id: "security-review",
                inputSchema: {
                  type: "object",
                  properties: {
                    prompt: { type: "string" }
                  },
                  required: ["prompt"]
                }
              }
            };
          }
          return undefined;
        }
      };
      const issues = validateWorkflow(parsed, {
        ...options,
        sharedAgentRegistry: mockRegistry
      });
      expect(issues).toHaveLength(0);
    });
  });

  describe("Nested Workflow Validation", () => {
    it("accepts valid workflow() call", () => {
      const parsed = createParsed(`
        await workflow({ name: "child-workflow", args: { x: 1 } });
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues).toHaveLength(0);
    });

    it("flags workflow() with path-like name", () => {
      const parsed = createParsed(`
        await workflow({ name: "./child-workflow" });
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues.some(i => i.message.includes("Workflow names must not be path-like"))).toBe(true);
    });

    it("flags workflow() with path-like names including subdir/child, child.ts, child.js, file:child, and drive paths", () => {
      const paths = [
        "subdir/child",
        "child.ts",
        "child.js",
        "file:child",
        "file:///child",
        "./child",
        "../child",
        "/child",
        "\\\\server\\\\child",
        "C:\\\\child",
        "safe/../child"
      ];
      for (const p of paths) {
        const parsed = createParsed(`
          await workflow({ name: "${p}" });
        `);
        const issues = validateWorkflow(parsed, options);
        expect(issues.some(i => i.message.includes("Workflow names must not be path-like")), `Expected to reject path-like name: ${p}`).toBe(true);
      }
    });

    it("flags workflow() with unknown literal name when knownWorkflowNames is provided", () => {
      const parsed = createParsed(`
        await workflow({ name: "unknown-workflow" });
      `);
      const issues = validateWorkflow(parsed, {
        ...options,
        knownWorkflowNames: new Set(["child-workflow"])
      });
      expect(issues.some(i => i.message.includes("was not found in the registry"))).toBe(true);
    });

    it("flags workflow() with invalid input schema statically", () => {
      const parsed = createParsed(`
        await workflow({ name: "child-workflow", args: { target: 123 } });
      `);
      const issues = validateWorkflow(parsed, {
        ...options,
        knownWorkflowNames: new Set(["child-workflow"]),
        workflowInputSchemas: new Map([
          ["child-workflow", {
            type: "object",
            properties: {
              target: { type: "string" }
            }
          }]
        ])
      });
      expect(issues.some(i => i.message.includes("input validation failed"))).toBe(true);
    });

    it("flags workflow() with missing required properties", () => {
      const parsed = createParsed(`
        await workflow({ name: "child-workflow", args: {} });
      `);
      const issues = validateWorkflow(parsed, {
        ...options,
        knownWorkflowNames: new Set(["child-workflow"]),
        workflowInputSchemas: new Map([
          ["child-workflow", {
            type: "object",
            required: ["target"]
          }]
        ])
      });
      expect(issues.some(i => i.message.includes("must have required property 'target'"))).toBe(true);
    });

    it("accepts ctx.workflow() in pipeline stage", () => {
      const parsed = createParsed(`
        await pipeline([], [{
          name: "test",
          run: async (item, ctx) => {
            await ctx.workflow({ name: "child-workflow", args: { item } });
          }
        }]);
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues).toHaveLength(0);
    });

    it("flags invalid inputSchema in metadata", () => {
       const parsed = {
         meta: { 
           name: "test", 
           description: "test",
           inputSchema: { type: "invalid-type" } as any
         },
         body: "",
         sourcePath: "test.js",
         sourceText: "",
         sourceHash: "123"
       };
       const issues = validateWorkflow(parsed, options);
       expect(issues.some(i => i.message.includes("not a valid JSON Schema"))).toBe(true);
    });

    it("rejects unsupported keys on workflow call object", () => {
      const parsed = createParsed(`
        await workflow({ name: "child-workflow", unexpected: true });
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues.some(i => i.message.includes("contains unsupported key 'unexpected'"))).toBe(true);
    });

    it("rejects invalid failureMode on workflow call object", () => {
      const parsed = createParsed(`
        await workflow({ name: "child-workflow", failureMode: "ignore" });
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues.some(i => i.message.includes("failureMode must be 'throw' or 'settled'"))).toBe(true);
    });

    it("rejects invalid timeoutMs literals on workflow call object", () => {
      const cases = [
        { val: "0", msg: "timeoutMs must be a positive integer" },
        { val: "1.5", msg: "timeoutMs must be a positive integer" },
        { val: '"100"', msg: "timeoutMs must be a positive integer" }
      ];
      for (const { val, msg } of cases) {
        const parsed = createParsed(`
          await workflow({ name: "child-workflow", timeoutMs: ${val} });
        `);
        const issues = validateWorkflow(parsed, options);
        expect(issues.some(i => i.message.includes(msg))).toBe(true);
      }
    });

    it("rejects invalid concurrency literals on workflow call object", () => {
      const cases = [
        { val: "0", msg: "concurrency must be a positive integer" },
        { val: '"2"', msg: "concurrency must be a positive integer" }
      ];
      for (const { val, msg } of cases) {
        const parsed = createParsed(`
          await workflow({ name: "child-workflow", concurrency: ${val} });
        `);
        const issues = validateWorkflow(parsed, options);
        expect(issues.some(i => i.message.includes(msg))).toBe(true);
      }
    });

    it("rejects static non-object metadata literals on workflow call object", () => {
      const parsed = createParsed(`
        await workflow({ name: "child-workflow", metadata: "not-an-object" });
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues.some(i => i.message.includes("metadata must be an object"))).toBe(true);
    });

    it("accepts valid options on workflow call object", () => {
      const parsed = createParsed(`
        await workflow({
          name: "child-workflow",
          failureMode: "settled",
          timeoutMs: 1000,
          concurrency: 2,
          metadata: { label: "review" }
        });
      `);
      const issues = validateWorkflow(parsed, options);
      expect(issues).toHaveLength(0);
    });
  });
});
