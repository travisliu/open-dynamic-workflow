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
    schemaVersion: "execflow.report.v1",
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

  it("warn() writes to stderr, not stdout", () => {
    const { streams, getStdout, getStderr } = createMockStreams();
    const reporter = new JsonReporter(streams);

    reporter.warn("low disk");

    expect(getStdout()).toBe("");
    expect(getStderr()).toBe("warning: low disk\n");
  });
});
