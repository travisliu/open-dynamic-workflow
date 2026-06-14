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

  it("agent.cache_hit prints cache hit mark", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "agent.cache_hit",
      payload: { agentId: "agent-1", label: "my-label", provider: "mock" }
    } as any);

    expect(getStdout()).toBe("↻ my-label cache hit [mock]\n");
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

  it("agent.output is hidden when verbose is true", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
      type: "agent.output",
      payload: { agentId: "agent-1", data: "some output\n" }
    } as any);

    expect(getStdout()).toBe("");
  });

  it("agent.verbose.command is shown when verbose is true", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
      type: "agent.verbose.command",
      sequence: 42,
      timestamp: "2026-06-13T12:34:56.789Z",
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
        prompt: "list files",
        permissions: { mode: "dangerously-full-access" },
        metadata: { sharedAgentId: "test-agent" },
        artifacts: {
          dir: "agents/agent-1",
          promptPath: "agents/agent-1/prompt.txt",
          stdoutPath: "agents/agent-1/stdout.log",
          stderrPath: "agents/agent-1/stderr.log",
          metadataPath: "agents/agent-1/metadata.json"
        }
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("Agent command: my-label");
    expect(output).toContain("  Event: #42 2026-06-13T12:34:56.789Z");
    expect(output).toContain("Provider: mock");
    expect(output).toContain("CWD: /repo");
    expect(output).toContain("Command:");
    expect(output).toContain("  ls -la");
    expect(output).toContain("Command Environment:");
    expect(output).toContain('    "NODE_ENV": "test"');
    expect(output).toContain("Prompt:");
    expect(output).toContain("  list files");
    expect(output).toContain("Permissions: dangerously-full-access");
    expect(output).toContain("Metadata:");
    expect(output).toContain('    "sharedAgentId": "test-agent"');
    expect(output).toContain("Artifacts:");
    expect(output).toContain("    dir: agents/agent-1");
    expect(output).toContain("    prompt: agents/agent-1/prompt.txt");
    expect(output).toContain("    stdout: agents/agent-1/stdout.log");
    expect(output).toContain("    stderr: agents/agent-1/stderr.log");
    expect(output).toContain("    metadata: agents/agent-1/metadata.json");
  });

  it("agent.verbose.result is shown when verbose is true", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
      type: "agent.verbose.result",
      sequence: 43,
      timestamp: "2026-06-13T12:34:57.001Z",
      payload: {
        agentId: "agent-1",
        label: "my-label",
        status: "succeeded",
        durationMs: 12,
        exitCode: 0,
        stdout: "mock stdout",
        stderr: "",
        normalized: { summary: "done" },
        permissions: { mode: "default" },
        metadata: { foo: "bar" },
        artifacts: {
          dir: "agents/agent-1",
          promptPath: "agents/agent-1/prompt.txt",
          stdoutPath: "agents/agent-1/stdout.log",
          stderrPath: "agents/agent-1/stderr.log"
        }
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("Agent result: my-label succeeded 12ms");
    expect(output).toContain("  Event: #43 2026-06-13T12:34:57.001Z");
    expect(output).toContain("Exit code: 0");
    expect(output).toContain("stdout:");
    expect(output).toContain("  mock stdout");
    expect(output).toContain("stderr:");
    expect(output).toContain("  (empty)");
    expect(output).toContain("Normalized response:");
    expect(output).toContain('    {\n      "summary": "done"\n    }');
    expect(output).toContain("Permissions: default");
    expect(output).toContain("Metadata:");
    expect(output).toContain('    "foo": "bar"');
    expect(output).toContain("Artifacts:");
    expect(output).toContain("    dir: agents/agent-1");
    expect(output).toContain("    prompt: agents/agent-1/prompt.txt");
    expect(output).toContain("    stdout: agents/agent-1/stdout.log");
    expect(output).toContain("    stderr: agents/agent-1/stderr.log");
  });

  it("agent.verbose.command is hidden when verbose is false", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: false });

    reporter.handle({
      type: "agent.verbose.command",
      payload: { agentId: "agent-1" }
    } as any);

    expect(getStdout()).toBe("");
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

  it("prints sanitized agent metadata in verbose mode", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
      type: "agent.completed",
      payload: {
        agentId: "agent-1",
        provider: "mock",
        durationMs: 100,
        metadata: { sharedAgentId: "test-agent", foo: "bar", secret: "redact-me" }
      }
    } as any);

    expect(getStdout()).toContain("✓ agent-1 succeeded [mock] 100ms\n");
    // "foo" and "secret" should be dropped
    expect(getStdout()).toContain('  Metadata: {"sharedAgentId":"test-agent"}\n');
  });

  it("prints size-limited agent metadata in verbose mode", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    const longString = "a".repeat(300);
    reporter.handle({
      type: "agent.completed",
      payload: {
        agentId: "agent-1",
        provider: "mock",
        durationMs: 100,
        metadata: { sharedAgentId: longString }
      }
    } as any);

    expect(getStdout()).toContain('  Metadata: {"sharedAgentId":"' + "a".repeat(256) + '..."}\n');
  });

  it("workflow.invocation.started prints invocation details", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "workflow.invocation.started",
      payload: { workflowInvocationId: "wf-1", workflowName: "sub-flow", depth: 1 }
    } as any);

    expect(getStdout()).toBe("> workflow sub-flow started (wf-1)\n");
  });

  it("workflow.invocation.completed prints success", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "workflow.invocation.completed",
      payload: { workflowName: "sub-flow", durationMs: 123 }
    } as any);

    expect(getStdout()).toBe("ok workflow sub-flow completed in 123ms\n");
  });

  it("workflow.invocation.failed prints failure status", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);

    reporter.handle({
      type: "workflow.invocation.failed",
      payload: { workflowName: "sub-flow", durationMs: 456 }
    } as any);

    expect(getStdout()).toBe("error workflow sub-flow failed in 456ms\n");
  });

  it("agent.verbose.result shows parse warnings when present", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
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
        parseWarnings: ["Warning 1", "Warning 2"],
        permissions: { mode: "default" },
        artifacts: {
          dir: "agents/agent-1",
          promptPath: "agents/agent-1/prompt.txt",
          stdoutPath: "agents/agent-1/stdout.log",
          stderrPath: "agents/agent-1/stderr.log"
        }
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("Parse warnings:");
    expect(output).toContain("    - Warning 1");
    expect(output).toContain("    - Warning 2");
  });

  it("omits Command Environment block when env is missing or empty", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams, { verbose: true });

    reporter.handle({
      type: "agent.verbose.command",
      payload: {
        agentId: "agent-1",
        provider: "mock",
        cwd: "/repo",
        command: {
          command: "ls",
          args: ["-la"],
          env: undefined
        },
        prompt: "list",
        permissions: { mode: "default" },
        artifacts: { dir: "dir", promptPath: "p", stdoutPath: "o", stderrPath: "e" }
      }
    } as any);

    expect(getStdout()).not.toContain("Command Environment:");

    reporter.handle({
      type: "agent.verbose.command",
      payload: {
        agentId: "agent-2",
        provider: "mock",
        cwd: "/repo",
        command: {
          command: "ls",
          args: ["-la"],
          env: {}
        },
        prompt: "list",
        permissions: { mode: "default" },
        artifacts: { dir: "dir", promptPath: "p", stdoutPath: "o", stderrPath: "e" }
      }
    } as any);

    expect(getStdout()).not.toContain("Command Environment:");
  });
});
