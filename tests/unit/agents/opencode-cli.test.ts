import { describe, expect, it, vi } from "vitest";
import { OpenCodeCliAdapter } from "../../../src/agents/opencode-cli.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";
import * as processRunner from "../../../src/agents/process-runner.js";

vi.mock("../../../src/agents/process-runner.js", () => ({
  runProcess: vi.fn()
}));

describe("OpenCodeCliAdapter", () => {
  describe("buildCommand", () => {
    it("1. builds default non-interactive JSON command", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "review code",
        cwd: "/repo",
        timeoutMs: 1000,
        env: { PATH: "/bin" },
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.command).toBe("opencode");
      expect(cmd.cwd).toBe("/repo");
      expect(cmd.args).toEqual(["run", "--format", "json", "--dir", "/repo", "review code"]);
      expect(cmd.env).toHaveProperty("OPENCODE_CONFIG_CONTENT");
      expect(JSON.parse(cmd.env!.OPENCODE_CONFIG_CONTENT!).permission.edit).toBe("deny");
    });

    it("2. preserves configured command and base args before adapter args", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter({
        command: "custom-opencode",
        args: ["--pure", "run", "--format", "json"],
        defaultModel: null
      });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "review code",
        cwd: "/repo",
        timeoutMs: 1000,
        env: { PATH: "/bin" },
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.command).toBe("custom-opencode");
      expect(cmd.args.slice(0, 4)).toEqual(["--pure", "run", "--format", "json"]);
      expect(cmd.args).toContain("--dir");
      expect(cmd.args).toContain("/repo");
      expect(cmd.args[cmd.args.length - 1]).toBe("review code");
    });

    it("3. respects dirFlag: false", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter({
        command: "opencode",
        args: ["run", "--format", "json"],
        dirFlag: false,
        defaultModel: null
      });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "review code",
        cwd: "/repo",
        timeoutMs: 1000,
        env: { PATH: "/bin" },
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.cwd).toBe("/repo");
      expect(cmd.args).not.toContain("--dir");
      expect(cmd.args).not.toContain("/repo");
      expect(cmd.args[cmd.args.length - 1]).toBe("review code");
    });

    it("4. maps input model through the default model flag", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        model: "anthropic/claude-sonnet-4-5",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).toContain("--model");
      expect(cmd.args[cmd.args.indexOf("--model") + 1]).toBe("anthropic/claude-sonnet-4-5");
    });

    it("5. maps custom model arg and rejects disabled model selection", async () => {
      // Arrange
      const adapterCustom = new OpenCodeCliAdapter({ modelArg: { flag: "-m" } });
      const adapterDisabled = new OpenCodeCliAdapter({ modelArg: false });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        model: "provider/model",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act & Assert
      const cmdCustom = await adapterCustom.buildCommand(input);
      expect(cmdCustom.args).toContain("-m");
      expect(cmdCustom.args[cmdCustom.args.indexOf("-m") + 1]).toBe("provider/model");

      await expect(adapterDisabled.buildCommand(input)).rejects.toThrow(
        /Model selection is not supported by this provider/
      );
    });

    it("6. applies default agent and metadata agent override", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter({ defaultAgent: "reviewer" });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        metadata: { opencodeAgent: "fixer" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).toContain("--agent");
      expect(cmd.args[cmd.args.indexOf("--agent") + 1]).toBe("fixer");
      expect(cmd.args).not.toContain("reviewer");
    });

    it("7. applies default variant and metadata variant override", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter({ defaultVariant: "low" });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        metadata: { opencodeVariant: "high" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).toContain("--variant");
      expect(cmd.args[cmd.args.indexOf("--variant") + 1]).toBe("high");
      expect(cmd.args).not.toContain("low");
    });

    it("8. injects schema instructions for prompt-based structured output", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "review code",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        schema: { type: "object", properties: { findings: { type: "array" } } }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      const prompt = cmd.args[cmd.args.length - 1];
      expect(prompt).toContain("review code");
      expect(prompt).toContain("JSON Schema:");
      expect(prompt).toContain("findings");
    });

    it("9. does not inject schema for validate-only structured output", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "review code",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        schema: { type: "object", properties: { findings: { type: "array" } } },
        structuredOutput: { transport: "validate-only" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args[cmd.args.length - 1]).toBe("review code");
    });

    it("10. rejects native structured output before command construction completes", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        schema: { type: "object" },
        structuredOutput: { transport: "native" }
      };

      // Act & Assert
      await expect(adapter.buildCommand(input)).rejects.toThrow(
        "OpenCode does not support structuredOutput.transport=\"native\" yet."
      );
    });

    it("11. rejects unsupported stdin prompt mode", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter({ promptMode: "stdin" });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act & Assert
      await expect(adapter.buildCommand(input)).rejects.toThrow(
        "OpenCode does not support promptMode=\"stdin\""
      );
    });

    it("12. filters secret-like env vars while preserving safe env vars", async () => {
      // Arrange
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {
          PATH: "/bin",
          OPENAI_API_KEY: "secret",
          GEMINI_API_KEY: "secret",
          CUSTOM_TOKEN: "secret",
          BUILD_ID: "123"
        },
        permissions: { mode: "default" }
      };
      const adapter = new OpenCodeCliAdapter();

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.env).toHaveProperty("PATH");
      expect(cmd.env).toHaveProperty("BUILD_ID");
      expect(cmd.env).not.toHaveProperty("OPENAI_API_KEY");
      expect(cmd.env).not.toHaveProperty("GEMINI_API_KEY");
      expect(cmd.env).not.toHaveProperty("CUSTOM_TOKEN");
      expect(cmd.env).toHaveProperty("OPENCODE_CONFIG_CONTENT");
    });

    it("13. maps dangerous permissions to OpenCode dangerous flag and skips read-only injection", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "dangerously-full-access" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).toContain("--dangerously-skip-permissions");
      expect(cmd.env).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
      expect(cmd.args[cmd.args.length - 1]).toBe("test");
    });

    it("14. honors passthrough permission policy", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter({ permissionPolicy: "passthrough" });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).not.toContain("--dangerously-skip-permissions");
      expect(cmd.env).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
    });

    it("maps thinkingEffort to --variant, mapping off to none", async () => {
      const mappings = [
        { effort: "off", expected: "none" },
        { effort: "minimal", expected: "minimal" },
        { effort: "low", expected: "low" },
        { effort: "medium", expected: "medium" },
        { effort: "high", expected: "high" },
        { effort: "xhigh", expected: "xhigh" }
      ] as const;

      for (const { effort, expected } of mappings) {
        const adapter = new OpenCodeCliAdapter();
        const input: AgentRunInput = {
          id: "run-1",
          provider: "opencode",
          prompt: "test",
          cwd: "/repo",
          timeoutMs: 1000,
          env: {},
          permissions: { mode: "default" },
          thinkingEffort: effort
        };

        const cmd = await adapter.buildCommand(input);
        expect(cmd.args).toContain("--variant");
        expect(cmd.args[cmd.args.indexOf("--variant") + 1]).toBe(expected);
      }
    });

    it("respects variantFlag customization", async () => {
      const adapter = new OpenCodeCliAdapter({ variantFlag: "-v" });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        thinkingEffort: "high"
      };

      const cmd = await adapter.buildCommand(input);
      expect(cmd.args).toContain("-v");
      expect(cmd.args[cmd.args.indexOf("-v") + 1]).toBe("high");
    });

    it("resolved effort overrides defaultVariant", async () => {
      const adapter = new OpenCodeCliAdapter({ defaultVariant: "low" });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        thinkingEffort: "high"
      };

      const cmd = await adapter.buildCommand(input);
      expect(cmd.args).toContain("--variant");
      expect(cmd.args[cmd.args.indexOf("--variant") + 1]).toBe("high");
      expect(cmd.args).not.toContain("low");
    });

    it("throws THINKING_EFFORT_CONFLICT when both thinkingEffort and metadata.opencodeVariant are set", async () => {
      const adapter = new OpenCodeCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        thinkingEffort: "high",
        metadata: { opencodeVariant: "low" }
      };

      await expect(adapter.buildCommand(input)).rejects.toThrow();
    });

    it("keeps legacy metadata/default variant behavior unchanged when thinkingEffort is absent", async () => {
      const adapter = new OpenCodeCliAdapter({ defaultVariant: "low" });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "opencode",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" },
        metadata: { opencodeVariant: "high" }
      };

      const cmd = await adapter.buildCommand(input);
      expect(cmd.args).toContain("--variant");
      expect(cmd.args[cmd.args.indexOf("--variant") + 1]).toBe("high");
      expect(cmd.args).not.toContain("low");
    });
  });

  describe("parseResult", () => {
    it("15. parses empty stdout as debuggable empty text", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const parseInput: ProviderParseInput = {
        input: {} as any,
        stdout: "   ",
        stderr: "",
        exitCode: 0
      };

      // Act
      const result = await adapter.parseResult(parseInput);

      // Assert
      expect(result.text).toBe("");
      expect(result.parseWarnings).toContain("Empty stdout");
    });

    it("16. parses whole JSON object text fields", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const cases = [
        { stdout: '{"text":"hello"}', expected: "hello" },
        { stdout: '{"content":"hello"}', expected: "hello" },
        { stdout: '{"message":"hello"}', expected: "hello" },
        { stdout: '{"output":"hello"}', expected: "hello" },
        { stdout: '{"result":"hello"}', expected: "hello" }
      ];

      for (const { stdout, expected } of cases) {
        // Act
        const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });
        // Assert
        expect(result.text).toBe(expected);
        expect(result.json).toEqual(JSON.parse(stdout));
        expect(result.structuredJson).toBeUndefined(); // Regression for AAV2-T002
        expect(result.raw).toEqual(JSON.parse(stdout));
      }
    });

    it("16b. parses whole JSON object text fields with embedded JSON", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const stdout = '{"text":"Here is results: ```json\\n{\\"ok\\":true}\\n```"}';

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toContain("Here is results");
      expect(result.structuredJson).toEqual({ ok: true });
    });

    it("17. parses arbitrary whole JSON object or array as structured JSON", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const cases = [
        '{"ok":true,"items":[1]}',
        '[{"ok":true}]'
      ];

      for (const stdout of cases) {
        // Act
        const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });
        // Assert
        expect(result.json).toEqual(JSON.parse(stdout));
        expect(result.structuredJson).toEqual(JSON.parse(stdout));
        expect(result.raw).toEqual(JSON.parse(stdout));
      }
    });

    it("18. extracts final assistant text from JSONL event stream", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const stdout = [
        '{"type": "status", "msg": "thinking"}',
        '{"type": "message_end", "message": { "role": "assistant", "content": "final answer" } }'
      ].join("\n");

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe("final answer");
      expect(result.raw.format).toBe("opencode-json-events");
      expect(result.raw.events).toHaveLength(2);
      expect(result.raw.selectedMessageText).toBe("final answer");
    });

    it("19. extracts embedded structured JSON from selected JSONL text", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const stdout = '{"type": "message_end", "message": { "role": "assistant", "content": "Here is the result: ```json\\n{\\"ok\\":true}\\n```" } }';

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toContain("Here is the result");
      expect(result.structuredJson).toEqual({ ok: true });
    });

    it("20. tolerates malformed JSONL lines and preserves valid events", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const stdout = [
        '{"type": "status", "msg": "ok"}',
        'malformed line',
        '{"type": "message_end", "message": { "role": "assistant", "content": "valid" } }'
      ].join("\n");

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe("valid");
      expect(result.parseWarnings?.[0]).toMatch(/Line 2 is malformed JSON/);
      expect(result.raw.events).toHaveLength(2);
    });

    it("21. warns on JSONL stream with only tool/status events", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const stdout = '{"type": "status", "msg": "thinking"}\n{"type": "tool_call", "tool": "ls"}';

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe(stdout);
      expect(result.raw.events).toHaveLength(2);
      expect(result.parseWarnings).toContain("No assistant message text found in JSONL stream");
    });

    it("22. falls back to plaintext on non-JSON stdout", async () => {
      // Arrange
      const adapter = new OpenCodeCliAdapter();
      const stdout = "plain terminal output";

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe(stdout);
      expect(result.parseWarnings?.[0]).toContain("Malformed JSON");
    });
  });
});
