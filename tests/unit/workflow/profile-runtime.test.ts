import { describe, expect, it } from "vitest";
import { DefaultRuntimeRunner } from "../../../src/workflow/runtime.js";
import { EventBus } from "../../../src/orchestration/event-bus.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig, CliRunOptions } from "../../../src/types/config.js";
import { ErrorCode } from "../../../src/errors/codes.js";

const defaultResolvedConfig: ResolvedConfig = {
  defaultProvider: "mock",
  concurrency: 2,
  timeoutMs: 30000,
  providers: {},
  security: {
    allowWorkflowImports: false,
    passEnv: [],
    redactEnv: []
  },
  reporting: {
    mode: "pretty",
    verbose: false
  },
  cwd: "/workspace",
  outDir: "/workspace/.open-dynamic-workflow/runs",
  cliArgs: {}
};

const defaultCliOptions: CliRunOptions = {
  workflowFile: "workflow.js",
  args: {},
  concurrency: 2,
  dryRun: false,
  failFast: false,
  verbose: false
};

const mockWorkflow = (body: string): ParsedWorkflow => ({
  meta: { name: "test-workflow", description: "test workflow", version: "1.0.0" },
  body,
  sourcePath: "workflow.js",
  sourceText: body,
  sourceHash: "123"
});

describe("Profile Runtime Context Seeding and Events", () => {
  const profileReport = {
    selected: "my-profile",
    source: "external" as const,
    profilesPath: "/workspace/profiles.yaml",
    hash: "abc123hash"
  };

  const profileContextSeed = {
    context: {
      mode: "test-mode",
      quality: { level: "high" }
    },
    metadata: {
      name: "my-profile",
      source: "external" as const,
      hasExternalFile: true,
      hash: "abc123hash"
    },
    reservedPath: "$profile" as const
  };

  it("first executable statement can read profile context and metadata", async () => {
    const runner = new DefaultRuntimeRunner();
    const body = `
      const mode = context.get("mode");
      const level = context.get("quality.level");
      const name = context.get("$profile.name");
      const hash = context.get("$profile.hash");
      export default { mode, level, name, hash };
    `;

    const result = await runner.run(
      {
        parsedWorkflow: mockWorkflow(body),
        config: defaultResolvedConfig,
        cli: defaultCliOptions,
        profileContextSeed,
        profileReport
      },
      {
        agentExecutor: { execute: async () => ({} as any) },
        eventSink: { emit: () => {} }
      }
    );

    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({
      mode: "test-mode",
      level: "high",
      name: "my-profile",
      hash: "abc123hash"
    });
    expect(result.profile).toEqual(profileReport);
  });

  it("profile.resolved appears before workflow evaluation/started/resolved, and sequence is monotonic", async () => {
    const runner = new DefaultRuntimeRunner();
    const body = `
      export default "ok";
    `;

    const events: any[] = [];
    const eventBus = new EventBus({
      runId: "run-1",
      artifactStore: {
        appendJsonl: async () => {}
      },
      subscribers: [{
        handle: (evt) => {
          events.push(evt);
        }
      }]
    });

    const result = await runner.run(
      {
        parsedWorkflow: mockWorkflow(body),
        workflowIdentity: {
          name: "test-workflow",
          file: "workflow.js",
          requestedTarget: "test-workflow",
          targetKind: "workflow-name",
          workflowFile: "workflow.js",
          workflowFileRelative: "workflow.js",
          discoverySource: "discovery"
        } as any,
        config: defaultResolvedConfig,
        cli: defaultCliOptions,
        profileContextSeed,
        profileReport
      },
      {
        agentExecutor: { execute: async () => ({} as any) },
        eventSink: eventBus
      }
    );

    expect(result.status).toBe("succeeded");
    await eventBus.drain();

    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain("profile.resolved");
    expect(eventTypes).toContain("workflow.resolved");
    expect(eventTypes).toContain("workflow.started");
    expect(eventTypes).toContain("workflow.completed");

    const profileResolvedIdx = eventTypes.indexOf("profile.resolved");
    const workflowResolvedIdx = eventTypes.indexOf("workflow.resolved");
    const workflowStartedIdx = eventTypes.indexOf("workflow.started");
    const workflowCompletedIdx = eventTypes.indexOf("workflow.completed");

    // Order check: profile.resolved < workflow.resolved < workflow.started < workflow.completed
    expect(profileResolvedIdx).toBeLessThan(workflowResolvedIdx);
    expect(workflowResolvedIdx).toBeLessThan(workflowStartedIdx);
    expect(workflowStartedIdx).toBeLessThan(workflowCompletedIdx);

    // Sequence numbers should be monotonic
    for (let i = 1; i < events.length; i++) {
      expect(events[i].sequence).toBe(events[i - 1].sequence + 1);
    }

    // Payload check
    const profileResolvedEvent = events[profileResolvedIdx];
    expect(profileResolvedEvent.payload).toEqual({ profile: profileReport });
  });

  it("forced seed validation failure prevents execution and returns failed status", async () => {
    const runner = new DefaultRuntimeRunner();
    const body = `
      export default "ok";
    `;

    const invalidSeed = {
      ...profileContextSeed,
      reservedPath: "invalid-reserved-path" as any
    };

    const events: any[] = [];
    const eventBus = new EventBus({
      runId: "run-failed-seed",
      artifactStore: {
        appendJsonl: async () => {}
      },
      subscribers: [{
        handle: (evt) => {
          events.push(evt);
        }
      }]
    });

    const result = await runner.run(
      {
        parsedWorkflow: mockWorkflow(body),
        config: defaultResolvedConfig,
        cli: defaultCliOptions,
        profileContextSeed: invalidSeed,
        profileReport
      },
      {
        agentExecutor: { execute: async () => ({} as any) },
        eventSink: eventBus
      }
    );

    await eventBus.drain();

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(ErrorCode.PROFILE_RESERVED_PATH);

    // No profile.resolved, workflow.started, etc. should have been emitted
    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toEqual(["workflow.failed"]);
  });

  it("retains profile metadata on failed and cancelled results; no-profile runs have none", async () => {
    const runner = new DefaultRuntimeRunner();

    // 1. Failed result retains metadata
    const failBody = `
      throw new Error("intentional fail");
    `;
    const failResult = await runner.run(
      {
        parsedWorkflow: mockWorkflow(failBody),
        config: defaultResolvedConfig,
        cli: defaultCliOptions,
        profileContextSeed,
        profileReport
      },
      {
        agentExecutor: { execute: async () => ({} as any) },
        eventSink: { emit: () => {} }
      }
    );
    expect(failResult.status).toBe("failed");
    expect(failResult.profile).toEqual(profileReport);

    // 2. Cancelled result retains metadata
    const successBody = `
      export default "ok";
    `;
    const abortController = new AbortController();
    abortController.abort("cancelled by user");
    const cancelResult = await runner.run(
      {
        parsedWorkflow: mockWorkflow(successBody),
        config: defaultResolvedConfig,
        cli: defaultCliOptions,
        profileContextSeed,
        profileReport,
        signal: abortController.signal
      },
      {
        agentExecutor: { execute: async () => ({} as any) },
        eventSink: { emit: () => {} }
      }
    );
    expect(cancelResult.status).toBe("cancelled");
    expect(cancelResult.profile).toEqual(profileReport);

    // 3. No-profile run has no profile property
    const noProfileResult = await runner.run(
      {
        parsedWorkflow: mockWorkflow(successBody),
        config: defaultResolvedConfig,
        cli: defaultCliOptions
      },
      {
        agentExecutor: { execute: async () => ({} as any) },
        eventSink: { emit: () => {} }
      }
    );
    expect(noProfileResult.status).toBe("succeeded");
    expect(noProfileResult.profile).toBeUndefined();
  });
});
