import { describe, expect, it } from "vitest";
import type {
  AgentVerboseCommandPayload,
  AgentVerboseResultPayload,
  EventEnvelope
} from "../../../src/output/events.js";
import { formatVerboseCommand, renderVerboseEvent } from "../../../src/output/verbose-formatter.js";

describe("verbose event contracts", () => {
  it("survives JSON round-trip for agent.verbose.command", () => {
    const payload: AgentVerboseCommandPayload = {
      agentId: "agent-1",
      label: "verbose-review",
      provider: "mock",
      model: "gpt-4",
      cwd: "/repo",
      command: {
        command: "mock-process",
        args: ["verbose-review"],
        cwd: "/repo",
        stdin: "Review token [REDACTED]",
        env: {
          API_KEY: "[REDACTED]"
        }
      },
      prompt: "Review token [REDACTED]",
      artifacts: {
        dir: "agents/verbose-review",
        promptPath: "agents/verbose-review/prompt.txt",
        stdoutPath: "agents/verbose-review/stdout.txt",
        stderrPath: "agents/verbose-review/stderr.txt"
      },
      permissions: {
        read: ["/repo"],
        write: ["/repo/dist"],
        commands: ["curl"],
        env: ["*"]
      },
      metadata: {
        foo: "bar"
      }
    };

    const envelope: EventEnvelope<AgentVerboseCommandPayload> = {
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 1,
      timestamp: new Date().toISOString(),
      type: "agent.verbose.command",
      payload
    };

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json) as EventEnvelope<AgentVerboseCommandPayload>;

    expect(parsed.type).toBe("agent.verbose.command");
    expect(parsed.payload.agentId).toBe("agent-1");
    expect(parsed.payload.command?.command).toBe("mock-process");
    expect(parsed.payload.artifacts.dir).toBe("agents/verbose-review");
  });

  it("survives JSON round-trip for agent.verbose.result (success)", () => {
    const payload: AgentVerboseResultPayload = {
      agentId: "agent-1",
      provider: "mock",
      status: "succeeded",
      stdout: "mock stdout",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      normalized: {
        summary: "Review complete"
      },
      artifacts: {
        dir: "agents/verbose-review",
        promptPath: "agents/verbose-review/prompt.txt",
        stdoutPath: "agents/verbose-review/stdout.txt",
        stderrPath: "agents/verbose-review/stderr.txt"
      },
      permissions: {
        read: [],
        write: [],
        commands: [],
        env: []
      }
    };

    const envelope: EventEnvelope<AgentVerboseResultPayload> = {
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 2,
      timestamp: new Date().toISOString(),
      type: "agent.verbose.result",
      payload
    };

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json) as EventEnvelope<AgentVerboseResultPayload>;

    expect(parsed.type).toBe("agent.verbose.result");
    expect(parsed.payload.status).toBe("succeeded");
    expect((parsed.payload.normalized as any).summary).toBe("Review complete");
  });

  it("survives JSON round-trip for agent.verbose.result (failure)", () => {
    const payload: AgentVerboseResultPayload = {
      agentId: "agent-1",
      provider: "mock",
      status: "failed",
      stdout: "",
      stderr: "error output",
      exitCode: 1,
      durationMs: 5,
      error: {
        message: "Failed to execute",
        code: "EXEC_ERROR"
      },
      artifacts: {
        dir: "agents/verbose-review",
        promptPath: "agents/verbose-review/prompt.txt",
        stdoutPath: "agents/verbose-review/stdout.txt",
        stderrPath: "agents/verbose-review/stderr.txt"
      },
      permissions: {
        read: [],
        write: [],
        commands: [],
        env: []
      }
    };

    const envelope: EventEnvelope<AgentVerboseResultPayload> = {
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 3,
      timestamp: new Date().toISOString(),
      type: "agent.verbose.result",
      payload
    };

    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json) as EventEnvelope<AgentVerboseResultPayload>;

    expect(parsed.type).toBe("agent.verbose.result");
    expect(parsed.payload.status).toBe("failed");
    expect(parsed.payload.error?.message).toBe("Failed to execute");
  });

  it("supports string in normalized field", () => {
    const payload: AgentVerboseResultPayload = {
      agentId: "agent-1",
      provider: "mock",
      status: "succeeded",
      stdout: "some text",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      normalized: "just some text",
      artifacts: {
        dir: "agents/verbose-review",
        promptPath: "agents/verbose-review/prompt.txt",
        stdoutPath: "agents/verbose-review/stdout.txt",
        stderrPath: "agents/verbose-review/stderr.txt"
      },
      permissions: {
        read: [],
        write: [],
        commands: [],
        env: []
      }
    };

    const json = JSON.stringify(payload);
    const parsed = JSON.parse(json) as AgentVerboseResultPayload;
    expect(parsed.normalized).toBe("just some text");
  });
});

describe("verbose event formatter for thinkingEffort", () => {
  it("formats thinkingEffort when present in the payload", () => {
    const payload: AgentVerboseCommandPayload = {
      agentId: "agent-1",
      provider: "codex",
      cwd: "/repo",
      prompt: "test prompt",
      artifacts: {
        dir: "agents/agent-1",
        promptPath: "agents/agent-1/prompt.txt",
        stdoutPath: "agents/agent-1/stdout.txt",
        stderrPath: "agents/agent-1/stderr.txt"
      },
      permissions: { mode: "default" } as any,
      thinkingEffort: "high"
    };

    const formatted = formatVerboseCommand(payload);
    expect(formatted).toContain("Thinking effort: high");
  });

  it("omits thinkingEffort line when absent in the payload", () => {
    const payload: AgentVerboseCommandPayload = {
      agentId: "agent-1",
      provider: "codex",
      cwd: "/repo",
      prompt: "test prompt",
      artifacts: {
        dir: "agents/agent-1",
        promptPath: "agents/agent-1/prompt.txt",
        stdoutPath: "agents/agent-1/stdout.txt",
        stderrPath: "agents/agent-1/stderr.txt"
      },
      permissions: { mode: "default" } as any
    };

    const formatted = formatVerboseCommand(payload);
    expect(formatted).not.toContain("Thinking effort:");
  });
});

describe("verbose event formatter for retry events", () => {
  it("formats retry/attempt events correctly", () => {
    const attemptStarted = renderVerboseEvent({
      type: "agent.attempt.started",
      sequence: 1,
      timestamp: "12:00:00",
      payload: {
        agentId: "my-agent",
        label: "retry-wrapper",
        provider: "mock",
        model: "gpt-4",
        cwd: "/repo",
        metadata: { modelResolutionSource: "default" },
        attempt: 1,
        maxAttempts: 3,
        artifacts: { dir: "agents/my-agent/attempts/1" }
      }
    } as any);
    expect(attemptStarted).toContain("Agent attempt started: retry-wrapper (attempt 1/3)");

    const attemptCompleted = renderVerboseEvent({
      type: "agent.attempt.completed",
      sequence: 2,
      timestamp: "12:00:01",
      payload: {
        agentId: "my-agent",
        label: "retry-wrapper",
        provider: "mock",
        model: "gpt-4",
        cwd: "/repo",
        metadata: { modelResolutionSource: "default" },
        attempt: 1,
        maxAttempts: 3,
        status: "succeeded",
        durationMs: 1234,
        exitCode: 0,
        retryable: false,
        artifacts: {
          dir: "agents/my-agent/attempts/1",
          promptPath: "agents/my-agent/attempts/1/prompt.txt",
          stdoutPath: "agents/my-agent/attempts/1/stdout.log",
          stderrPath: "agents/my-agent/attempts/1/stderr.log"
        }
      }
    } as any);
    expect(attemptCompleted).toContain("Agent attempt completed: retry-wrapper (attempt 1) succeeded in 1.2s");

    const attemptFailed = renderVerboseEvent({
      type: "agent.attempt.failed",
      sequence: 3,
      timestamp: "12:00:02",
      payload: {
        agentId: "my-agent",
        label: "retry-wrapper",
        provider: "mock",
        model: "gpt-4",
        cwd: "/repo",
        metadata: { modelResolutionSource: "default" },
        attempt: 1,
        maxAttempts: 3,
        status: "failed",
        durationMs: 500,
        exitCode: 1,
        retryable: true,
        failureReason: "schema_validation_failed",
        error: { message: "JSON error" },
        artifacts: {
          dir: "agents/my-agent/attempts/1",
          promptPath: "agents/my-agent/attempts/1/prompt.txt",
          stdoutPath: "agents/my-agent/attempts/1/stdout.log",
          stderrPath: "agents/my-agent/attempts/1/stderr.log"
        }
      }
    } as any);
    expect(attemptFailed).toContain("Agent attempt failed: retry-wrapper (attempt 1) error: schema_validation_failed");
    expect(attemptFailed).toContain("Error: JSON error");

    const retryScheduled = renderVerboseEvent({
      type: "agent.retry.scheduled",
      sequence: 4,
      timestamp: "12:00:03",
      payload: {
        agentId: "my-agent",
        label: "retry-wrapper",
        provider: "mock",
        model: "gpt-4",
        cwd: "/repo",
        metadata: { modelResolutionSource: "default" },
        failedAttempt: 1,
        nextAttempt: 2,
        maxAttempts: 3,
        failureReason: "schema_validation_failed",
        computedDelayMs: 1000,
        delaySkipped: false,
        delayMs: 1000
      }
    } as any);
    expect(retryScheduled).toContain("Agent retry scheduled: retry-wrapper next attempt 2 in 1000ms");

    const retrySkipped = renderVerboseEvent({
      type: "agent.retry.skipped_delay",
      sequence: 5,
      timestamp: "12:00:04",
      payload: {
        agentId: "my-agent",
        label: "retry-wrapper",
        provider: "mock",
        model: "gpt-4",
        cwd: "/repo",
        metadata: { modelResolutionSource: "default" },
        failedAttempt: 1,
        nextAttempt: 2,
        maxAttempts: 3,
        failureReason: "schema_validation_failed",
        computedDelayMs: 1000,
        delaySkipped: true,
        delayMs: 1000
      }
    } as any);
    expect(retrySkipped).toContain("Agent retry skipped delay: retry-wrapper next attempt 2 (computed delay 1000ms)");

    const retryExhausted = renderVerboseEvent({
      type: "agent.retry.exhausted",
      sequence: 6,
      timestamp: "12:00:05",
      payload: { agentId: "my-agent", maxAttempts: 3, attemptsStarted: 3, finalFailureReason: "exhausted", error: { message: "Final error" } }
    } as any);
    expect(retryExhausted).toContain("Agent retry exhausted: my-agent max attempts 3 reached");
    expect(retryExhausted).toContain("Error: Final error");
  });
});

describe("verbose provider selection events", () => {
  it("formats provider-alias-resolved event with alias resolution text and chain ordering", () => {
    const outputWithChain = renderVerboseEvent({
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 1,
      timestamp: "12:00:00",
      type: "agent.provider-alias-resolved",
      payload: {
        agentId: "agent-1",
        requestedProvider: "alias-a",
        requestedProviderSource: "agent",
        providerAlias: "alias-a",
        providerAliasChain: ["alias-a", "alias-b", "concrete-provider"],
        providerAliasDigest: "hash",
        provider: "concrete-provider",
      },
    } as any);

    expect(outputWithChain).toContain("Provider alias resolved: alias-a -> concrete-provider");
    expect(outputWithChain).toContain("Alias chain: alias-a -> alias-b -> concrete-provider");
    expect(outputWithChain).toContain("  Event: #1 12:00:00");

    const outputNoChain = renderVerboseEvent({
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 2,
      timestamp: "12:00:01",
      type: "agent.provider-alias-resolved",
      payload: {
        agentId: "agent-1",
        requestedProvider: "alias-a",
        requestedProviderSource: "agent",
        providerAlias: "alias-a",
        providerAliasChain: [],
        providerAliasDigest: "hash",
        provider: "concrete-provider",
      },
    } as any);

    expect(outputNoChain).toContain("Provider alias resolved: alias-a -> concrete-provider");
    expect(outputNoChain).not.toContain("Alias chain:");
  });

  it("formats provider-setting-overridden event with model, retry, explicit null, and safe unexpected values", () => {
    // 1. Model override with explicit values
    const modelOverrideOutput = renderVerboseEvent({
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 3,
      timestamp: "12:00:02",
      type: "agent.provider-setting-overridden",
      payload: {
        agentId: "agent-1",
        provider: "concrete",
        setting: "model",
        selectedValue: "gpt-4",
        selectedSource: "cli",
        selectedSourcePath: "cli.model",
        overriddenValue: "gpt-3.5",
        overriddenSource: "providerAlias",
        overriddenSourcePath: "providerAliases.alias.model",
      },
    } as any);

    expect(modelOverrideOutput).toContain(
      'Override applied: cli.model="gpt-4" overrides providerAliases.alias.model="gpt-3.5"'
    );

    // 2. Explicit null value
    const nullOverrideOutput = renderVerboseEvent({
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 4,
      timestamp: "12:00:03",
      type: "agent.provider-setting-overridden",
      payload: {
        agentId: "agent-1",
        provider: "concrete",
        setting: "model",
        selectedValue: null,
        selectedSource: "cli",
        selectedSourcePath: "cli.model",
        overriddenValue: "gpt-3.5",
        overriddenSource: "providerAlias",
        overriddenSourcePath: "providerAliases.alias.model",
      },
    } as any);

    expect(nullOverrideOutput).toContain(
      'Override applied: cli.model=null overrides providerAliases.alias.model="gpt-3.5"'
    );

    // 3. Retry policy override (deterministic object serialization)
    const retryOverrideOutput = renderVerboseEvent({
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 5,
      timestamp: "12:00:04",
      type: "agent.provider-setting-overridden",
      payload: {
        agentId: "agent-1",
        provider: "concrete",
        setting: "retry",
        selectedValue: { enabled: true, maxAttempts: 2 },
        selectedSource: "cli",
        selectedSourcePath: "cli.retry",
        overriddenValue: { enabled: false, maxAttempts: 5 },
        overriddenSource: "providerAlias",
        overriddenSourcePath: "providerAliases.alias.retry",
      },
    } as any);

    expect(retryOverrideOutput).toContain(
      'Override applied: cli.retry={"enabled":true,"maxAttempts":2} overrides providerAliases.alias.retry={"enabled":false,"maxAttempts":5}'
    );

    // 4. Safe handling of unexpected/invalid values
    const invalidOverrideOutput = renderVerboseEvent({
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 6,
      timestamp: "12:00:05",
      type: "agent.provider-setting-overridden",
      payload: {
        agentId: "agent-1",
        provider: "concrete",
        setting: "timeoutMs",
        selectedValue: "[invalid]",
        selectedSource: "cli",
        selectedSourcePath: "cli.timeoutMs",
        overriddenValue: "[invalid]",
        overriddenSource: "providerAlias",
        overriddenSourcePath: "providerAliases.alias.timeoutMs",
      },
    } as any);

    expect(invalidOverrideOutput).toContain(
      'Override applied: cli.timeoutMs="[invalid]" overrides providerAliases.alias.timeoutMs="[invalid]"'
    );
  });
});
