import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
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
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.command).toBe("custom-codex");
    expect(cmd.args).toEqual(["run", "--quiet", "--model", "codex-large"]);
    expect(cmd.stdin).toBe("generate a test");
  });

  it("injects schema into stdin by default when schema is provided", async () => {
    const adapter = new CodexExecAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "Return findings as JSON.",
      schema: {
        type: "object",
        properties: {
          findings: { type: "array" }
        },
        required: ["findings"]
      },
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.stdin).toContain("Return findings as JSON.");
    expect(cmd.stdin).toContain("JSON Schema:");
    expect(cmd.stdin).toContain('"findings"');
  });

  it("does not inject schema when structuredOutput.transport is validate-only", async () => {
    const adapter = new CodexExecAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "Return findings as JSON.",
      schema: {
        type: "object",
        properties: {
          findings: { type: "array" }
        },
        required: ["findings"]
      },
      structuredOutput: { transport: "validate-only" },
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.stdin).toBe("Return findings as JSON.");
  });

  it("rejects native structured output transport", async () => {
    const adapter = new CodexExecAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "Return findings as JSON.",
      schema: {
        type: "object",
        properties: {
          findings: { type: "array" }
        },
        required: ["findings"]
      },
      structuredOutput: { transport: "native" },
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
    };

    await expect(adapter.buildCommand(input)).rejects.toThrow(
      'Codex does not support structuredOutput.transport="native" yet.'
    );
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
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
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
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
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
        env: {},
        permissions: { mode: "default" }
      },
      stdout: '{"text": "hello from codex", "confidence": 0.9}',
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("hello from codex");
    expect(parsed.json).toEqual({ text: "hello from codex", confidence: 0.9 });
    expect(parsed.structuredJson).toBeUndefined();
  });

  it("parses JSON stdout with text field containing valid JSON", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {}, permissions: { mode: "default" } },
      stdout: '{"text": "{\\"value\\": \\"hello\\"}", "confidence": 0.9}',
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe('{"value": "hello"}');
    expect(parsed.json).toEqual({ text: '{"value": "hello"}', confidence: 0.9 });
    expect(parsed.structuredJson).toEqual({ value: "hello" });
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
        env: {},
        permissions: { mode: "default" }
      },
      stdout: '{"status": "ok", "items": [1, 2]}',
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBeUndefined();
    expect(parsed.json).toEqual({ status: "ok", items: [1, 2] });
    expect(parsed.structuredJson).toEqual({ status: "ok", items: [1, 2] });
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
        env: {},
        permissions: { mode: "default" }
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
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {}, permissions: { mode: "default" } },
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
    expect(parsed.structuredJson).toBeUndefined();
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
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {}, permissions: { mode: "default" } },
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
    expect(parsed.structuredJson).toEqual({ result: "success" });
  });

  it("ignores non-message events such as thread.started, turn.started, command_execution, and turn.completed", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {}, permissions: { mode: "default" } },
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
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {}, permissions: { mode: "default" } },
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
    expect(parsed.structuredJson).toEqual({ v: 2 });
  });

  it("falls back to stdout with a warning when JSONL exists but no agent_message is present", async () => {
    const adapter = new CodexExecAdapter();
    const parseInput: ProviderParseInput = {
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {}, permissions: { mode: "default" } },
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
      input: { id: "1", provider: "codex", prompt: "test", cwd: "", timeoutMs: 1, env: {}, permissions: { mode: "default" } },
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

  it("health check passes a safe env with PATH but without API keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-codex-health-"));
    const command = join(dir, "health-check");
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "should-not-leak";

    try {
      await writeFile(
        command,
        [
          "#!/usr/bin/env node",
          "if (!process.env.PATH) { console.error('missing PATH'); process.exit(2); }",
          "if (process.env.OPENAI_API_KEY) { console.error('secret leaked'); process.exit(3); }",
          "process.exit(0);",
          ""
        ].join("\n"),
        "utf8"
      );
      await chmod(command, 0o755);

      const adapter = new CodexExecAdapter({ command });
      const health = await adapter.checkHealth();

      expect(health.available).toBe(true);
    } finally {
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not add write-capable flags when permissions are default or omitted", async () => {
    const adapter = new CodexExecAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("adds --dangerously-bypass-approvals-and-sandbox when permissions.mode is dangerously-full-access", async () => {
    const adapter = new CodexExecAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" },
      permissions: { mode: "dangerously-full-access" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("health check passes a safe env with PATH but without API keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-codex-health-"));
    const command = join(dir, "health-check");
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "should-not-leak";

    try {
      await writeFile(
        command,
        [
          "#!/usr/bin/env node",
          "if (!process.env.PATH) { console.error('missing PATH'); process.exit(2); }",
          "if (process.env.OPENAI_API_KEY) { console.error('secret leaked'); process.exit(3); }",
          "process.exit(0);",
          ""
        ].join("\n"),
        "utf8"
      );
      await chmod(command, 0o755);

      const adapter = new CodexExecAdapter({ command });
      const health = await adapter.checkHealth();

      expect(health.available).toBe(true);
    } finally {
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not add write-capable flags when permissions are default or omitted", async () => {
    const adapter = new CodexExecAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" },
      permissions: { mode: "default" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("adds --dangerously-bypass-approvals-and-sandbox when permissions.mode is dangerously-full-access", async () => {
    const adapter = new CodexExecAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" },
      permissions: { mode: "dangerously-full-access" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("adds thinking effort command arguments when thinkingEffort is specified", async () => {
    const efforts = ["minimal", "low", "medium", "high"] as const;
    for (const effort of efforts) {
      const adapter = new CodexExecAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "codex",
        prompt: "generate a test",
        cwd: "/root",
        timeoutMs: 1000,
        env: { PATH: "/bin" },
        permissions: { mode: "default" },
        thinkingEffort: effort
      };

      const cmd = await adapter.buildCommand(input);
      expect(cmd.args).toContain("-c");
      expect(cmd.args).toContain(`model_reasoning_effort="${effort}"`);
    }
  });

  it("throws THINKING_EFFORT_VALUE_UNSUPPORTED when thinkingEffort is off or xhigh", async () => {
    const invalidEfforts = ["off", "xhigh"] as const;
    for (const effort of invalidEfforts) {
      const adapter = new CodexExecAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "codex",
        prompt: "generate a test",
        cwd: "/root",
        timeoutMs: 1000,
        env: { PATH: "/bin" },
        permissions: { mode: "default" },
        thinkingEffort: effort as any
      };

      await expect(adapter.buildCommand(input)).rejects.toThrow();
    }
  });

  it("places explicit effort after conflicting base config args", async () => {
    const adapter = new CodexExecAdapter({
      args: ["exec", "-c", 'model_reasoning_effort="low"']
    });
    const input: AgentRunInput = {
      id: "run-1",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" },
      permissions: { mode: "default" },
      thinkingEffort: "high"
    };

    const cmd = await adapter.buildCommand(input);
    const indices: number[] = [];
    cmd.args.forEach((val, idx) => {
      if (val === "-c") indices.push(idx);
    });
    expect(indices.length).toBe(2);
    expect(cmd.args[indices[0] + 1]).toBe('model_reasoning_effort="low"');
    expect(cmd.args[indices[1] + 1]).toBe('model_reasoning_effort="high"');
    expect(indices[1]).toBeGreaterThan(indices[0]);
  });
});
