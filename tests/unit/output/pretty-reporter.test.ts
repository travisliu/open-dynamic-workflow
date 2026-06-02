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
  it("start() prints workflow name", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.start({
      runId: "run-1",
      meta: { name: "my-flow", description: "" },
      artifactsDir: "dir"
    });

    expect(getStdout()).toBe("◇ my-flow\n");
  });

  it("phase.started prints phase", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "phase.started",
      payload: { name: "review" }
    } as any);

    expect(getStdout()).toBe("→ Phase: review\n");
  });

  it("agent.started prints label and provider", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "agent.started",
      payload: { agentId: "agent-1", label: "my-label", provider: "mock" }
    } as any);

    expect(getStdout()).toBe("▶ my-label started [mock]\n");
  });

  it("agent.completed prints success mark", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "agent.completed",
      payload: { agentId: "agent-1", provider: "mock", durationMs: 1500 }
    } as any);

    expect(getStdout()).toBe("✓ agent-1 succeeded [mock] 1.5s\n");
  });

  it("agent.failed prints failure mark and message", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "agent.failed",
      payload: { agentId: "agent-1", provider: "mock", error: { message: "timeout" } }
    } as any);

    expect(getStdout()).toBe("✕ agent-1 failed [mock] timeout\n");
  });

  it("finish() prints artifact directory", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.finish({
      artifactsDir: ".execflow/runs/123"
    } as any);

    expect(getStdout()).toBe("Artifacts: .execflow/runs/123\n");
  });

  it("agent.output is hidden unless verbose is true", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: false });

    reporter.handle({
      type: "agent.output",
      payload: { agentId: "agent-1", data: "some output\n" }
    } as any);

    expect(getStdout()).toBe("");
  });

  it("agent.output is shown when verbose is true", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
      type: "agent.output",
      payload: { agentId: "agent-1", data: "some output\n" }
    } as any);

    expect(getStdout()).toBe("[agent-1] some output\n");
  });
});
