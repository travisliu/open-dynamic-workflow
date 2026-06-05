import { describe, expect, it } from "vitest";
import { CodexExecAdapter } from "../../../src/agents/codex-exec.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";

describe("CodexExecAdapter", () => {
  it("builds default command", async () => {
    const adapter = new CodexExecAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.command).toBe("codex");
    expect(cmd.args).toEqual(["exec", "--json", "--ephemeral"]);
    expect(cmd.stdin).toBe("generate a test");
  });

  it("builds command with configured static args and model", async () => {
    const adapter = new CodexExecAdapter({
      command: "custom-codex",
      args: ["run", "--quiet"],
      defaultModel: "codex-large"
    });

    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.command).toBe("custom-codex");
    expect(cmd.args).toEqual(["run", "--quiet", "--model", "codex-large"]);
    expect(cmd.stdin).toBe("generate a test");
  });

  it("uses arg prompt mode when configured", async () => {
    const adapter = new CodexExecAdapter({
      command: "codex",
      promptMode: "arg"
    });

    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args).toEqual(["exec", "--json", "--ephemeral", "generate a test"]);
    expect(cmd.stdin).toBeUndefined();
  });

  it("supports model argument passed in run input", async () => {
    const adapter = new CodexExecAdapter({
      command: "codex"
    });

    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      model: "custom-model-v2",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args).toEqual(["exec", "--json", "--ephemeral", "--model", "custom-model-v2"]);
  });

  it("parses JSON stdout with text field", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: {
        id: "1",
        provider: "codex",
        prompt: "test",
        cwd: "",
        timeoutMs: 1,
        env: {}
      },
      stdout: '{"text": "hello from codex", "confidence": 0.9}',
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("hello from codex");
    expect(parsed.json).toEqual({ text: "hello from codex", confidence: 0.9 });
  });

  it("parses JSON stdout with arbitrary object", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: {
        id: "1",
        provider: "codex",
        prompt: "test",
        cwd: "",
        timeoutMs: 1,
        env: {}
      },
      stdout: '{"status": "ok", "items": [1, 2]}',
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBeUndefined();
    expect(parsed.json).toEqual({ status: "ok", items: [1, 2] });
  });

  it("falls back to text stdout and warns on malformed JSON", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: {
        id: "1",
        provider: "codex",
        prompt: "test",
        cwd: "",
        timeoutMs: 1,
        env: {}
      },
      stdout: "some raw output text",
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("some raw output text");
    expect(parsed.json).toBeUndefined();
    expect(parsed.parseWarnings?.[0]).toContain("Malformed JSON");
  });

  it("parses a JSONL event stream and returns the final plain-text agent_message.text", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
      stdout: [
        '{"type": "thread.started"}',
        '{"type": "item.completed", "item": {"type": "agent_message", "text": "First plain message"}}',
        '{"type": "item.completed", "item": {"type": "agent_message", "text": "Final plain text answer"}}',
        '{"type": "turn.completed"}'
      ].join("\n"),
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("Final plain text answer");
    expect(parsed.json).toBeUndefined();
    expect(parsed.raw).toEqual({
      format: "codex-jsonl",
      events: [
        { type: "thread.started" },
        { type: "item.completed", item: { type: "agent_message", text: "First plain message" } },
        { type: "item.completed", item: { type: "agent_message", text: "Final plain text answer" } },
        { type: "turn.completed" }
      ],
      selectedEventIndex: 2,
      selectedMessageText: "Final plain text answer"
    });
  });

  it("parses a JSONL event stream and returns the last JSON-shaped agent_message.text as both text and json", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
      stdout: [
        '{"type": "thread.started"}',
        '{"type": "item.completed", "item": {"type": "agent_message", "text": "{\\"result\\": \\"success\\"}"}}',
        '{"type": "turn.completed"}'
      ].join("\n"),
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe('{"result": "success"}');
    expect(parsed.json).toEqual({ result: "success" });
  });

  it("ignores non-message events such as thread.started, turn.started, command_execution, and turn.completed", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
      stdout: [
        '{"type": "thread.started"}',
        '{"type": "turn.started"}',
        '{"type": "command_execution", "command": "ls"}',
        '{"type": "turn.completed"}'
      ].join("\n"),
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe(parseInput.stdout);
    expect(parsed.json).toBeUndefined();
    expect(parsed.parseWarnings).toContain("No agent_message event found in JSONL stream");
  });

  it("prefers the last JSON-shaped agent_message.text when multiple agent messages exist", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
      stdout: [
        '{"type": "thread.started"}',
        '{"type": "item.completed", "item": {"type": "agent_message", "text": "{\\"v\\": 1}"}}',
        '{"type": "item.completed", "item": {"type": "agent_message", "text": "{\\"v\\": 2}"}}',
        '{"type": "item.completed", "item": {"type": "agent_message", "text": "some plaintext that is not json"}}',
        '{"type": "turn.completed"}'
      ].join("\n"),
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe('{"v": 2}');
    expect(parsed.json).toEqual({ v: 2 });
  });

  it("falls back to stdout with a warning when JSONL exists but no agent_message is present", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
      stdout: [
        '{"type": "thread.started"}',
        '{"type": "turn.completed"}'
      ].join("\n"),
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe(parseInput.stdout);
    expect(parsed.parseWarnings).toContain("No agent_message event found in JSONL stream");
  });

  it("preserves warnings when one or more JSONL lines are malformed but other lines still parse", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
      stdout: [
        '{"type": "thread.started"}',
        'this is a malformed json line',
        '{"type": "item.completed", "item": {"type": "agent_message", "text": "hello from valid line"}}',
        '{"type": "turn.completed"}'
      ].join("\n"),
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("hello from valid line");
    expect(parsed.parseWarnings?.[0]).toContain("Line 2 is malformed JSON");
  });

  it("health check reports missing command clearly", async () => {
    const adapter = new CodexExecAdapter({
      command: "missing-codex-binary-xyz"
    });

    const health = await adapter.checkHealth();
    expect(health.available).toBe(false);
    expect(health.command).toBe("missing-codex-binary-xyz");
    expect(health.message).toContain("is not available");
  });
});
