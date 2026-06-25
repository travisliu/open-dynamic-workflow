import { describe, expect, it } from "vitest";
import type {
  AgentVerboseCommandPayload,
  AgentVerboseResultPayload,
  EventEnvelope
} from "../../../src/output/events.js";
import { formatVerboseCommand } from "../../../src/output/verbose-formatter.js";

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
