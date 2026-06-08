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
      artifactsDir: ".openflow/runs/123"
    } as any);

    expect(getStdout()).toBe("Artifacts: .openflow/runs/123\n");
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

  it("pipeline.started prints pipeline start details", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "pipeline.started",
      payload: { pipelineId: "pipeline-1", label: "my-pipeline", strategy: "stage-barrier", itemCount: 5 }
    } as any);

    expect(getStdout()).toBe("◇ Pipeline pipeline-1 (my-pipeline) started [strategy: stage-barrier, items: 5]\n");
  });

  it("pipeline.stage.started prints progress in verbose mode", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
      type: "pipeline.stage.started",
      payload: { pipelineId: "pipeline-1", itemIndex: 2, stageName: "lint", stageIndex: 0 }
    } as any);

    expect(getStdout()).toBe("  → Item 2: Stage lint started\n");
  });

  it("pipeline.stage.completed prints completion in verbose mode", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
      type: "pipeline.stage.completed",
      payload: { pipelineId: "pipeline-1", itemIndex: 2, stageName: "lint", durationMs: 450 }
    } as any);

    expect(getStdout()).toBe("  ✓ Item 2: Stage lint completed 450ms\n");
  });

  it("pipeline.stage.failed prints failure", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "pipeline.stage.failed",
      payload: { pipelineId: "pipeline-1", itemIndex: 2, stageName: "lint", error: { message: "lint failed" } }
    } as any);

    expect(getStdout()).toBe("  ✕ Item 2: Stage lint failed: lint failed\n");
  });

  it("pipeline.completed prints terminal status and artifact location", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "pipeline.completed",
      payload: { pipelineId: "pipeline-1", status: "succeeded", durationMs: 1200, artifactPath: "pipelines/pipeline-1/pipeline.json" }
    } as any);

    expect(getStdout()).toBe("✓ Pipeline pipeline-1 completed successfully 1.2s\n  Artifacts: pipelines/pipeline-1/pipeline.json\n");
  });

  it("agent.started prints label and provider with [dangerously-full-access] if mode matches", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "agent.started",
      payload: {
        agentId: "agent-1",
        label: "my-label",
        provider: "mock",
        permissions: { mode: "dangerously-full-access" }
      }
    } as any);

    expect(getStdout()).toBe("▶ my-label started [mock] [dangerously-full-access]\n");
  });

  it("agent.completed prints success mark with [dangerously-full-access] if mode matches", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "agent.completed",
      payload: {
        agentId: "agent-1",
        provider: "mock",
        durationMs: 1500,
        permissions: { mode: "dangerously-full-access" }
      }
    } as any);

    expect(getStdout()).toBe("✓ agent-1 succeeded [mock] 1.5s [dangerously-full-access]\n");
  });
});
