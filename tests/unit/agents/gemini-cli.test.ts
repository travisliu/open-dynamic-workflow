import { describe, expect, it } from "vitest";
import { GeminiCliAdapter } from "../../../src/agents/gemini-cli.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";

describe("GeminiCliAdapter", () => {
  it("builds default command", async () => {
    const adapter = new GeminiCliAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "gemini",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.command).toBe("gemini");
    expect(cmd.args).toEqual(["-p", "generate a test", "--output-format", "json"]);
    expect(cmd.stdin).toBeUndefined();
  });

  it("builds command with configured output format and model", async () => {
    const adapter = new GeminiCliAdapter({
      command: "custom-gemini",
      args: ["--format", "json-pretty"],
      defaultModel: "gemini-1.5"
    });

    const input: AgentRunInput = {
      id: "run-1",
      provider: "gemini",
      prompt: "generate a test",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.command).toBe("custom-gemini");
    expect(cmd.args).toEqual(["-p", "generate a test", "--format", "json-pretty", "-m", "gemini-1.5"]);
  });

  it("includes model argument when model is set in input", async () => {
    const adapter = new GeminiCliAdapter({
      command: "gemini",
      modelFlag: "--model-id"
    });

    const input: AgentRunInput = {
      id: "run-1",
      provider: "gemini",
      prompt: "generate a test",
      model: "gemini-ultra",
      cwd: "/root",
      timeoutMs: 1000,
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args).toEqual(["-p", "generate a test", "--output-format", "json", "--model-id", "gemini-ultra"]);
  });

  it("parses JSON stdout with text field", async () => {
    const adapter = new GeminiCliAdapter();
    const parseInput: ProviderParseInput = {
      input: {
        id: "1",
        provider: "gemini",
        prompt: "test",
        cwd: "",
        timeoutMs: 1,
        env: {}
      },
      stdout: '{"text": "hello from gemini", "tokens": 12}',
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("hello from gemini");
    expect(parsed.json).toEqual({ text: "hello from gemini", tokens: 12 });
  });

  it("parses JSON stdout with arbitrary object", async () => {
    const adapter = new GeminiCliAdapter();
    const parseInput: ProviderParseInput = {
      input: {
        id: "1",
        provider: "gemini",
        prompt: "test",
        cwd: "",
        timeoutMs: 1,
        env: {}
      },
      stdout: '{"output": "ok", "items": [1, 2]}',
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBeUndefined();
    expect(parsed.json).toEqual({ output: "ok", items: [1, 2] });
  });

  it("falls back to text stdout and warns on malformed JSON", async () => {
    const adapter = new GeminiCliAdapter();
    const parseInput: ProviderParseInput = {
      input: {
        id: "1",
        provider: "gemini",
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

  it("health check reports missing command clearly", async () => {
    const adapter = new GeminiCliAdapter({
      command: "missing-gemini-binary-xyz"
    });

    const health = await adapter.checkHealth();
    expect(health.available).toBe(false);
    expect(health.command).toBe("missing-gemini-binary-xyz");
    expect(health.message).toContain("is not available");
  });
});
