import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink, realpath } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { loadSharedAgentRegistry } from "../../../src/shared-agents/load.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenFlowError } from "../../../src/errors/types.js";

describe("loadSharedAgentRegistry", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Ensure tempDir itself is a realpath to avoid issues with symlinked temp dirs
    const baseTemp = await mkdtemp(join(tmpdir(), "openflow-test-"));
    tempDir = await realpath(baseTemp);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty registry for empty paths", async () => {
    const registry = await loadSharedAgentRegistry({
      cwd: tempDir,
      dir: ""
    });
    expect(registry.list()).toHaveLength(0);
  });

  it("ignores subdirectories and only loads direct children", async () => {
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });
    
    // Direct child
    await writeFile(join(agentsDir, "direct.js"), `
      export default defineAgent({ id: "direct", description: "d", run: async () => ({ ok: true }) });
    `);
    
    // Nested child
    const nestedDir = join(agentsDir, "nested");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, "nested.js"), `
      export default defineAgent({ id: "nested", description: "d", run: async () => ({ ok: true }) });
    `);

    const registry = await loadSharedAgentRegistry({ cwd: tempDir, dir: "agents" });
    
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("direct")).toBeDefined();
    expect(registry.get("nested")).toBeUndefined();
  });

  it("sorts direct files deterministically", async () => {
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });
    
    await writeFile(join(agentsDir, "z.js"), `export default defineAgent({ id: "z", run: async () => ({ ok: true }) });`);
    await writeFile(join(agentsDir, "a.js"), `export default defineAgent({ id: "a", run: async () => ({ ok: true }) });`);
    await writeFile(join(agentsDir, "c.js"), `export default defineAgent({ id: "c", run: async () => ({ ok: true }) });`);

    const registry = await loadSharedAgentRegistry({ cwd: tempDir, dir: "agents" });
    const list = registry.list();
    
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe("a");
    expect(list[1].id).toBe("c");
    expect(list[2].id).toBe("z");
  });

  it("loads a valid JS agent using defineAgent", async () => {
    const agentsDir = join(tempDir, ".openflow", "agents");
    await mkdir(agentsDir, { recursive: true });
    const agentFile = join(agentsDir, "test.agent.js");
    await writeFile(agentFile, `
      export default defineAgent({
        id: "js-agent",
        description: "JS Agent",
        run: async () => ({ ok: true })
      });
    `);

    const registry = await loadSharedAgentRegistry({
      cwd: tempDir,
      dir: ".openflow/agents"
    });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("js-agent")).toBeDefined();
  });

  it("loads a valid JS agent with an ES import statement", async () => {
    const agentsDir = join(tempDir, ".openflow", "agents");
    await mkdir(agentsDir, { recursive: true });
    const agentFile = join(agentsDir, "import-test.agent.js");
    await writeFile(agentFile, `
      import { defineAgent } from "@prmflow/openflow";
      export default defineAgent({
        id: "import-js-agent",
        description: "Import JS Agent",
        run: async () => ({ ok: true })
      });
    `);

    const registry = await loadSharedAgentRegistry({
      cwd: tempDir,
      dir: ".openflow/agents"
    });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("import-js-agent")).toBeDefined();
  });
  
  it("supports .mjs and .cjs extensions", async () => {
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "test.mjs"), `
      export default defineAgent({ id: "mjs-agent", run: async () => ({ ok: true }) });
    `);
    await writeFile(join(agentsDir, "test.cjs"), `
      module.exports = { default: defineAgent({ id: "cjs-agent", run: async () => ({ ok: true }) }) };
    `);

    const registry = await loadSharedAgentRegistry({ cwd: tempDir, dir: "agents" });
    expect(registry.list()).toHaveLength(2);
    expect(registry.get("mjs-agent")).toBeDefined();
    expect(registry.get("cjs-agent")).toBeDefined();
  });

  it("ignores yaml files and unsupported extensions", async () => {
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "test.yaml"), "id: test\nrun: true");
    await writeFile(join(agentsDir, "test.txt"), "id: test\nrun: true");

    const registry = await loadSharedAgentRegistry({ cwd: tempDir, dir: "agents" });
    expect(registry.list()).toHaveLength(0);
  });

  it("rejects duplicate IDs across files", async () => {
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "a1.js"), "export default defineAgent({ id: 'dup', run: async () => ({ ok: true }) });");
    await writeFile(join(agentsDir, "a2.js"), "export default defineAgent({ id: 'dup', run: async () => ({ ok: true }) });");

    await expect(loadSharedAgentRegistry({
      cwd: tempDir,
      dir: "agents"
    })).rejects.toThrow(OpenFlowError);
  });

  it("allows paths outside cwd", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "openflow-outside-"));
    const realOutsideDir = await realpath(outsideDir);
    await writeFile(join(realOutsideDir, "outside.js"), `
      export default defineAgent({ id: "outside", run: async () => ({ ok: true }) });
    `);
    const registry = await loadSharedAgentRegistry({
      cwd: tempDir,
      dir: realOutsideDir
    });
    expect(registry.get("outside")).toBeDefined();
    await rm(realOutsideDir, { recursive: true, force: true });
  });

  it("rejects restricted JS source", async () => {
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "bad.agent.js"), "const fs = require('fs');");

    await expect(loadSharedAgentRegistry({
      cwd: tempDir,
      dir: "agents"
    })).rejects.toThrow(OpenFlowError);
  });

  it("allows restricted keywords in prompts, descriptions, and comments but rejects actual API usage", async () => {
    const forbidden = [
      "fs",
      "child_process",
      "path",
      "os",
      "process",
      "require",
      "global",
      "globalThis"
    ];

    for (const word of forbidden) {
      const agentsDir = join(tempDir, "agents-" + word.replace(/:/g, "-"));
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        join(agentsDir, "ok.agent.js"),
        `
        // Comment mentioning ${word}
        export default defineAgent({
          id: "agent-${word.toLowerCase().replace(/:/g, "-")}",
          description: "Use ${word} in description",
          agentPrompt: "Test: ${word}",
          run: async () => ({ ok: true })
        });
        `
      );

      const registry = await loadSharedAgentRegistry({
        cwd: tempDir,
        dir: relative(tempDir, agentsDir)
      });
      expect(registry.list()).toHaveLength(1);
    }
  });

  it("proves that shared-agent definitions cannot import Node builtins", async () => {
    const agentsDir = join(tempDir, "agents-builtin");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "bad.agent.js"),
      `import fs from 'node:fs';\nexport default defineAgent({ id: "bad", description: "desc", run: async () => ({ ok: true }) });`
    );
    await expect(loadSharedAgentRegistry({ cwd: tempDir, dir: "agents-builtin" })).rejects.toThrow(OpenFlowError);
  });

  it("proves that shared-agent definitions cannot spawn processes", async () => {
    const agentsDir = join(tempDir, "agents-spawn");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "bad.agent.js"),
      `const { exec } = require('child_process');\nexport default defineAgent({ id: "bad", description: "desc", run: async () => ({ ok: true }) });`
    );
    await expect(loadSharedAgentRegistry({ cwd: tempDir, dir: "agents-spawn" })).rejects.toThrow(OpenFlowError);
  });

  it("proves that shared-agent definitions cannot read environment variables", async () => {
    const agentsDir = join(tempDir, "agents-env");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "bad.agent.js"),
      `const env = process.env;\nexport default defineAgent({ id: "bad", description: "desc", run: async () => ({ ok: true }) });`
    );
    await expect(loadSharedAgentRegistry({ cwd: tempDir, dir: "agents-env" })).rejects.toThrow(OpenFlowError);
  });

  it("proves that shared-agent definitions cannot write files", async () => {
    const agentsDir = join(tempDir, "agents-write");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "bad.agent.js"),
      `fs.writeFileSync('test.txt', 'data');\nexport default defineAgent({ id: "bad", description: "desc", run: async () => ({ ok: true }) });`
    );
    await expect(loadSharedAgentRegistry({ cwd: tempDir, dir: "agents-write" })).rejects.toThrow(OpenFlowError);
  });

  it("fails if discovered files exceed maxDefinitions", async () => {
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "a1.js"), "export default defineAgent({ id: 'a1', run: async () => ({ ok: true }) });");
    await writeFile(join(agentsDir, "a2.js"), "export default defineAgent({ id: 'a2', run: async () => ({ ok: true }) });");

    await expect(loadSharedAgentRegistry({
      cwd: tempDir,
      dir: "agents",
      maxDefinitions: 1
    })).rejects.toThrow(OpenFlowError);
  });

  it("rejects symlinks pointing outside workspace", async () => {
    const agentsDir = join(tempDir, "agents");
    await mkdir(agentsDir, { recursive: true });
    
    const outsideDir = await mkdtemp(join(tmpdir(), "openflow-outside-"));
    const realOutsideDir = await realpath(outsideDir);
    await writeFile(join(realOutsideDir, "outside.js"), "export default defineAgent({ id: 'outside', run: async () => ({ ok: true }) });");
    
    const symlinkPath = join(agentsDir, "outside-link.js");
    await symlink(join(realOutsideDir, "outside.js"), symlinkPath, "file");

    try {
      await loadSharedAgentRegistry({
        cwd: tempDir,
        dir: "agents"
      });
      throw new Error("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION);
      expect(err.message).toContain("points outside the workspace");
    } finally {
      await rm(realOutsideDir, { recursive: true, force: true });
    }
  });

  it("loads a valid TS agent using defineAgent", async () => {
    const agentsDir = join(tempDir, ".openflow", "agents");
    await mkdir(agentsDir, { recursive: true });
    const agentFile = join(agentsDir, "test.agent.ts");
    await writeFile(agentFile, `
      import { defineAgent } from "../../src/shared-agents/define-agent.js";
      export default defineAgent({
        id: "ts-agent",
        description: "TS Agent",
        run: async () => ({ ok: true })
      });
    `);

    const registry = await loadSharedAgentRegistry({
      cwd: tempDir,
      dir: ".openflow/agents"
    });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("ts-agent")).toBeDefined();
    expect(registry.get("ts-agent")?.definition.description).toBe("TS Agent");
  });

  it("fails on infinite loop top-level code instead of hanging", async () => {
    const agentsDir = join(tempDir, "agents-infinite");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "hang.agent.js"),
      `while(true) {}\nexport default defineAgent({ id: "hang", description: "desc", run: async () => ({ ok: true }) });`
    );
    await expect(loadSharedAgentRegistry({ cwd: tempDir, dir: "agents-infinite" })).rejects.toThrow(/timeout|Failed to evaluate/);
  });
});
