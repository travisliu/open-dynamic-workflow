import { describe, expect, it } from "vitest";
import { PrettyReporter } from "../../../src/output/pretty-reporter.js";

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

describe("PrettyReporter", () => {
  it("orchestrates a full run correctly", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.start({
      runId: "run-1",
      meta: { name: "my-flow" },
      workflow: { file: "flow.ts" }
    } as any);

    reporter.handle({
      type: "workflow.invocation.started",
      payload: { workflowInvocationId: "wf-1", workflowName: "my-flow" }
    } as any);

    reporter.handle({
      type: "agent.started",
      payload: { 
        workflowInvocationId: "wf-1", 
        agentRunId: "a-1", 
        label: "My Agent", 
        provider: "openai" 
      }
    } as any);

    reporter.handle({
      type: "agent.completed",
      payload: { agentRunId: "a-1", durationMs: 1234 }
    } as any);

    reporter.handle({
      type: "workflow.invocation.completed",
      payload: { workflowInvocationId: "wf-1", durationMs: 2000 }
    } as any);

    // Assert live progress in non-verbose mode
    expect(getStdout()).toContain("▶ My Agent  openai");
    expect(getStdout()).toContain("✓ My Agent  openai  1.2s");

    reporter.finish({
      status: "succeeded",
      durationMs: 2500,
      artifactsDir: "/tmp/run",
    } as any);

    const output = getStdout();
    
    // Assert exactly once for each main section
    expect(output.split("◇ my-flow").length - 1).toBe(1);
    expect(output.split("Execution").length - 1).toBe(1);
    expect(output.split("Summary").length - 1).toBe(1);
    expect(output.split("Artifacts").length - 1).toBe(1);

    expect(output).toContain("file: flow.ts");
    expect(output).toContain("✓ My Agent  openai  1.2s");
    expect(output).toContain("status:    succeeded");
    expect(output).toContain("duration:  2.5s");
    expect(output).toContain("  /tmp/run");
  });

  it("verbose mode still streams verbose blocks", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.start({
      runId: "run-1",
      meta: { name: "my-flow" },
    } as any);

    expect(getStdout()).not.toContain("◇ my-flow");

    reporter.handle({
      type: "agent.verbose.command",
      payload: {
        agentId: "a-1",
        label: "My Agent",
        provider: "openai",
        command: { command: "ls", args: [] },
        prompt: "list files",
        permissions: { mode: "default" },
        artifacts: { dir: "d", promptPath: "p", stdoutPath: "o", stderrPath: "e" }
      }
    } as any);

    expect(getStdout()).toContain("Agent command: My Agent");
  });

  it("streams workflow.log events immediately with correct indentation", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.start({
      runId: "run-1",
      meta: { name: "my-flow" },
    } as any);

    // Root-level log (no workflowId -> depth 0)
    reporter.handle({
      type: "workflow.log",
      payload: { message: "Root log" }
    } as any);

    expect(getStdout()).toContain("  • Root log\n");

    // Phase-level log (needs to add workflow invocation and phase first)
    reporter.handle({
      type: "workflow.invocation.started",
      payload: { workflowInvocationId: "wf-1", workflowName: "my-flow" }
    } as any);

    reporter.handle({
      type: "phase.started",
      payload: { workflowInvocationId: "wf-1", name: "setup" }
    } as any);

    reporter.handle({
      type: "workflow.log",
      payload: { workflowInvocationId: "wf-1", message: "Setup log", data: { ok: false, summary: "failed" } }
    } as any);

    expect(getStdout()).toContain("    • Setup log\n");
    expect(getStdout()).toContain("      data:\n");
    expect(getStdout()).toContain('"ok": false');
    expect(getStdout()).toContain('"summary": "failed"');
  });
});
