import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { ExitCode, exitCodeForError } from "../../src/errors/exit-codes.js";

const VALID_FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures/listing/valid");
const INVALID_FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures/listing/invalid");
const MIXED_FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures/listing/mixed-invalid");
const CUSTOM_FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures/listing/custom-dirs");
const EMPTY_FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures/listing/empty");
const DUPLICATE_FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures/listing/duplicates");
const HINT_TEMP_DIR = path.resolve(process.cwd(), "tests/temp-list-hint-integration");

describe("list-command integration", () => {
  beforeEach(() => {
    process.exitCode = 0;
  });

  it("lists valid resources from a project", async () => {
    let output = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
      output += msg;
      return true;
    });

    await main(["node", "open-dynamic-workflow", "list", "--cwd", VALID_FIXTURES_DIR]);
    
    expect(output).toContain("--- WORKFLOWS ---");
    expect(output).toContain("feature-builder");
    expect(output).toContain("--- AGENTS ---");
    expect(output).toContain("code-reviewer");
    expect(output).toContain("--- TOOLS ---");
    expect(output).toContain("read-config");
    spy.mockRestore();
  });

  it("lists agents in JSON format without leakage or ANSI", async () => {
    let output = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
      output += msg;
      return true;
    });

    await main(["node", "open-dynamic-workflow", "list", "agents", "--cwd", VALID_FIXTURES_DIR, "--report", "json"]);
    
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.resources).toHaveLength(1);
    expect(parsed.resources[0].id).toBe("code-reviewer");
    
    // Check for leakage
    expect(output).not.toContain("agent-side-effect.marker"); // Marker from security tests
    expect(output).not.toContain("agentPrompt");
    expect(output).not.toContain("run: async"); // Raw source text
    
    // Check for ANSI (look for \u001b[)
    expect(output).not.toMatch(/\u001b\[\d+m/);
    
    spy.mockRestore();
  });

  it("lists tools in JSONL format without leakage or ANSI", async () => {
    let output = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
      output += msg;
      return true;
    });

    await main(["node", "open-dynamic-workflow", "list", "tools", "--cwd", VALID_FIXTURES_DIR, "--report", "jsonl"]);
    
    const lines = output.trim().split("\n");
    const resourceRecord = JSON.parse(lines.find(l => JSON.parse(l).type === "list.resource")!);
    
    expect(resourceRecord.resource.id).toBe("read-config");
    
    // Check for leakage and ANSI in JSONL
    expect(output).not.toContain("run: async");
    expect(output).not.toMatch(/\u001b\[\d+m/);
    
    spy.mockRestore();
  });

  it("rejects singular resource type 'workflow'", async () => {
    // commander will throw an error that main catches and sets exit code
    try {
      await main(["node", "open-dynamic-workflow", "list", "workflow", "--cwd", VALID_FIXTURES_DIR]);
    } catch (err) {
      process.exitCode = exitCodeForError(err);
    }
    expect(process.exitCode).toBe(ExitCode.CLI_USAGE_ERROR);
  });

  it("reports warnings for invalid resources in lenient mode", async () => {
    await main(["node", "open-dynamic-workflow", "list", "--cwd", INVALID_FIXTURES_DIR]);
    expect(process.exitCode).toBe(ExitCode.Success);
  });

  it("fails in strict mode for invalid resources", async () => {
    await main(["node", "open-dynamic-workflow", "list", "--cwd", INVALID_FIXTURES_DIR, "--strict"]);
    expect(process.exitCode).toBe(ExitCode.WorkflowInvalid);
  });

  it("lists mixed valid and invalid resources in lenient mode", async () => {
    let output = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
      output += msg;
      return true;
    });

    await main(["node", "open-dynamic-workflow", "list", "--cwd", MIXED_FIXTURES_DIR]);

    expect(output).toContain("valid-workflow");
    expect(output).toContain("valid-agent");
    expect(output).toContain("valid-tool");
    expect(output).toContain("INVALID"); // Pretty reporter shows INVALID for failed discovery
    expect(process.exitCode).toBe(ExitCode.Success);

    spy.mockRestore();
  });

  it("handles empty project gracefully", async () => {
    let output = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
      output += msg;
      return true;
    });

    await main(["node", "open-dynamic-workflow", "list", "--cwd", EMPTY_FIXTURES_DIR]);

    expect(output).toContain("No workflows found");
    expect(output).toContain("No agents found");
    expect(output).toContain("No tools found");
    expect(process.exitCode).toBe(ExitCode.Success);

    spy.mockRestore();
  });

  it("supports custom directory overrides", async () => {
    let output = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
      output += msg;
      return true;
    });

    // Test targeted override
    await main([
      "node",
      "open-dynamic-workflow",
      "list",
      "workflows",
      "--cwd",
      CUSTOM_FIXTURES_DIR,
      "--dir",
      "flows",
    ]);
    expect(output).toContain("custom-flow");

    output = "";
    // Test all-resource override
    await main([
      "node",
      "open-dynamic-workflow",
      "list",
      "--cwd",
      CUSTOM_FIXTURES_DIR,
      "--workflows-dir",
      "flows",
      "--agents-dir",
      "agents-custom",
      "--tools-dir",
      "tools-custom",
    ]);
    expect(output).toContain("custom-flow");
    expect(output).toContain("custom-agent");
    expect(output).toContain("custom-tool");

    spy.mockRestore();
  });

  it("handles duplicate resource IDs in JSON report", async () => {
    let output = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
      output += msg;
      return true;
    });

    await main([
      "node",
      "open-dynamic-workflow",
      "list",
      "--cwd",
      DUPLICATE_FIXTURES_DIR,
      "--report",
      "json",
    ]);

    const parsed = JSON.parse(output);
    expect(parsed.status).toBe("partially_succeeded"); // Lenient by default returns partially_succeeded if there are warnings
    
    // Check for duplicate warnings in the report
    const warnings = parsed.warnings;
    expect(warnings.some((w: any) => w.message.includes("Duplicate workflow"))).toBe(true);
    expect(warnings.some((w: any) => w.message.includes("Duplicate agent"))).toBe(true);
    expect(warnings.some((w: any) => w.message.includes("Duplicate tool"))).toBe(true);

    spy.mockRestore();
  });

  describe("initialization hints integration", () => {
    beforeEach(async () => {
      await fs.rm(HINT_TEMP_DIR, { recursive: true, force: true });
      await fs.mkdir(HINT_TEMP_DIR, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(HINT_TEMP_DIR, { recursive: true, force: true });
    });

    it("pretty output contains the summarized warning block and Next step", async () => {
      let output = "";
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
        output += msg;
        return true;
      });

      await main(["node", "open-dynamic-workflow", "list", "--cwd", HINT_TEMP_DIR]);

      expect(output).toContain("Warnings:\n  - Project is not initialized.\n    Missing config: .open-dynamic-workflow/config.yaml\n    Missing directories:\n      - workflows\n      - .open-dynamic-workflow/agents\n      - .open-dynamic-workflow/tools");
      expect(output).toContain("Next step:\n  Run `open-dynamic-workflow init` to initialize this project.");
      expect(process.exitCode).toBe(ExitCode.Success);

      spy.mockRestore();
    });

    it("JSON output includes diagnostic.hint", async () => {
      let output = "";
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
        output += msg;
        return true;
      });

      await main(["node", "open-dynamic-workflow", "list", "--cwd", HINT_TEMP_DIR, "--report", "json"]);

      const parsed = JSON.parse(output);
      const diagnostics = [...(parsed.warnings || []), ...(parsed.errors || [])];
      const diagnosticWithHint = diagnostics.find((d) => d.hint?.code === "PROJECT_INIT_MISSING");
      expect(diagnosticWithHint).toBeDefined();

      spy.mockRestore();
    });

    it("JSONL output includes hint-bearing list.warning or list.error records", async () => {
      let output = "";
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
        output += msg;
        return true;
      });

      await main(["node", "open-dynamic-workflow", "list", "--cwd", HINT_TEMP_DIR, "--report", "jsonl"]);

      const lines = output.trim().split("\n");
      const record = lines
        .map((l) => JSON.parse(l))
        .find((obj) => {
          if (obj.type === "list.warning" && obj.warning?.hint?.code === "PROJECT_INIT_MISSING") {
            return true;
          }
          if (obj.type === "list.error" && obj.error?.hint?.code === "PROJECT_INIT_MISSING") {
            return true;
          }
          return false;
        });
      expect(record).toBeDefined();

      spy.mockRestore();
    });

    it("list --strict still exits non-zero", async () => {
      await main(["node", "open-dynamic-workflow", "list", "--cwd", HINT_TEMP_DIR, "--strict"]);
      expect(process.exitCode).toBe(ExitCode.WorkflowInvalid);
    });
  });
});

