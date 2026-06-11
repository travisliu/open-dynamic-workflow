import { describe, expect, it } from "vitest";
import { validateRegistryDependencies } from "../../../src/workflow/validate.js";
import { createWorkflowRegistry, type WorkflowDefinition } from "../../../src/workflow/registry.js";
import type { ParsedWorkflow } from "../../../src/workflow/types.js";
import { OpenFlowError } from "../../../src/errors/types.js";

describe("Validate Registry Dependencies", () => {
  const createParsed = (name: string, bodyText: string): ParsedWorkflow => ({
    meta: { name, description: "test" },
    body: bodyText,
    sourcePath: `${name}.js`,
    sourceText: `export const meta = { name: "${name}", description: "test" };\n${bodyText}`,
    sourceHash: "123"
  });

  const createDef = (name: string, bodyText: string): WorkflowDefinition => {
    const parsed = createParsed(name, bodyText);
    return {
      name,
      description: "test",
      sourcePath: `${name}.js`,
      meta: parsed.meta,
      parsedWorkflow: parsed,
      inputSchema: parsed.meta.inputSchema
    };
  };

  it("passes when there are no dependency cycles", () => {
    const registry = createWorkflowRegistry([
      createDef("a", `await workflow({ name: "b" });`),
      createDef("b", `await workflow({ name: "c" });`),
      createDef("c", `log("done");`)
    ]);

    expect(() => validateRegistryDependencies(registry, {})).not.toThrow();
  });

  it("detects direct cycle a -> a", () => {
    const registry = createWorkflowRegistry([
      createDef("a", `await workflow({ name: "a" });`)
    ]);

    expect(() => validateRegistryDependencies(registry, {})).toThrow(
      /Static recursion cycle detected: a \(a.js:2:24\) -> a/
    );
  });

  it("detects indirect cycle a -> b -> c -> a", () => {
    const registry = createWorkflowRegistry([
      createDef("a", `await workflow({ name: "b" });`),
      createDef("b", `await workflow({ name: "c" });`),
      createDef("c", `await workflow({ name: "a" });`)
    ]);

    expect(() => validateRegistryDependencies(registry, {})).toThrow(
      /Static recursion cycle detected: a \(a.js:2:24\) -> b \(b.js:2:24\) -> c \(c.js:2:24\) -> a/
    );
  });

  it("reports transitive child validation failure with error chain", () => {
    const registry = createWorkflowRegistry([
      createDef("a", `await workflow({ name: "b" });`),
      createDef("b", `await workflow({ name: "c" });`),
      // c is invalid because it calls an undeclared workflow
      createDef("c", `await workflow({ name: "missing" });`)
    ]);

    expect(() => validateRegistryDependencies(registry, {})).toThrow(
      /Workflow 'missing' was not found in the registry/
    );

    // Let's assert the full chain is in the error message
    try {
      validateRegistryDependencies(registry, {});
      throw new Error("expected error");
    } catch (err: any) {
      expect(err.message).toContain("c.js:2:24");
      expect(err.message).toContain("b.js:2:24");
      expect(err.message).toContain("a.js:2:24");
      expect(err.message).toContain("Workflow 'missing' was not found in the registry");
    }
  });
});
