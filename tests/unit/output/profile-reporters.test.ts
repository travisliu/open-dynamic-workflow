import { describe, expect, it } from "vitest";
import { PrettyReporter } from "../../../src/output/pretty-reporter.js";
import { JsonReporter } from "../../../src/output/json-reporter.js";
import { JsonlReporter } from "../../../src/output/jsonl-reporter.js";
import type { WorkflowRunResult } from "../../../src/types/workflow.js";
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
    getStderr: () => stderrData,
    reset: () => {
      stdoutData = "";
      stderrData = "";
    }
  };
}

const dummyResult: Omit<WorkflowRunResult, "profile"> = {
  schemaVersion: "open-dynamic-workflow.report.v1",
  runId: "run-123",
  status: "succeeded",
  meta: { name: "my-flow", description: "" },
  agents: [],
  startedAt: "2026-07-09T23:00:00Z",
  finishedAt: "2026-07-09T23:01:00Z",
  durationMs: 60000,
  artifactsDir: "/tmp/artifacts",
  reportPath: "/tmp/artifacts/report.json",
  eventsPath: "/tmp/artifacts/events.jsonl",
};

describe("Profile Reporters - Pretty Output", () => {
  it("renders config profile correctly", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish({
      ...dummyResult,
      profile: {
        selected: "fast",
        source: "config",
        hash: "config-hash-123"
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("  profile:   fast (config)");
    expect(output).not.toContain("resolved");
    expect(output).not.toContain("SECRET_KEY");
  });

  it("renders external profile with path correctly", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish({
      ...dummyResult,
      profile: {
        selected: "deep",
        source: "external",
        profilesPath: "my-profiles.yaml",
        hash: "ext-hash-123"
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("  profile:   deep (external: my-profiles.yaml)");
    expect(output).not.toContain("resolved");
  });

  it("renders external override with path correctly", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish({
      ...dummyResult,
      profile: {
        selected: "deep",
        source: "external-override",
        profilesPath: "override-profiles.yaml",
        hash: "override-hash-123"
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("  profile:   deep (external override: override-profiles.yaml)");
  });

  it("renders recorded reuse correctly (with resumedFromRecordedProfile marker)", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish({
      ...dummyResult,
      profile: {
        selected: "deep",
        source: "recorded",
        hash: "rec-hash-123",
        resumedFromRecordedProfile: true
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("  profile:   deep (reused from recorded run input)");
  });

  it("renders recorded reuse correctly (without optional marker for older producers)", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish({
      ...dummyResult,
      profile: {
        selected: "deep",
        source: "recorded",
        hash: "rec-hash-123"
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("  profile:   deep (reused from recorded run input)");
  });

  it("renders external profile without path correctly", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish({
      ...dummyResult,
      profile: {
        selected: "deep",
        source: "external",
        hash: "ext-hash-no-path"
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("  profile:   deep (external)");
    expect(output).not.toContain("external:");
  });

  it("renders external override profile without path correctly", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish({
      ...dummyResult,
      profile: {
        selected: "deep",
        source: "external-override",
        hash: "override-hash-no-path"
      }
    } as any);

    const output = getStdout();
    expect(output).toContain("  profile:   deep (external override)");
    expect(output).not.toContain("external override:");
  });

  it("omits profile line completely when no profile is selected", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish(dummyResult as any);

    const output = getStdout();
    expect(output).not.toContain("profile:");
  });

  it("redacts secret-like sentinel values", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new PrettyReporter(streams);
    reporter.finish({
      ...dummyResult,
      profile: {
        selected: "fast",
        source: "config",
        hash: "config-hash-123",
        resolved: {
          args: { apiKey: "SECRET_API_KEY_12345" },
          context: { secret: "DONT_SHOW_THIS" },
          run: { model: "gpt-4" }
        }
      } as any
    } as any);

    const output = getStdout();
    expect(output).toContain("  profile:   fast (config)");
    expect(output).not.toContain("SECRET_API_KEY_12345");
    expect(output).not.toContain("DONT_SHOW_THIS");
    expect(output).not.toContain("resolved");
  });
});

describe("Profile Reporters - JSON Output", () => {
  it("includes compact profile metadata in JSON final output", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);

    const profileData = {
      selected: "deep",
      source: "external" as const,
      profilesPath: "my-profiles.yaml",
      hash: "ext-hash-123",
      resumedFromRecordedProfile: false
    };

    reporter.finish({
      ...dummyResult,
      profile: profileData
    } as any);

    const parsed = JSON.parse(getStdout());
    expect(parsed.profile).toBeDefined();
    expect(parsed.profile.selected).toBe("deep");
    expect(parsed.profile.source).toBe("external");
    expect(parsed.profile.profilesPath).toBe("my-profiles.yaml");
    expect(parsed.profile.hash).toBe("ext-hash-123");
    expect(parsed.profile.resumedFromRecordedProfile).toBe(false);
    expect(parsed.profile.resolved).toBeUndefined();
  });

  it("omits profile key in JSON final output when no profile is selected", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);

    reporter.finish(dummyResult as any);

    const parsed = JSON.parse(getStdout());
    expect(parsed.profile).toBeUndefined();
  });

  it("keeps profile contract locked to compact metadata without exposing resolved body", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonReporter(streams);

    const profileData = {
      selected: "deep",
      source: "external" as const,
      profilesPath: "my-profiles.yaml",
      hash: "ext-hash-123"
    };

    reporter.finish({
      ...dummyResult,
      profile: profileData
    } as any);

    const stdout = getStdout();
    const parsed = JSON.parse(stdout);
    expect(parsed.profile).toBeDefined();
    expect(parsed.profile.selected).toBe("deep");
    expect(parsed.profile.resolved).toBeUndefined();
  });
});

describe("Profile Reporters - JSONL Output", () => {
  it("serializes profile.resolved event envelope with compact profile metadata only", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonlReporter(streams);

    const event: EventEnvelope = {
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-123",
      sequence: 1,
      timestamp: "2026-07-09T23:00:00.000Z",
      type: "profile.resolved",
      payload: {
        profile: {
          selected: "fast",
          source: "config",
          hash: "config-hash-123"
        }
      }
    };

    reporter.handle(event);
    reporter.finish();

    const output = getStdout();
    const parsed = JSON.parse(output.trim());

    expect(parsed.type).toBe("profile.resolved");
    expect(parsed.payload.profile.selected).toBe("fast");
    expect(parsed.payload.profile.source).toBe("config");
    expect(parsed.payload.profile.hash).toBe("config-hash-123");
    expect(parsed.payload.profile.resolved).toBeUndefined();
  });

  it("does not add any extra finish() line in JSONL output", () => {
    const { streams, getStdout } = createMockStreams();
    const reporter = new JsonlReporter(streams);

    reporter.finish();
    expect(getStdout()).toBe("");
  });
});
