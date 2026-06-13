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

  it("verbose true still writes the event envelope to stdout as JSONL and also writes to stderr", () => {
    const { streams, getStdout, getStderr } = createMockStreams();
    const reporter = new JsonlReporter(streams, { verbose: true });

    const verboseEvent = {
      ...dummyEvent,
      type: "agent.verbose.command",
      payload: {
        agentId: "agent-1",
        label: "my-label",
        provider: "mock",
        cwd: "/repo",
        command: {
          command: "ls",
          args: ["-la"],
          env: { NODE_ENV: "test" }
        },
        prompt: "test",
        permissions: { mode: "dangerously-full-access" },
        metadata: { sharedAgentId: "test-agent" },
        artifacts: {
          dir: "agents/agent-1",
          promptPath: "agents/agent-1/prompt.txt",
          stdoutPath: "agents/agent-1/stdout.log",
          stderrPath: "agents/agent-1/stderr.log"
        }
      }
    };

    reporter.handle(verboseEvent as any);

    expect(getStdout()).toBe(JSON.stringify(verboseEvent) + "\n");
    expect(getStderr()).toContain("Agent command: my-label");
    expect(getStderr()).toContain(`  Event: #${verboseEvent.sequence} ${verboseEvent.timestamp}`);
    expect(getStderr()).toContain("Command Environment:");
    expect(getStderr()).toContain('    "NODE_ENV": "test"');
    expect(getStderr()).toContain("Permissions: dangerously-full-access");
    expect(getStderr()).toContain("Metadata:");
    expect(getStderr()).toContain('    "sharedAgentId": "test-agent"');
    expect(getStderr()).toContain("Artifacts:");
    expect(getStderr()).toContain("    dir: agents/agent-1");
  });

  it("no output is written to stderr when verbose is false", () => {
    const { streams, getStderr } = createMockStreams();
    const reporter = new JsonlReporter(streams, { verbose: false });

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

  it("verbose result block in stderr includes parse warnings", () => {
    const { streams, getStderr } = createMockStreams();
    const reporter = new JsonlReporter(streams, { verbose: true });

    reporter.handle({
      ...dummyEvent,
      type: "agent.verbose.result",
      payload: {
        agentId: "agent-1",
        label: "my-label",
        status: "succeeded",
        durationMs: 12,
        exitCode: 0,
        stdout: "mock stdout",
        stderr: "",
        normalized: { summary: "done" },
        parseWarnings: ["Warning 1"],
        permissions: { mode: "default" },
        artifacts: {
          dir: "agents/agent-1",
          promptPath: "agents/agent-1/prompt.txt",
          stdoutPath: "agents/agent-1/stdout.log",
          stderrPath: "agents/agent-1/stderr.log"
        }
      }
    } as any);

    expect(getStderr()).toContain("Parse warnings:");
    expect(getStderr()).toContain("    - Warning 1");
    expect(getStderr()).toContain("Permissions: default");
    expect(getStderr()).toContain("Artifacts:");
    expect(getStderr()).toContain("    stdout: agents/agent-1/stdout.log");
  });
});
