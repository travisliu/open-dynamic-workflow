import { describe, it, expect } from "vitest";
import { renderPrettyView } from "../../../src/output/pretty-renderer.js";
import type { PrettyRunView } from "../../../src/output/pretty-view.js";

describe("PrettyRenderer - Loops", () => {
  it("should render a loop node", () => {
    const view: PrettyRunView = {
      header: { name: "loop-test" },
      execution: [
        {
          id: "loop-1",
          kind: "loop",
          label: "review-loop",
          status: "succeeded",
          durationMs: 1500,
          roundCount: 3,
          maxRounds: 5,
          reason: "done"
        }
      ],
      summary: {
        status: "succeeded",
        durationMs: 2000,
        workflowCounts: { succeeded: 1, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 1 },
        agentCounts: { succeeded: 3, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 3 },
        loopCounts: { succeeded: 1, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 1 }
      },
      artifacts: {
        rootDir: "/tmp/run",
        failedSubpaths: []
      },
      failureRecords: []
    };

    const output = renderPrettyView(view);
    expect(output).toContain("✓ loop review-loop  3/5 rounds  done  1.5s");
    expect(output).toContain("loops:     1 succeeded");
  });

  it("should render a loop with a cached tool node", () => {
    const view: PrettyRunView = {
      header: { name: "loop-test" },
      execution: [
        {
          id: "loop-1",
          kind: "loop",
          label: "review-loop",
          status: "succeeded",
          durationMs: 1500,
          roundCount: 3,
          maxRounds: 5,
          reason: "done",
          children: [
            {
              id: "tool-1",
              kind: "tool",
              label: "my-tool",
              status: "succeeded",
              cached: true
            }
          ]
        }
      ],
      summary: {
        status: "succeeded",
        durationMs: 2000,
        workflowCounts: { succeeded: 1, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 1 },
        agentCounts: { succeeded: 0, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 0 },
        loopCounts: { succeeded: 1, failed: 0, timed_out: 0, cancelled: 0, skipped: 0, total: 1 }
      },
      artifacts: {
        rootDir: "/tmp/run",
        failedSubpaths: []
      },
      failureRecords: []
    };

    const output = renderPrettyView(view);
    expect(output).toContain("✓ loop review-loop  3/5 rounds  done  1.5s");
    expect(output).toContain("my-tool (cache)");
  });
});
