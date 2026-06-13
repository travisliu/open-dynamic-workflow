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
    schemaVersion: "openflow.list.v1",
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
    expect(parsed.schemaVersion).toBe("openflow.list.v1");
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
});
