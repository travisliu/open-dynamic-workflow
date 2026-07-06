import { describe, expect, it } from "vitest";
import { JsonReporter } from "../../../src/output/json-reporter.js";

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

describe("JsonReporter", () => {
  const dummyResult = {
    schemaVersion: "open-dynamic-workflow.report.v1",
    runId: "run-1",
    status: "succeeded",
    meta: { name: "my-flow", description: "" },
    agents: [],
    startedAt: "start",
    finishedAt: "finish",
    durationMs: 100,
    artifactsDir: "dir",
    reportPath: "report.json",
    eventsPath: "events.jsonl"
  };

  it("start() and handle() write nothing", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);

    reporter.start({
      runId: "run-1",
      meta: { name: "test", description: "" },
      artifactsDir: "dir"
    });
    reporter.handle({} as any);

    expect(getStdout()).toBe("");
  });

  it("finish() writes valid JSON matching result to stdout and nothing else", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);

    reporter.finish(dummyResult as any);

    const output = getStdout();
    
    // Should be exactly the JSON string + newline
    const expected = JSON.stringify(dummyResult, null, 2) + "\n";
    expect(output).toBe(expected);

    // Should be parseable
    const parsed = JSON.parse(output.trim());
    expect(parsed).toEqual(dummyResult);
  });

  it("verbose true writes verbose command/result blocks to stderr", () => {
    const { streams, getStdout, getStderr } = createMockStreams();
    const reporter = new JsonReporter(streams, { verbose: true });

    reporter.handle({
      type: "agent.verbose.command",
      sequence: 1,
      timestamp: "2026-06-13T12:00:00.000Z",
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
    } as any);

    expect(getStdout()).toBe("");
    expect(getStderr()).toContain("Agent command: my-label");
    expect(getStderr()).toContain("  Event: #1 2026-06-13T12:00:00.000Z");
    expect(getStderr()).toContain("Command Environment:");
    expect(getStderr()).toContain('    "NODE_ENV": "test"');
    expect(getStderr()).toContain("Permissions: dangerously-full-access");
    expect(getStderr()).toContain("Metadata:");
    expect(getStderr()).toContain('    "sharedAgentId": "test-agent"');
    expect(getStderr()).toContain("Artifacts:");
    expect(getStderr()).toContain("    dir: agents/agent-1");
  });

  it("verbose false ignores verbose events", () => {
    const { streams, getStdout, getStderr } = createMockStreams();
    const reporter = new JsonReporter(streams, { verbose: false });

    reporter.handle({
      type: "agent.verbose.command",
      payload: { agentId: "agent-1" }
    } as any);

    expect(getStdout()).toBe("");
    expect(getStderr()).toBe("");
  });

  it("finish() output includes agent permissions", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);

    const resultWithPermissions = {
      ...dummyResult,
      agents: [
        {
          id: "agent-1",
          status: "succeeded",
          permissions: { mode: "dangerously-full-access" }
        }
      ]
    };

    reporter.finish(resultWithPermissions as any);

    const output = getStdout();
    const parsed = JSON.parse(output.trim());
    expect(parsed.agents[0].permissions).toEqual({ mode: "dangerously-full-access" });
  });

  it("finish() output preserves retry metadata on final agent reports", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);

    const resultWithRetry = {
      ...dummyResult,
      agents: [
        {
          id: "agent-1",
          status: "succeeded",
          artifacts: {
            dir: "agents/agent-1",
            promptPath: "agents/agent-1/prompt.txt",
            stdoutPath: "agents/agent-1/stdout.log",
            stderrPath: "agents/agent-1/stderr.log"
          },
          retry: {
            enabled: true,
            exhausted: false,
            maxAttempts: 3,
            attemptsStarted: 2,
            finalAttempt: 2,
            summaryPath: "agents/agent-1/retry-summary.json",
            attempts: [
              {
                attempt: 1,
                status: "failed",
                retryable: true,
                failureReason: "provider_error",
                startedAt: "start-1",
                completedAt: "finish-1",
                durationMs: 10,
                computedDelayBeforeNextAttemptMs: 1000,
                artifactPath: "agents/agent-1/attempts/1"
              },
              {
                attempt: 2,
                status: "succeeded",
                retryable: false,
                startedAt: "start-2",
                completedAt: "finish-2",
                durationMs: 15,
                artifactPath: "agents/agent-1/attempts/2"
              }
            ]
          }
        }
      ]
    };

    reporter.finish(resultWithRetry as any);

    const output = getStdout();
    expect(output.trim().split("\n")).toHaveLength(JSON.stringify(resultWithRetry, null, 2).split("\n").length);
    const parsed = JSON.parse(output.trim());
    expect(parsed.agents[0].retry.summaryPath).toBe("agents/agent-1/retry-summary.json");
    expect(parsed.agents[0].retry.attemptsStarted).toBe(2);
    expect(parsed.agents[0].retry.attempts[0]).toMatchObject({
      attempt: 1,
      failureReason: "provider_error"
    });
  });

  it("finish() output includes workflow summaries", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);

    const resultWithWorkflows = {
      ...dummyResult,
      workflows: [
        {
          workflowInvocationId: "wf-1",
          workflowName: "child",
          status: "succeeded",
          depth: 1,
          startedAt: "start",
          finishedAt: "finish",
          durationMs: 50
        }
      ]
    };

    reporter.finish(resultWithWorkflows as any);

    const output = getStdout();
    const parsed = JSON.parse(output.trim());
    expect(parsed.workflows).toHaveLength(1);
    expect(parsed.workflows[0].workflowName).toBe("child");
  });

  it("verbose result block in stderr includes parse warnings", () => {
    const { streams, getStderr } = createMockStreams();
    const reporter = new JsonReporter(streams, { verbose: true });

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
