import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GeminiCliAdapter } from "../../../src/agents/gemini-cli.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";

describe("GeminiCliAdapter", () => {
  it("declares provider-neutral capabilities", () => {
    const adapter = new GeminiCliAdapter();
    expect(adapter.capabilities()).toEqual({
      prompt: { transports: ["stdin", "argv"] },
      output: { formats: ["text", "json"] },
      structuredOutput: { modes: ["prompt", "validate-only"] },
      usage: { source: "none" },
      sessions: { modes: ["none"] },
      permissions: { modes: ["none"] }
    });
  });

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

  it("injects schema into the prompt by default when schema is provided", async () => {
    const adapter = new GeminiCliAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "gemini",
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
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args[1]).toContain("Return findings as JSON.");
    expect(cmd.args[1]).toContain("JSON Schema:");
    expect(cmd.args[1]).toContain('"findings"');
  });

  it("does not inject schema when structuredOutput.transport is validate-only", async () => {
    const adapter = new GeminiCliAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "gemini",
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
      env: { PATH: "/bin" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.args[1]).toBe("Return findings as JSON.");
  });

  it("rejects native structured output transport", async () => {
    const adapter = new GeminiCliAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "gemini",
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
      env: { PATH: "/bin" }
    };

    await expect(adapter.buildCommand(input)).rejects.toThrow(
      'Gemini does not support structuredOutput.transport="native" yet.'
    );
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

  it("health check passes a safe env with PATH but without API keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openflow-gemini-health-"));
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

      const adapter = new GeminiCliAdapter({ command });
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

  it("builds command with promptMode stdin", async () => {
    const adapter = new GeminiCliAdapter({
      command: "gemini",
      promptMode: "stdin"
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
    expect(cmd.command).toBe("gemini");
    expect(cmd.args).toEqual(["--output-format", "json"]);
    expect(cmd.stdin).toBe("generate a test");
  });

  it("parses JSON stdout with response field", async () => {
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
      stdout: '{"response": "hello from gemini via response", "stats": {}}',
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("hello from gemini via response");
    expect(parsed.json).toEqual({ response: "hello from gemini via response", stats: {} });
  });

  describe("structuredJson parsing", () => {
    it("envelope with text containing valid JSON", async () => {
      const adapter = new GeminiCliAdapter();
      const parseInput: ProviderParseInput = {
        input: { id: "1", provider: "gemini", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
        stdout: '{"text": "{\\"value\\": \\"hello\\"}"}',
        stderr: "",
        exitCode: 0
      };

      const parsed = await adapter.parseResult(parseInput);
      expect(parsed.text).toBe('{"value": "hello"}');
      expect(parsed.json).toEqual({ text: '{"value": "hello"}' });
      expect(parsed.structuredJson).toEqual({ value: "hello" });
    });

    it("envelope with text containing fenced JSON", async () => {
      const adapter = new GeminiCliAdapter();
      const parseInput: ProviderParseInput = {
        input: { id: "1", provider: "gemini", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
        stdout: '{"text": "```json\\n{\\"value\\": \\"hello\\"}\\n```"}',
        stderr: "",
        exitCode: 0
      };

      const parsed = await adapter.parseResult(parseInput);
      expect(parsed.text).toBe('```json\n{"value": "hello"}\n```');
      expect(parsed.json).toEqual({ text: '```json\n{"value": "hello"}\n```' });
      expect(parsed.structuredJson).toEqual({ value: "hello" });
    });

    it("envelope with response containing valid JSON", async () => {
      const adapter = new GeminiCliAdapter();
      const parseInput: ProviderParseInput = {
        input: { id: "1", provider: "gemini", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
        stdout: '{"response": "{\\"value\\": \\"helloresponse\\"}"}',
        stderr: "",
        exitCode: 0
      };

      const parsed = await adapter.parseResult(parseInput);
      expect(parsed.text).toBe('{"value": "helloresponse"}');
      expect(parsed.json).toEqual({ response: '{"value": "helloresponse"}' });
      expect(parsed.structuredJson).toEqual({ value: "helloresponse" });
    });

    it("envelope with response containing fenced JSON", async () => {
      const adapter = new GeminiCliAdapter();
      const parseInput: ProviderParseInput = {
        input: { id: "1", provider: "gemini", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
        stdout: '{"response": "```json\\n{\\"value\\": \\"helloresponse\\"}\\n```", "stats": {}}',
        stderr: "",
        exitCode: 0
      };

      const parsed = await adapter.parseResult(parseInput);
      expect(parsed.text).toBe('```json\n{"value": "helloresponse"}\n```');
      expect(parsed.json).toEqual({ response: '```json\n{"value": "helloresponse"}\n```', stats: {} });
      expect(parsed.structuredJson).toEqual({ value: "helloresponse" });
    });

    it("direct JSON payload object without text or response", async () => {
      const adapter = new GeminiCliAdapter();
      const parseInput: ProviderParseInput = {
        input: { id: "1", provider: "gemini", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
        stdout: '{"value": "hello", "extra": true}',
        stderr: "",
        exitCode: 0
      };

      const parsed = await adapter.parseResult(parseInput);
      expect(parsed.text).toBeUndefined();
      expect(parsed.json).toEqual({ value: "hello", extra: true });
      expect(parsed.structuredJson).toEqual({ value: "hello", extra: true });
    });

    it("envelope with non-JSON text", async () => {
      const adapter = new GeminiCliAdapter();
      const parseInput: ProviderParseInput = {
        input: { id: "1", provider: "gemini", prompt: "test", cwd: "", timeoutMs: 1, env: {} },
        stdout: '{"text": "not valid json"}',
        stderr: "",
        exitCode: 0
      };

      const parsed = await adapter.parseResult(parseInput);
      expect(parsed.text).toBe("not valid json");
      expect(parsed.json).toEqual({ text: "not valid json" });
      expect(parsed.structuredJson).toBeUndefined();
    });
  });
});
