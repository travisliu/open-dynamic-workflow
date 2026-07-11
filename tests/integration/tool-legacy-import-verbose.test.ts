import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { main } from "../../src/cli/index.js";

let tempDir: string = "";

async function runCli(args: string[]) {
  const stdoutData: string[] = [];
  const stderrData: string[] = [];

  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdoutData.push(chunk.toString());
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrData.push(chunk.toString());
    return true;
  });

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    error = err;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Legacy ODW import verbose diagnostic integration", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "odw-legacy-import-verbose-"));

    // Set up a standard project layout
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow/tools"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "tools"), { recursive: true });

    // config.yaml
    await fs.writeFile(
      path.join(tempDir, ".open-dynamic-workflow/config.yaml"),
      `defaultProvider: mock
reporting:
  verbose: false
tools:
  include:
    - "tools/**/*.js"
`
    );

    // workflow.js
    await fs.writeFile(
      path.join(tempDir, "workflow.js"),
      `export const meta = {
        name: "test-workflow",
        description: "Test workflow",
        phases: []
      };
      export default async () => "success";
      `
    );

    // tools/no-import.tool.js
    await fs.writeFile(
      path.join(tempDir, "tools/no-import.tool.js"),
      `export default defineTool({
        id: "no-import-tool",
        description: "no import description",
        inputSchema: {},
        run: () => "no-import-result"
      });
      `
    );

    // tools/legacy.tool.js
    await fs.writeFile(
      path.join(tempDir, "tools/legacy.tool.js"),
      `import { defineTool } from "@travisliu/open-dynamic-workflow";
      export default defineTool({
        id: "legacy-tool",
        description: "legacy description",
        inputSchema: {},
        run: () => "legacy-result"
      });
      `
    );
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("non-verbose legacy load succeeds with no compatibility message on stderr", async () => {
    const result = await runCli([
      "validate",
      path.join(tempDir, "workflow.js"),
      "--config",
      path.join(tempDir, ".open-dynamic-workflow/config.yaml"),
      "--cwd",
      tempDir
    ]);

    expect(result.error).toBeNull();
    expect(result.stderr).not.toContain("Legacy ODW defineTool import detected");
  });

  it("verbose legacy load succeeds and emits one relative-path informational line to stderr", async () => {
    const result = await runCli([
      "validate",
      path.join(tempDir, "workflow.js"),
      "--config",
      path.join(tempDir, ".open-dynamic-workflow/config.yaml"),
      "--cwd",
      tempDir,
      "--verbose"
    ]);

    expect(result.error).toBeNull();
    expect(result.stderr).toContain(
      "Legacy ODW defineTool import detected in tools/legacy.tool.js; it remains supported, but new tools should use global defineTool without an import."
    );
    // no-import tool path should NOT be mentioned in the warning/diagnostic
    expect(result.stderr).not.toContain("tools/no-import.tool.js");
  });

  it("JSON run output remains one parseable document and legacy warning goes to stderr", async () => {
    const result = await runCli([
      "run",
      path.join(tempDir, "workflow.js"),
      "--config",
      path.join(tempDir, ".open-dynamic-workflow/config.yaml"),
      "--cwd",
      tempDir,
      "--out",
      path.join(tempDir, "out"),
      "--report",
      "json",
      "--verbose"
    ]);

    expect(result.error).toBeNull();

    // Verify warning went to stderr, not stdout
    expect(result.stderr).toContain("Legacy ODW defineTool import detected in tools/legacy.tool.js");
    expect(result.stdout).not.toContain("Legacy ODW defineTool import detected");

    // stdout must be valid JSON
    let parsed: any;
    expect(() => {
      parsed = JSON.parse(result.stdout.trim());
    }).not.toThrow();
    expect(parsed.schemaVersion).toBe("open-dynamic-workflow.report.v1");
    expect(parsed.status).toBe("succeeded");
  });

  it("JSONL run output remains independently parseable and warning goes to stderr", async () => {
    const result = await runCli([
      "run",
      path.join(tempDir, "workflow.js"),
      "--config",
      path.join(tempDir, ".open-dynamic-workflow/config.yaml"),
      "--cwd",
      tempDir,
      "--out",
      path.join(tempDir, "out"),
      "--report",
      "jsonl",
      "--verbose"
    ]);

    expect(result.error).toBeNull();

    // Verify warning went to stderr, not stdout
    expect(result.stderr).toContain("Legacy ODW defineTool import detected in tools/legacy.tool.js");
    expect(result.stdout).not.toContain("Legacy ODW defineTool import detected");

    // Each line of stdout must be valid JSON
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      if (line.trim() === "") continue;
      expect(() => {
        JSON.parse(line);
      }).not.toThrow();
    }
  });

  it("legacy warning never changes the success status/exit behavior", async () => {
    const result = await runCli([
      "run",
      path.join(tempDir, "workflow.js"),
      "--config",
      path.join(tempDir, ".open-dynamic-workflow/config.yaml"),
      "--cwd",
      tempDir,
      "--out",
      path.join(tempDir, "out"),
      "--verbose"
    ]);

    expect(result.error).toBeNull();
    expect(result.stderr).toContain("Legacy ODW defineTool import detected in tools/legacy.tool.js");
  });

  it("does not trigger legacy diagnostics for comments, dynamic imports, re-exports, require, or unrelated packages", async () => {
    // 1. comment/string case
    await fs.writeFile(
      path.join(tempDir, "tools/comment-string.tool.js"),
      `// import { defineTool } from "@travisliu/open-dynamic-workflow";
       /* import { defineTool } from "@travisliu/open-dynamic-workflow"; */
       const dummy = 'import { defineTool } from "@travisliu/open-dynamic-workflow"';
       export default defineTool({
         id: "comment-string-tool",
         description: "comment-string description",
         inputSchema: {},
         run: () => "success"
       });`
    );

    // 2. dynamic import() case
    await fs.writeFile(
      path.join(tempDir, "tools/dynamic-import.tool.js"),
      `export default defineTool({
         id: "dynamic-import-tool",
         description: "dynamic import description",
         inputSchema: {},
         run: async () => {
           const someModule = await import("@travisliu/open-dynamic-workflow");
           return "success";
         }
       });`
    );

    // 3. re-export (export ... from) case
    await fs.writeFile(
      path.join(tempDir, "tools/re-export.tool.js"),
      `export { defineTool } from "@travisliu/open-dynamic-workflow";
       export default defineTool({
         id: "re-export-tool",
         description: "re-export description",
         inputSchema: {},
         run: () => "success"
       });`
    );

    // 4. require() case
    await fs.writeFile(
      path.join(tempDir, "tools/require.tool.js"),
      `const require = () => ({ defineTool: (x) => x });
       const { defineTool: localDefine } = require("@travisliu/open-dynamic-workflow");
       export default defineTool({
         id: "require-tool",
         description: "require description",
         inputSchema: {},
         run: () => "success"
       });`
    );

    // 5. import from another package
    await fs.writeFile(
      path.join(tempDir, "tools/other-package.tool.js"),
      `import fs from "node:fs";
       export default defineTool({
         id: "other-package-tool",
         description: "other package description",
         inputSchema: {},
         run: () => "success"
       });`
    );

    const result = await runCli([
      "validate",
      path.join(tempDir, "workflow.js"),
      "--config",
      path.join(tempDir, ".open-dynamic-workflow/config.yaml"),
      "--cwd",
      tempDir,
      "--verbose"
    ]);

    expect(result.error).toBeNull();
    
    // Assert that the canonical import in tools/legacy.tool.js is detected
    expect(result.stderr).toContain("Legacy ODW defineTool import detected in tools/legacy.tool.js");
    
    // Assert none of the false-positive/non-trigger forms emitted a diagnostic
    expect(result.stderr).not.toContain("comment-string.tool.js");
    expect(result.stderr).not.toContain("dynamic-import.tool.js");
    expect(result.stderr).not.toContain("re-export.tool.js");
    expect(result.stderr).not.toContain("require.tool.js");
    expect(result.stderr).not.toContain("other-package.tool.js");

    // Assert that it emits exactly one safe relative-path message (for legacy.tool.js)
    const warnings = result.stderr
      .split("\n")
      .filter((line) => line.includes("Legacy ODW defineTool import detected"));
    expect(warnings.length).toBe(1);
  });
});
