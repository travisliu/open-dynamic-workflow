import { describe, expect, it, vi } from "vitest";
import { PrettyReporter } from "../../../src/output/pretty-reporter.js";
import { JsonReporter } from "../../../src/output/json-reporter.js";
import { JsonlReporter } from "../../../src/output/jsonl-reporter.js";
import type { EventEnvelope } from "../../../src/output/events.js";

describe("Tool Reporters", () => {
  const createToolEvent = (type: string, payload: any): EventEnvelope => ({
    schemaVersion: "openflow.event.v1",
    runId: "run-1",
    sequence: 1,
    timestamp: new Date().toISOString(),
    type: type as any,
    payload
  });

  describe("PrettyReporter", () => {
    it("prints tool completion event", () => {
      const stdout = { write: vi.fn() };
      const reporter = new PrettyReporter({ stdout: stdout as any, stderr: {} as any });
      
      const event = createToolEvent("tool.completed", {
        definition: "echo",
        executionDurationMs: 42
      });

      reporter.handle(event);
      expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("✓ echo tool 42ms"));
    });

    it("prints tool failure event", () => {
      const stdout = { write: vi.fn() };
      const reporter = new PrettyReporter({ stdout: stdout as any, stderr: {} as any });
      
      const event = createToolEvent("tool.failed", {
        definition: "fail",
        error: { message: "failed to read file" },
        artifactPath: "tools/call-1"
      });

      reporter.handle(event);
      expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("✕ fail tool failed: failed to read file"));
      expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("Artifacts: tools/call-1"));
    });
  });

  describe("JsonReporter", () => {
    it("includes tools in final report", () => {
      const stdout = { write: vi.fn() };
      const reporter = new JsonReporter({ stdout: stdout as any, stderr: {} as any });
      
      const result: any = {
        status: "succeeded",
        tools: [
          { 
            toolCallId: "call-1", 
            definition: "echo", 
            ok: true, 
            durationMs: 42,
            workflowInvocationId: "root",
            artifactPath: "tools/call-1"
          }
        ]
      };

      reporter.finish(result);
      const output = JSON.parse(stdout.write.mock.calls[0][0]);
      expect(output.tools).toHaveLength(1);
      expect(output.tools[0].definition).toBe("echo");
    });
  });

  describe("JsonlReporter", () => {
    it("streams tool events", () => {
      const stdout = { write: vi.fn() };
      const reporter = new JsonlReporter({ stdout: stdout as any, stderr: {} as any });
      
      const event = createToolEvent("tool.started", { toolCallId: "call-1" });

      reporter.handle(event);
      const output = JSON.parse(stdout.write.mock.calls[0][0]);
      expect(output.type).toBe("tool.started");
      expect(output.payload.toolCallId).toBe("call-1");
    });
  });
});
