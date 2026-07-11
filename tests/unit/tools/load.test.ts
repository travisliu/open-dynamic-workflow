import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadToolRegistry } from "../../../src/tools/load.js";
import { compileResourceDiscovery } from "../../../src/discovery/compile-patterns.js";

describe("loadToolRegistry", () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-"));
  });

  afterEach(async () => {
    await rm(tempBaseDir, { recursive: true, force: true });
  });

  it("should return empty registry if directory is missing", async () => {
    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "non-existent",
      maxDefinitions: 10
    });
    expect(registry.list().length).toBe(0);
  });

  it("should discover only top-level supported files in canonical order (Case 13)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    await mkdir(join(toolsDir, "nested"));
    
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    const toolTemplate = (id: string) => `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "${id}", description: "${id}", inputSchema: {}, run: () => {} });
    `;

    await writeFile(join(toolsDir, "z.ts"), toolTemplate("z"));
    await writeFile(join(toolsDir, "a.js"), toolTemplate("a"));
    await writeFile(join(toolsDir, "c.mjs"), toolTemplate("c"));
    await writeFile(join(toolsDir, "ignored.txt"), "not a tool");
    await writeFile(join(toolsDir, "nested", "nested.ts"), toolTemplate("nested"));

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list[0].definition.id).toBe("a");
    expect(list[1].definition.id).toBe("c");
    expect(list[2].definition.id).toBe("z");
  });

  it("should load trusted tool modules that import Node APIs (Case 14)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    await writeFile(join(toolsDir, "node-tool.js"), `
      import { defineTool } from "${srcToolsPath}";
      import * as os from "node:os";
      import * as fs from "node:fs";
      export default defineTool({
        id: "node-tool",
        description: "node tool",
        inputSchema: { type: "object" },
        run: () => os.platform()
      });
    `);

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    expect(registry.has("node-tool")).toBe(true);
    // run has not been called
  });

  it("should reject malformed or unbranded module exports (Case 15)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    // No default export
    await writeFile(join(toolsDir, "no-export.js"), "export const x = 1;");
    
    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toMatch(/must default export defineTool/);
  });

  it("should reject a statically valid-looking but runtime-unbranded default export", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);

    await writeFile(join(toolsDir, "fake-unbranded.ts"), `
      function defineTool(def: any) {
        return def;
      }

      export default defineTool({
        id: "fake-unbranded",
        description: "not branded",
        inputSchema: { type: "object" },
        run: () => "never"
      });
    `);

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toContain("tools/fake-unbranded.ts");
    expect(err.message).toMatch(/does not have a valid default export created with defineTool/);
  });

  async function expectLoadFailure(input: any, code: string) {
    try {
      await loadToolRegistry(input);
      throw new Error(`Expected loadToolRegistry to fail with code ${code} but it succeeded`);
    } catch (err: any) {
      expect(err.code).toBe(code);
      return err;
    }
  }

  it("rejects duplicate static tool IDs before importing modules (Case 16)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    const m1 = join(tempBaseDir, "m1.marker");
    const m2 = join(tempBaseDir, "m2.marker");

    const toolTemplate = (id: string, marker: string) => `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(marker)}, "imported");
      export default defineTool({ id: "${id}", description: "d", inputSchema: {}, run: () => {} });
    `;

    await writeFile(join(toolsDir, "t1.ts"), toolTemplate("dup", m1));
    await writeFile(join(toolsDir, "t2.ts"), toolTemplate("dup", m2));

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_DUPLICATE_DEFINITION");

    expect(err.message).toMatch(/Duplicate tool ID 'dup'/);
    expect(err.message).toContain("tools/t1.ts");
    expect(err.message).toContain("tools/t2.ts");

    const { existsSync } = await import("node:fs");
    expect(existsSync(m1)).toBe(false);
    expect(existsSync(m2)).toBe(false);
  });

  it("should respect configured maxDefinitions before execution (Case 17)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    const toolTemplate = (id: string) => `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({ id: "${id}", description: "d", inputSchema: {}, run: () => {} });
    `;

    await writeFile(join(toolsDir, "t1.ts"), toolTemplate("t1"));
    await writeFile(join(toolsDir, "t2.ts"), toolTemplate("t2"));

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 1
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toMatch(/Too many tool definitions/);
  });

  it("should support sibling and nested helper imports and discover top-level files regardless of name (Issue 4, ISSUE-003)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);

    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    
    // Sibling helper in nested dir (recommended pattern)
    await mkdir(join(toolsDir, "utils"), { recursive: true });
    await writeFile(join(toolsDir, "utils", "helper.ts"), `
      export function add(a: number, b: number) { return a + b; }
    `);

    // Nested helper
    await mkdir(join(toolsDir, "nested"), { recursive: true });
    await writeFile(join(toolsDir, "nested", "format.ts"), `
      export function formatResult(val: number) { return "Result: " + val; }
    `);

    // Tool entry importing both helpers using .js extension
    await writeFile(join(toolsDir, "math.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import { add } from "./utils/helper.js";
      import { formatResult } from "./nested/format.js";
      export default defineTool({
        id: "math-tool",
        description: "adds numbers",
        inputSchema: {},
        run: () => formatResult(add(2, 3))
      });
    `);

    // Top-level file with 'helper' in name that IS a valid tool
    await writeFile(join(toolsDir, "github-helper.ts"), `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({
        id: "github-tool",
        description: "gh",
        inputSchema: {},
        run: () => "ok"
      });
    `);

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    expect(registry.has("math-tool")).toBe(true);
    expect(registry.has("github-tool")).toBe(true);
    expect(registry.list().length).toBe(2);

    // Run the tool to verify helper imports are resolved at runtime
    const tool = registry.require("math-tool");
    const result = await tool.definition.run({}, {} as any);
    expect(result).toBe("Result: 5");
  });

  it("should support relative .js helper imports in .js tool files (WORKSTREAM-001)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);

    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");
    
    // JS helper
    await mkdir(join(toolsDir, "utils"), { recursive: true });
    await writeFile(join(toolsDir, "utils", "helper.js"), `
      export function getSecret() { return 42; }
    `);

    // JS tool importing JS helper
    await writeFile(join(toolsDir, "js-tool.js"), `
      import { defineTool } from "${srcToolsPath}";
      import { getSecret } from "./utils/helper.js";
      export default defineTool({
        id: "js-tool",
        description: "js tool",
        inputSchema: {},
        run: () => getSecret()
      });
    `);

    const registry = await loadToolRegistry({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    });

    expect(registry.has("js-tool")).toBe(true);
    const tool = registry.require("js-tool");
    const result = await tool.definition.run({}, {} as any);
    expect(result).toBe(42);
  });

  it("should fail to load if a top-level supported file is not a valid tool (ISSUE-003)", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    
    await writeFile(join(toolsDir, "not-a-tool.ts"), "export const x = 1;");
    
    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toMatch(/must default export defineTool/);
  });



  it("precollected discovery policy blocks excluded helper imports with compiled glob semantics", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    await mkdir(join(toolsDir, "helpers"), { recursive: true });
    const markerFile = join(tempBaseDir, "excluded-helper.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "safe.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import "./helpers/excluded.js";
      export default defineTool({ id: "safe-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    await writeFile(join(toolsDir, "helpers", "excluded.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      export default defineTool({ id: "excluded-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    const compiledDiscovery = compileResourceDiscovery({
      cwd: tempBaseDir,
      discovery: {
        resource: "tools",
        include: [],
        exclude: ["tools/helpers/*.{ts,js}"],
        source: "new",
        includeSource: "new",
        excludeSource: "new",
        compatibilityMode: "new-suffix-specific",
        sourcePaths: ["tools.exclude"],
        rawInclude: [],
        rawExclude: ["tools/helpers/*.{ts,js}"],
        diagnostics: [],
      },
    });

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      maxDefinitions: 10,
      precollected: {
        candidateFiles: [{
          relativePath: "tools/safe.tool.ts",
          absolutePath: join(toolsDir, "safe.tool.ts"),
          resourceType: "tool"
        }],
        discoveryPolicy: { exclude: compiledDiscovery.discovery.exclude }
      }
    }, "SECURITY_POLICY_VIOLATION");

    expect(err.message).toMatch(/excluded by policy/);
    const { existsSync } = await import("node:fs");
    expect(existsSync(markerFile)).toBe(false);
  });

  it("precollected discovery policy blocks excluded helper imports using brace-expanded exclude pattern from compileResourceDiscovery", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    await mkdir(join(toolsDir, "private"), { recursive: true });
    const markerFile = join(tempBaseDir, "brace-excluded-helper.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "included.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import "./private/secret.js";
      export default defineTool({ id: "included-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    await writeFile(join(toolsDir, "private", "secret.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "run");
      export default defineTool({ id: "secret-tool", description: "d", inputSchema: {}, run: () => {} });
    `);

    const compiledDiscovery = compileResourceDiscovery({
      cwd: tempBaseDir,
      discovery: {
        resource: "tools",
        include: [],
        exclude: ["tools/private/{secret,blocked}.ts"],
        source: "new",
        includeSource: "new",
        excludeSource: "new",
        compatibilityMode: "new-suffix-specific",
        sourcePaths: ["tools.exclude"],
        rawInclude: [],
        rawExclude: ["tools/private/{secret,blocked}.ts"],
        diagnostics: [],
      },
    });

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      maxDefinitions: 10,
      precollected: {
        candidateFiles: [{
          relativePath: "tools/included.tool.ts",
          absolutePath: join(toolsDir, "included.tool.ts"),
          resourceType: "tool"
        }],
        discoveryPolicy: { exclude: compiledDiscovery.discovery.exclude }
      }
    }, "SECURITY_POLICY_VIOLATION");

    expect(err.message).toMatch(/excluded by policy/);

    const { existsSync } = await import("node:fs");
    expect(existsSync(markerFile)).toBe(false);
  });

  it("static contract failure happens before import", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const markerPath = join(tempBaseDir, "test1.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "unsafe.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerPath)}, "imported");
      export default defineTool({
        id: "../unsafe",
        description: "invalid before import",
        inputSchema: { type: "object" },
        run: () => "never"
      });
    `);

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toMatch(/static validation|Tool id|safe|not path-like/i);
    expect(err.message).toContain("tools/unsafe.tool.ts");
    expect(err.message).toContain("TOOL_DEFINITION_INVALID");
    
    const { existsSync } = await import("node:fs");
    expect(existsSync(markerPath)).toBe(false);
  });

  it("imported metadata or schema rejected before import", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const markerPath = join(tempBaseDir, "test2.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "schema.js"), `
      export const inputSchema = { type: "object" };
    `);

    await writeFile(join(toolsDir, "imported-schema-tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import { inputSchema } from "./schema.js";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerPath)}, "imported");
      export default defineTool({
        id: "imported-schema-tool",
        description: "invalid imported schema",
        inputSchema,
        run: () => "never"
      });
    `);

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toContain("inputSchema");
    expect(err.message).toContain("tools/imported-schema-tool.ts");
    
    const { existsSync } = await import("node:fs");
    expect(existsSync(markerPath)).toBe(false);
  });

  it("invalid JSON schema rejected before import", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const markerPath = join(tempBaseDir, "test3.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "bad-schema.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerPath)}, "imported");
      export default defineTool({
        id: "bad-schema-tool",
        description: "bad schema",
        inputSchema: { type: "definitely-not-json-schema-type" },
        run: () => "never"
      });
    `);

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toContain("inputSchema");
    expect(err.message).toContain("tools/bad-schema.tool.ts");
    expect(err.message).toContain("TOOL_DEFINITION_INVALID");

    const { existsSync } = await import("node:fs");
    expect(existsSync(markerPath)).toBe(false);
  });

  it("multiple invalid candidates are aggregated", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const m1 = join(tempBaseDir, "m1.marker");
    const m2 = join(tempBaseDir, "m2.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "unsafe.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(m1)}, "imported");
      export default defineTool({
        id: "../unsafe",
        description: "unsafe ID",
        inputSchema: {},
        run: () => {}
      });
    `);

    await writeFile(join(toolsDir, "bad-schema.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(m2)}, "imported");
      export default defineTool({
        id: "bad-schema",
        description: "bad schema",
        inputSchema: { type: "definitely-not-json-schema-type" },
        run: () => {}
      });
    `);

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toContain("tools/unsafe.tool.ts");
    expect(err.message).toContain("tools/bad-schema.tool.ts");
    expect(err.message).toContain("TOOL_DEFINITION_INVALID");

    const { existsSync } = await import("node:fs");
    expect(existsSync(m1)).toBe(false);
    expect(existsSync(m2)).toBe(false);
  });

  it("invalid duplicate candidates fail validation, not duplicate detection", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const m1 = join(tempBaseDir, "m1.marker");
    const m2 = join(tempBaseDir, "m2.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "t1.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(m1)}, "imported");
      export default defineTool({
        id: "../dup",
        description: "unsafe duplicate",
        inputSchema: {},
        run: () => {}
      });
    `);

    await writeFile(join(toolsDir, "t2.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(m2)}, "imported");
      export default defineTool({
        id: "../dup",
        description: "unsafe duplicate 2",
        inputSchema: {},
        run: () => {}
      });
    `);

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      dir: "tools",
      maxDefinitions: 10
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toContain("tools/t1.tool.ts");
    expect(err.message).toContain("tools/t2.tool.ts");
    expect(err.message).not.toContain("Duplicate tool ID");

    const { existsSync } = await import("node:fs");
    expect(existsSync(m1)).toBe(false);
    expect(existsSync(m2)).toBe(false);
  });

  it("precollected candidates use the same static gate", async () => {
    const toolsDir = join(tempBaseDir, "tools");
    await mkdir(toolsDir);
    const markerFile = join(tempBaseDir, "bad-precollected.marker");
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    await writeFile(join(toolsDir, "bad.tool.ts"), `
      import { defineTool } from "${srcToolsPath}";
      import * as fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(markerFile)}, "imported");
      export default defineTool({
        id: "../unsafe",
        description: "bad precollected",
        inputSchema: {},
        run: () => {}
      });
    `);

    const err = await expectLoadFailure({
      cwd: tempBaseDir,
      maxDefinitions: 10,
      precollected: {
        candidateFiles: [{
          relativePath: "tools/bad.tool.ts",
          absolutePath: join(toolsDir, "bad.tool.ts"),
          realPath: join(toolsDir, "bad.tool.ts"),
          resourceType: "tool",
          sourcePattern: "tools/*.tool.ts",
          sourceConfigPath: "tools.include",
          source: "new"
        }],
        discoveryPolicy: { exclude: [] }
      }
    }, "TOOL_INVALID_DEFINITION");

    expect(err.message).toContain("tools/bad.tool.ts");
    const { existsSync } = await import("node:fs");
    expect(existsSync(markerFile)).toBe(false);
  });

  describe("post-import contract drift validation", () => {
    const srcToolsPath = resolve(process.cwd(), "src/tools/index.ts");

    async function testDrift(fileName: string, fileContent: string, fieldName: string) {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir, { recursive: true });

      const filePath = join(toolsDir, fileName);
      await writeFile(filePath, fileContent);

      const err = await expectLoadFailure({
        cwd: tempBaseDir,
        dir: "tools",
        maxDefinitions: 10
      }, "TOOL_INVALID_DEFINITION");

      expect(err.message).toContain(`tools/${fileName}`);
      expect(err.message).toContain(fieldName);
      expect(err.message).toContain("changed after static validation");
    }

    it("should fail on post-import runtime id drift", async () => {
      await testDrift(
        "id-drift.tool.ts",
        `
          import { defineTool } from "${srcToolsPath}";
          const config = { id: "static-id" };
          config.id = "drifted-id";
          export default defineTool({
            id: config.id,
            description: "desc",
            inputSchema: {},
            run: () => {}
          });
        `,
        "id"
      );
    });

    it("should fail on post-import runtime description drift", async () => {
      await testDrift(
        "desc-drift.tool.ts",
        `
          import { defineTool } from "${srcToolsPath}";
          const config = { description: "static-desc" };
          config.description = "drifted-desc";
          export default defineTool({
            id: "desc-drift",
            description: config.description,
            inputSchema: {},
            run: () => {}
          });
        `,
        "description"
      );
    });

    it("should fail on post-import runtime inputSchema drift", async () => {
      await testDrift(
        "input-schema-drift.tool.ts",
        `
          import { defineTool } from "${srcToolsPath}";
          const inputSchema = {
            type: "object",
            properties: {
              value: { type: "string" }
            }
          };
          inputSchema.properties.value.type = "number";
          export default defineTool({
            id: "input-schema-drift",
            description: "desc",
            inputSchema: inputSchema,
            run: () => {}
          });
        `,
        "inputSchema"
      );
    });

    it("should fail on post-import runtime outputSchema drift", async () => {
      await testDrift(
        "output-schema-drift.tool.ts",
        `
          import { defineTool } from "${srcToolsPath}";
          const outputSchema = {
            type: "object",
            properties: {
              value: { type: "string" }
            }
          };
          outputSchema.properties.value.type = "number";
          export default defineTool({
            id: "output-schema-drift",
            description: "desc",
            inputSchema: {},
            outputSchema: outputSchema,
            run: () => {}
          });
        `,
        "outputSchema"
      );
    });

    it("should fail on post-import runtime defaultTimeoutMs drift", async () => {
      await testDrift(
        "timeout-drift.tool.ts",
        `
          import { defineTool } from "${srcToolsPath}";
          const config = { timeout: 1000 };
          config.timeout = 2000;
          export default defineTool({
            id: "timeout-drift",
            description: "desc",
            inputSchema: {},
            defaultTimeoutMs: config.timeout,
            run: () => {}
          });
        `,
        "defaultTimeoutMs"
      );
    });

    it("should fail on post-import runtime metadata drift", async () => {
      await testDrift(
        "metadata-drift.tool.ts",
        `
          import { defineTool } from "${srcToolsPath}";
          const metadata = { foo: "bar" };
          metadata.foo = "baz";
          export default defineTool({
            id: "metadata-drift",
            description: "desc",
            inputSchema: {},
            metadata: metadata,
            run: () => {}
          });
        `,
        "metadata"
      );
    });

    it("should fail on post-import optional field presence drift", async () => {
      await testDrift(
        "presence-drift.tool.ts",
        `
          import { defineTool } from "${srcToolsPath}";
          const originalFreeze = Object.freeze;
          Object.freeze = (obj: any) => {
            Object.freeze = originalFreeze;
            delete obj.metadata;
            return originalFreeze(obj);
          };
          export default defineTool({
            id: "presence-drift",
            description: "desc",
            inputSchema: {},
            metadata: {},
            run: () => {}
          });
        `,
        "metadata"
      );
    });

    it("should load when valid nested schema and metadata are used", async () => {
      const toolsDir = join(tempBaseDir, "tools");
      await mkdir(toolsDir, { recursive: true });

      const fileContent = `
        import { defineTool } from "${srcToolsPath}";
        const inputSchema = {
          type: "object",
          properties: {
            obj: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" }
              }
            }
          }
        };
        // Reorder keys at runtime
        inputSchema.properties.obj.properties = {
          b: { type: "number" },
          a: { type: "number" }
        };
        export default defineTool({
          id: "nested-tool",
          description: "nested tool",
          inputSchema: inputSchema,
          metadata: {
            nestedMeta: {
              y: [1, 2, 3],
              x: "bar"
            }
          },
          run: () => {}
        });
      `;

      await writeFile(join(toolsDir, "nested-tool.tool.ts"), fileContent);

      const registry = await loadToolRegistry({
        cwd: tempBaseDir,
        dir: "tools",
        maxDefinitions: 10
      });

      expect(registry.has("nested-tool")).toBe(true);
      const definition = registry.require("nested-tool").definition;
      expect(definition.id).toBe("nested-tool");
    });
  });

  describe("global runtime compatibility and concurrency", () => {
    let originalDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
      // @ts-ignore
      delete globalThis.__evalOrder;
    });

    afterEach(() => {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "defineTool", originalDescriptor);
      } else {
        // @ts-ignore
        delete globalThis.defineTool;
      }
      // @ts-ignore
      delete globalThis.__evalOrder;
    });

    it("no-import JavaScript loads through loadToolRegistry from a disposable workspace with no package.json, node_modules, or ODW install", async () => {
      const workspaceDir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-js-"));
      try {
        const toolsDir = join(workspaceDir, "tools");
        await mkdir(toolsDir, { recursive: true });

        await writeFile(
          join(toolsDir, "tool.js"),
          `export default defineTool({
            id: "no-import-js",
            description: "desc",
            inputSchema: {},
            run: () => "ran-js"
          });`
        );

        const registry = await loadToolRegistry({
          cwd: workspaceDir,
          dir: "tools",
          maxDefinitions: 10
        });

        expect(registry.has("no-import-js")).toBe(true);
        const registered = registry.require("no-import-js");
        expect(registered.definition.id).toBe("no-import-js");
        const result = await registered.definition.run({}, {} as any);
        expect(result).toBe("ran-js");
      } finally {
        await rm(workspaceDir, { recursive: true, force: true });
      }
    });

    it("no-import TypeScript loads through the existing transpilation path", async () => {
      const workspaceDir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-ts-"));
      try {
        const toolsDir = join(workspaceDir, "tools");
        await mkdir(toolsDir, { recursive: true });

        await writeFile(
          join(toolsDir, "tool.ts"),
          `export default defineTool({
            id: "no-import-ts",
            description: "desc",
            inputSchema: {},
            run: () => "ran-ts"
          });`
        );

        const registry = await loadToolRegistry({
          cwd: workspaceDir,
          dir: "tools",
          maxDefinitions: 10
        });

        expect(registry.has("no-import-ts")).toBe(true);
        const registered = registry.require("no-import-ts");
        expect(registered.definition.id).toBe("no-import-ts");
        const result = await registered.definition.run({}, {} as any);
        expect(result).toBe("ran-ts");
      } finally {
        await rm(workspaceDir, { recursive: true, force: true });
      }
    });

    it("a legacy package import loads in the same zero-install conditions", async () => {
      const workspaceDir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-legacy-"));
      try {
        const toolsDir = join(workspaceDir, "tools");
        await mkdir(toolsDir, { recursive: true });

        await writeFile(
          join(toolsDir, "legacy.ts"),
          `import { defineTool } from "@travisliu/open-dynamic-workflow";
          export default defineTool({
            id: "legacy-imported",
            description: "desc",
            inputSchema: {},
            run: () => "ran-legacy"
          });`
        );

        const registry = await loadToolRegistry({
          cwd: workspaceDir,
          dir: "tools",
          maxDefinitions: 10
        });

        expect(registry.has("legacy-imported")).toBe(true);
        const registered = registry.require("legacy-imported");
        expect(registered.definition.id).toBe("legacy-imported");
        const result = await registered.definition.run({}, {} as any);
        expect(result).toBe("ran-legacy");
      } finally {
        await rm(workspaceDir, { recursive: true, force: true });
      }
    });

    it("foreign data and accessor globals reject before candidate evaluation, preserve the complete descriptor, and leave an evaluation marker absent", async () => {
      const workspaceDir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-foreign-"));
      try {
        const toolsDir = join(workspaceDir, "tools");
        await mkdir(toolsDir, { recursive: true });

        const markerFile = join(workspaceDir, "eval.marker");
        await writeFile(
          join(toolsDir, "tool.js"),
          `import * as fs from "node:fs";
          fs.writeFileSync(${JSON.stringify(markerFile)}, "evaluated");
          export default defineTool({
            id: "foreign-test",
            description: "desc",
            inputSchema: {},
            run: () => {}
          });`
        );

        const foreignVal = () => "foreign";
        Object.defineProperty(globalThis, "defineTool", {
          get: () => foreignVal,
          configurable: true,
          enumerable: true
        });

        await expect(loadToolRegistry({
          cwd: workspaceDir,
          dir: "tools",
          maxDefinitions: 10
        })).rejects.toThrowError(/Cannot install the active tool runtime/);

        // Verify evaluation marker is absent
        const markerExists = await stat(markerFile).then(() => true).catch(() => false);
        expect(markerExists).toBe(false);

        // Verify descriptor is preserved
        const desc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
        expect(desc).toBeDefined();
        expect(desc?.get).toBeDefined();
        expect(desc?.get?.()).toBe(foreignVal);
      } finally {
        await rm(workspaceDir, { recursive: true, force: true });
      }
    });

    it("cleanup removes the unique temp root (including shim and mirrors) after success and import failure", async () => {
      const workspaceDir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-cleanup-"));
      try {
        const toolsDir = join(workspaceDir, "tools");
        await mkdir(toolsDir, { recursive: true });

        // Success case
        await writeFile(
          join(toolsDir, "good.js"),
          `export default defineTool({ id: "good", description: "desc", inputSchema: {}, run: () => {} });`
        );

        await loadToolRegistry({
          cwd: workspaceDir,
          dir: "tools",
          maxDefinitions: 10
        });

        // Verify temp files inside .open-dynamic-workflow are cleaned up
        const odwDir = join(workspaceDir, ".open-dynamic-workflow");
        const odwExists = await stat(odwDir).then(() => true).catch(() => false);
        expect(odwExists).toBe(false);

        // Failure case
        await writeFile(
          join(toolsDir, "bad.js"),
          `export default defineTool({ id: "bad"` // syntax error
        );

        await expect(loadToolRegistry({
          cwd: workspaceDir,
          dir: "tools",
          maxDefinitions: 10
        })).rejects.toThrow();

        // Verify temp files are still cleaned up
        const odwExistsFailure = await stat(odwDir).then(() => true).catch(() => false);
        expect(odwExistsFailure).toBe(false);
      } finally {
        await rm(workspaceDir, { recursive: true, force: true });
      }
    });

    it("two concurrent calls using separate disposable workspaces both succeed, their observable import sessions do not interleave, and the original global descriptor is restored afterward", async () => {
      function createDeferred<T = void>() {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: any) => void;
        const promise = new Promise<T>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      }

      const wsA = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-concurrent-a-"));
      const wsB = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-load-test-concurrent-b-"));
      
      const concurrentEvents: string[] = [];
      const startedA1 = createDeferred<void>();
      const gateA1 = createDeferred<void>();

      (globalThis as any).__concurrentEvents = concurrentEvents;
      (globalThis as any).__startedA1 = startedA1;
      (globalThis as any).__gateA1 = gateA1.promise;

      try {
        const toolsA = join(wsA, "tools");
        const toolsB = join(wsB, "tools");
        await mkdir(toolsA, { recursive: true });
        await mkdir(toolsB, { recursive: true });

        // Workspace A tools
        await writeFile(
          join(toolsA, "toolA1.js"),
          `globalThis.__concurrentEvents.push("start-A1");
          globalThis.__startedA1.resolve();
          await globalThis.__gateA1;
          globalThis.__concurrentEvents.push("end-A1");
          export default defineTool({ id: "toolA1", description: "desc", inputSchema: {}, run: () => {} });`
        );
        await writeFile(
          join(toolsA, "toolA2.js"),
          `globalThis.__concurrentEvents.push("eval-A2");
          export default defineTool({ id: "toolA2", description: "desc", inputSchema: {}, run: () => {} });`
        );

        // Workspace B tools
        await writeFile(
          join(toolsB, "toolB1.js"),
          `globalThis.__concurrentEvents.push("eval-B1");
          export default defineTool({ id: "toolB1", description: "desc", inputSchema: {}, run: () => {} });`
        );

        // Start A first
        const promiseA = loadToolRegistry({ cwd: wsA, dir: "tools", maxDefinitions: 10 });

        // Wait until Workspace A's first module starts and is held
        await startedA1.promise;

        // Start B (it should be blocked by A's lock)
        const promiseB = loadToolRegistry({ cwd: wsB, dir: "tools", maxDefinitions: 10 });

        // Yield to microtasks
        await Promise.resolve();

        // At this point, Workspace B should not have started evaluation of B1 because A holds the exclusive lock
        expect(concurrentEvents).toEqual(["start-A1"]);
        expect(concurrentEvents).not.toContain("eval-B1");

        // Now release Workspace A's gate
        gateA1.resolve();

        // Wait for both loads to complete
        const [regA, regB] = await Promise.all([promiseA, promiseB]);

        expect(regA.has("toolA1")).toBe(true);
        expect(regA.has("toolA2")).toBe(true);
        expect(regB.has("toolB1")).toBe(true);

        // Verify ordering: A1 start, A1 end, A2, and finally B1
        expect(concurrentEvents.indexOf("start-A1")).toBe(0);
        expect(concurrentEvents.indexOf("end-A1")).toBe(1);
        expect(concurrentEvents.indexOf("eval-A2")).toBe(2);
        expect(concurrentEvents.indexOf("eval-B1")).toBe(3);

        // Global cleanup
        expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
      } finally {
        delete (globalThis as any).__concurrentEvents;
        delete (globalThis as any).__startedA1;
        delete (globalThis as any).__gateA1;

        await rm(wsA, { recursive: true, force: true });
        await rm(wsB, { recursive: true, force: true });
      }
    });
  });
});
