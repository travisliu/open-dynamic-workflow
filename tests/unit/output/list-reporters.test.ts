import { describe, expect, it, beforeEach } from "vitest";
import { createListReporter } from "../../../src/output/list-reporter.js";
import { PassThrough } from "node:stream";
import type { ListResult } from "../../../src/discovery/types.js";

describe("List Reporters", () => {
  let stdout: PassThrough;
  let stderr: PassThrough;
  let output = "";

  beforeEach(() => {
    stdout = new PassThrough();
    stderr = new PassThrough();
    output = "";
    stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
  });

  const mockResult: ListResult = {
    schemaVersion: "open-dynamic-workflow.list.v1",
    status: "succeeded",
    resourceTypes: ["workflow", "agent", "tool"],
    resources: [
      { type: "workflow", name: "flow-1", description: "desc 1", path: "f1.ts", valid: true },
      { type: "agent", id: "agent-1", description: "desc 2", path: "a1.ts", valid: true },
      { type: "tool", id: "tool-1", description: "desc 3", path: "t1.ts", valid: true },
    ],
    warnings: [],
    errors: [],
    summary: {
      discoveredCount: 3,
      validCount: 3,
      warningCount: 0,
      errorCount: 0,
      countsByType: { workflow: 1, agent: 1, tool: 1 },
    },
  };

  it("pretty reporter: default grouped output", async () => {
    const reporter = createListReporter({ mode: "pretty", streams: { stdout, stderr } });
    reporter.render(mockResult);

    expect(output).toContain("--- WORKFLOWS ---");
    expect(output).toContain("flow-1");
    expect(output).toContain("--- AGENTS ---");
    expect(output).toContain("agent-1");
    expect(output).toContain("--- TOOLS ---");
    expect(output).toContain("tool-1");
    expect(output).not.toContain("TYPE");
    expect(output).toContain("ID/NAME");
  });

  it("pretty reporter: handles empty resources", async () => {
    const emptyResult: ListResult = {
      ...mockResult,
      resources: [],
      summary: {
        discoveredCount: 0,
        validCount: 0,
        warningCount: 0,
        errorCount: 0,
        countsByType: { workflow: 0, agent: 0, tool: 0 },
      },
    };
    const reporter = createListReporter({ mode: "pretty", streams: { stdout, stderr } });
    reporter.render(emptyResult);

    expect(output).toContain("No workflows found");
    expect(output).toContain("No agents found");
    expect(output).toContain("No tools found");
  });

  it("pretty reporter: verbose includes path and metadata", async () => {
    const verboseResult: ListResult = {
      ...mockResult,
      resources: [
        { 
          type: "agent", 
          id: "agent-1", 
          description: "desc 2", 
          path: "a1.ts", 
          valid: true,
          metadata: { provider: "openai" },
          requiredInputs: ["apiKey"]
        },
        { 
          type: "tool", 
          id: "tool-1", 
          description: "desc 3", 
          path: "t1.ts", 
          valid: true,
          defaultTimeoutMs: 5000,
          inputSchema: { type: "object" }
        },
      ]
    };
    const reporter = createListReporter({ mode: "pretty", streams: { stdout, stderr }, verbose: true });
    reporter.render(verboseResult);

    expect(output).toContain("Path: a1.ts");
    expect(output).toContain("Metadata: {\"provider\":\"openai\"}");
    expect(output).toContain("Required Inputs: apiKey");
    expect(output).toContain("Default Timeout: 5000ms");
    expect(output).toContain("Input Schema: {\"type\":\"object\"}");
  });

  it("json reporter: emits parseable JSON", async () => {
    const reporter = createListReporter({ mode: "json", streams: { stdout, stderr } });
    reporter.render(mockResult);

    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe("open-dynamic-workflow.list.v1");
    expect(parsed.resources).toHaveLength(3);
  });

  it("jsonl reporter: emits multiple records", async () => {
    const reporter = createListReporter({ mode: "jsonl", streams: { stdout, stderr } });
    reporter.render(mockResult);

    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(4); // 3 resources + 1 summary
    const first = JSON.parse(lines[0]);
    expect(first.type).toBe("list.resource");
    const last = JSON.parse(lines[3]);
    expect(last.type).toBe("list.summary");
  });

  it("structured reporters: no ANSI styling and no source leakage", async () => {
    const resultWithRawData: ListResult = {
      ...mockResult,
      resources: [
        { 
          type: "agent", 
          id: "agent-1", 
          description: "desc", 
          path: "a.ts", 
          valid: true,
          // @ts-ignore - simulate accidental inclusion of sensitive fields
          agentPrompt: "SECRET PROMPT",
          sourceCode: "SECRET CODE"
        } as any
      ]
    };

    const jsonReporter = createListReporter({ mode: "json", streams: { stdout, stderr } });
    jsonReporter.render(resultWithRawData);
    
    expect(output).not.toMatch(/\u001b\[\d+m/);
    expect(output).not.toContain("SECRET PROMPT");
    expect(output).not.toContain("SECRET CODE");

    output = ""; // Reset output for next reporter
    const jsonlReporter = createListReporter({ mode: "jsonl", streams: { stdout, stderr } });
    jsonlReporter.render(resultWithRawData);

    expect(output).not.toMatch(/\u001b\[\d+m/);
    expect(output).not.toContain("SECRET PROMPT");
    expect(output).not.toContain("SECRET CODE");
  });

  describe("List Reporters Hint Support", () => {
    const uninitializedResult: ListResult = {
      schemaVersion: "open-dynamic-workflow.list.v1",
      status: "failed",
      resourceTypes: ["workflow", "agent", "tool"],
      resources: [],
      warnings: [
        {
          severity: "warning",
          resourceType: "workflow",
          path: "workflows",
          code: "LIST_DIRECTORY_NOT_FOUND",
          message: "Directory workflows not found",
          hint: {
            code: "PROJECT_INIT_MISSING",
            message: "This project may not be initialized yet. Run `odw init` to create .open-dynamic-workflow/config.yaml and default project directories.",
            command: "odw init",
          },
        },
        {
          severity: "warning",
          resourceType: "agent",
          path: ".open-dynamic-workflow/agents",
          code: "LIST_DIRECTORY_NOT_FOUND",
          message: "Directory .open-dynamic-workflow/agents not found",
          hint: {
            code: "PROJECT_INIT_MISSING",
            message: "This project may not be initialized yet. Run `odw init` to create .open-dynamic-workflow/config.yaml and default project directories.",
            command: "odw init",
          },
        },
        {
          severity: "warning",
          resourceType: "tool",
          path: ".open-dynamic-workflow/tools",
          code: "LIST_DIRECTORY_NOT_FOUND",
          message: "Directory .open-dynamic-workflow/tools not found",
          hint: {
            code: "PROJECT_INIT_MISSING",
            message: "This project may not be initialized yet. Run `odw init` to create .open-dynamic-workflow/config.yaml and default project directories.",
            command: "odw init",
          },
        },
      ],
      errors: [],
      summary: {
        discoveredCount: 0,
        validCount: 0,
        warningCount: 3,
        errorCount: 0,
        countsByType: {},
      },
    };

    const hintResult: ListResult = {
      schemaVersion: "open-dynamic-workflow.list.v1",
      status: "failed",
      resourceTypes: ["workflow"],
      resources: [],
      warnings: [
        {
          severity: "warning",
          resourceType: "workflow",
          path: "missing-workflow.js",
          code: "LIST_DIRECTORY_NOT_FOUND",
          message: "Directory workflows not found",
          hint: {
            code: "PROJECT_INIT_MISSING",
            message: "This project may not be initialized yet. Run `odw init` to create .open-dynamic-workflow/config.yaml and default project directories.",
            command: "odw init",
          },
        },
      ],
      errors: [
        {
          severity: "error",
          resourceType: "agent",
          path: "missing-agent.js",
          code: "AGENT_DEFINITION_MISSING",
          message: "Shared agent definition missing",
          hint: {
            code: "PROJECT_INIT_MISSING",
            message: "This project may not be initialized yet. Run `odw init` to create .open-dynamic-workflow/config.yaml and default project directories.",
            command: "odw init",
          },
        },
      ],
      summary: {
        discoveredCount: 0,
        validCount: 0,
        warningCount: 1,
        errorCount: 1,
        countsByType: {},
      },
    };

    it("pretty reporter: uninitialized default project pretty summary", async () => {
      const reporter = createListReporter({ mode: "pretty", streams: { stdout, stderr } });
      reporter.render(uninitializedResult);

      expect(output).toContain("--- WORKFLOWS ---");
      expect(output).toContain("No workflows found.");
      expect(output).toContain("--- AGENTS ---");
      expect(output).toContain("No agents found.");
      expect(output).toContain("--- TOOLS ---");
      expect(output).toContain("No tools found.");
      expect(output).toContain("Warnings:\n  - Project is not initialized.\n    Missing config: .open-dynamic-workflow/config.yaml\n    Missing directories:\n      - workflows\n      - .open-dynamic-workflow/agents\n      - .open-dynamic-workflow/tools");
      expect(output).toContain("Next step:\n  Run `odw init` to initialize this project.");

      // assert raw per-directory diagnostics and repeated Hint: lines are not printed
      expect(output).not.toContain("Directory workflows not found");
      expect(output).not.toContain("LIST_DIRECTORY_NOT_FOUND");
      expect(output).not.toContain("Hint: This project may not be initialized yet");
    });

    it("pretty reporter prints Hint: under the correct diagnostic and does not duplicate it", async () => {
      const reporter = createListReporter({ mode: "pretty", streams: { stdout, stderr } });
      reporter.render(hintResult);

      expect(output).toContain("Directory workflows not found (LIST_DIRECTORY_NOT_FOUND)");
      expect(output).toContain("    Hint: This project may not be initialized yet. Run `odw init` to create .open-dynamic-workflow/config.yaml and default project directories.");
      expect(output).toContain("Shared agent definition missing (AGENT_DEFINITION_MISSING)");
      
      const matches = output.match(/Hint: This project may not be initialized yet/g);
      expect(matches).toHaveLength(2);
    });

    it("JSON reporter preserves diagnostic.hint", async () => {
      const reporter = createListReporter({ mode: "json", streams: { stdout, stderr } });
      reporter.render(hintResult);

      const parsed = JSON.parse(output);
      expect(parsed.warnings[0].hint).toBeDefined();
      expect(parsed.warnings[0].hint.code).toBe("PROJECT_INIT_MISSING");
      expect(parsed.errors[0].hint).toBeDefined();
      expect(parsed.errors[0].hint.code).toBe("PROJECT_INIT_MISSING");
    });

    it("JSONL reporter preserves hint on list.warning and list.error", async () => {
      const reporter = createListReporter({ mode: "jsonl", streams: { stdout, stderr } });
      reporter.render(hintResult);

      const lines = output.trim().split("\n");
      const warningLine = lines.find((l) => JSON.parse(l).type === "list.warning");
      const errorLine = lines.find((l) => JSON.parse(l).type === "list.error");

      expect(warningLine).toBeDefined();
      const warningObj = JSON.parse(warningLine!);
      expect(warningObj.warning.hint).toBeDefined();
      expect(warningObj.warning.hint.code).toBe("PROJECT_INIT_MISSING");

      expect(errorLine).toBeDefined();
      const errorObj = JSON.parse(errorLine!);
      expect(errorObj.error.hint).toBeDefined();
      expect(errorObj.error.hint.code).toBe("PROJECT_INIT_MISSING");
    });
  });
});
