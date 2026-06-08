import { describe, expect, it } from "vitest";
import { JsonlReporter } from "../../../src/output/jsonl-reporter.js";
import type { EventEnvelope } from "../../../src/output/events.js";

function createMockStreams() {
  let stdoutData = "";
  let stderrData = "";
  return {
    streams: {
      stdout: {
        write(chunk: any) {
          stdoutData += chunk.toString();
          return true;
        }
      } as any,
      stderr: {
        write(chunk: any) {
          stderrData += chunk.toString();
          return true;
        }
      } as any
    },
    getStdout: () => stdoutData,
    getStderr: () => stderrData
  };
}

describe("JsonlReporter", () => {
  const dummyEvent: EventEnvelope = {
    schemaVersion: "openflow.event.v1",
    runId: "run-1",
    sequence: 1,
    timestamp: "2026-06-02T00:00:00.000Z",
    type: "workflow.started",
    payload: {
      meta: { name: "my-flow", description: "" },
      workflowPath: "flow.js",
      artifactsDir: "dir"
    }
  };

  it("handle() writes exactly one line, valid JSON, matching the event, and nothing else", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonlReporter(streams);

    reporter.handle(dummyEvent);

    const output = getStdout();
    
    // Should be exactly the JSON string + newline
    const expected = JSON.stringify(dummyEvent) + "\n";
    expect(output).toBe(expected);

    expect(output.endsWith("\n")).toBe(true);

    const parsed = JSON.parse(output.trim());
    expect(parsed).toEqual(dummyEvent);
  });

  it("start() writes nothing", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonlReporter(streams);

    reporter.start({
      runId: "run-1",
      meta: { name: "test", description: "" },
      artifactsDir: "dir"
    });

    expect(getStdout()).toBe("");
  });

  it("finish() writes nothing", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonlReporter(streams);

    reporter.finish({} as any);

    expect(getStdout()).toBe("");
  });

  it("no output is written to stderr", () => {
    const { streams, getStderr } = createMockStreams();
    const reporter = new JsonlReporter(streams);

    reporter.handle(dummyEvent);

    expect(getStderr()).toBe("");
  });

  it("emitted event lines include permissions", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonlReporter(streams);

    const eventWithPerms: EventEnvelope = {
      ...dummyEvent,
      type: "agent.started",
      payload: {
        agentId: "agent-1",
        provider: "mock",
        permissions: { mode: "dangerously-full-access" }
      } as any
    };

    reporter.handle(eventWithPerms);

    const output = getStdout();
    const parsed = JSON.parse(output.trim());
    expect(parsed.payload.permissions).toEqual({ mode: "dangerously-full-access" });
  });
});
