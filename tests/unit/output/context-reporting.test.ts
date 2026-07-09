import { describe, expect, it } from "vitest";
import { JsonReporter } from "../../../src/output/json-reporter.js";
import { JsonlReporter } from "../../../src/output/jsonl-reporter.js";
import { PrettyReporter } from "../../../src/output/pretty-reporter.js";
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
        },
      } as any,
      stderr: {
        write(chunk: any) {
          stderrData += chunk.toString();
          return true;
        },
      } as any,
    },
    getStdout: () => stdoutData,
    getStderr: () => stderrData,
  };
}

describe("Context reporting", () => {
  it("writes a context event as exactly one JSONL line", () => {
    // Arrange
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonlReporter(streams);
    const event = {
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 7,
      timestamp: "2026-07-08T00:00:00.000Z",
      type: "context.path.set",
      payload: {
        scopeId: "scope-1",
        path: "secret.token",
        valuePreview: "[REDACTED]",
        truncated: false,
      },
    } as EventEnvelope;

    // Act
    reporter.handle(event);

    // Assert
    const output = getStdout();
    expect(output).toBe(JSON.stringify(event) + "\n");
    expect(output.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(output.trim())).toEqual(event);
  });

  it("preserves the context summary in the final JSON report", () => {
    // Arrange
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);
    const result = {
      schemaVersion: "open-dynamic-workflow.report.v1",
      runId: "run-1",
      status: "succeeded",
      meta: { name: "context-report", description: "report test" },
      agents: [],
      startedAt: "2026-07-08T00:00:00.000Z",
      finishedAt: "2026-07-08T00:00:01.000Z",
      durationMs: 1000,
      artifactsDir: "/tmp/run",
      reportPath: "/tmp/run/report.json",
      eventsPath: "/tmp/run/events.jsonl",
      context: {
        rootFinalArtifact: "context/root-final.json",
        summaryArtifact: "context/summary.json",
      },
    } as any;

    // Act
    reporter.finish(result);

    // Assert
    const parsed = JSON.parse(getStdout().trim());
    expect(parsed.context).toEqual(result.context);
    expect(parsed.context.rootFinalArtifact).toBe("context/root-final.json");
    expect(parsed.context.summaryArtifact).toBe("context/summary.json");
    expect(parsed.context.overlayCount).toBeUndefined();
  });

  it("renders a compact pretty summary for context artifacts", () => {
    // Arrange
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    const result = {
      schemaVersion: "open-dynamic-workflow.report.v1",
      runId: "run-1",
      status: "succeeded",
      meta: { name: "context-report", description: "report test" },
      agents: [],
      startedAt: "2026-07-08T00:00:00.000Z",
      finishedAt: "2026-07-08T00:00:01.000Z",
      durationMs: 1000,
      artifactsDir: "/tmp/run",
      reportPath: "/tmp/run/report.json",
      eventsPath: "/tmp/run/events.jsonl",
      context: {
        rootFinalArtifact: "context/root-final.json",
        summaryArtifact: "context/summary.json",
      },
    } as any;

    // Act
    reporter.finish(result);

    // Assert
    const output = getStdout();
    expect(output).toContain("Summary");
    expect(output).toContain("Artifacts");
    expect(output).toContain("context/root-final.json");
    expect(output).toContain("context/summary.json");
    expect(output).not.toContain("overlays");
    expect(output).not.toContain("conflicts");
    expect(output).not.toContain("rejected");
  });
});
