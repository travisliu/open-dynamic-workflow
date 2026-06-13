import { describe, expect, it } from "vitest";
import { AntigravityCliAdapter } from "../../../src/agents/antigravity-cli.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";

describe("AntigravityCliAdapter", () => {
  describe("buildCommand", () => {
    it("23. exposes provider name and builds safe default command", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
        prompt: "hello",
        cwd: "/repo",
        timeoutMs: 1000,
        env: { PATH: "/bin" },
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(adapter.name).toBe("antigravity");
      expect(cmd.command).toBe("agy");
      expect(cmd.args).toEqual(["-p", "hello", "--sandbox"]);
      expect(cmd.stdin).toBeUndefined();
    });

    it("24. preserves configured base args before prompt args", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter({
        command: "agy",
        args: ["--some-flag"],
        defaultModel: null,
        useSandboxByDefault: true,
        permissionPolicy: "sandbox"
      });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
        prompt: "hello",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).toEqual(["--some-flag", "-p", "hello", "--sandbox"]);
    });

    it("25. maps input model and custom model flag", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter({
        modelArg: { flag: "-m" }
      });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
        prompt: "hello",
        model: "Gemini 3.5 Flash (Low)",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).toContain("-m");
      expect(cmd.args[cmd.args.indexOf("-m") + 1]).toBe("Gemini 3.5 Flash (Low)");
    });

    it("26. rejects requested model when model selection is disabled", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter({ modelArg: false });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
        prompt: "hello",
        model: "model-a",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act & Assert
      await expect(adapter.buildCommand(input)).rejects.toThrow(
        /Model selection is not supported by this provider/
      );
    });

    it("27. maps dangerous permissions and suppresses sandbox", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
        prompt: "hello",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "dangerously-full-access" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).toContain("--dangerously-skip-permissions");
      expect(cmd.args).not.toContain("--sandbox");
    });

    it("28. supports stdin prompt mode without adding prompt flag", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter({
        promptMode: "stdin",
        useSandboxByDefault: true,
        permissionPolicy: "sandbox"
      });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
        prompt: "long prompt",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.stdin).toBe("long prompt");
      expect(cmd.args).not.toContain("-p");
      expect(cmd.args).toContain("--sandbox");
    });

    it("29. rejects unsafe default execution without sandbox or native policy", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter({
        useSandboxByDefault: false,
        permissionPolicy: undefined
      });
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
        prompt: "hello",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {},
        permissions: { mode: "default" }
      };

      // Act & Assert
      await expect(adapter.buildCommand(input)).rejects.toThrow(
        /Antigravity default execution requires sandbox or native policy/
      );
    });

    it("30. filters secret-like env vars", async () => {
      // Arrange
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
        prompt: "test",
        cwd: "/repo",
        timeoutMs: 1000,
        env: {
          PATH: "/bin",
          OPENAI_API_KEY: "secret",
          GEMINI_API_KEY: "secret",
          CUSTOM_TOKEN: "secret",
          CUSTOM_SECRET: "secret"
        },
        permissions: { mode: "default" }
      };
      const adapter = new AntigravityCliAdapter();

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.env).toHaveProperty("PATH");
      expect(cmd.env).not.toHaveProperty("OPENAI_API_KEY");
      expect(cmd.env).not.toHaveProperty("GEMINI_API_KEY");
      expect(cmd.env).not.toHaveProperty("CUSTOM_TOKEN");
      expect(cmd.env).not.toHaveProperty("CUSTOM_SECRET");
    });

    it("31. rejects native structured output", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter();
      const input: AgentRunInput = {
        id: "run-1",
        provider: "antigravity",
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
        "Antigravity does not support structuredOutput.transport=\"native\" yet."
      );
    });
  });

  describe("parseResult", () => {
    it("32. parses JSON stdout with known text fields", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter();
      const cases = [
        { stdout: '{"text":"ok"}', expected: "ok" },
        { stdout: '{"response":"ok"}', expected: "ok" },
        { stdout: '{"content":"ok"}', expected: "ok" }
      ];

      for (const { stdout, expected } of cases) {
        // Act
        const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });
        // Assert
        expect(result.text).toBe(expected);
        expect(result.json).toEqual(JSON.parse(stdout));
        expect(result.raw).toEqual(JSON.parse(stdout));
      }
    });

    it("33. parses arbitrary JSON object and array as structured data", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter();
      const cases = [
        '{"status":"ok","score":1}',
        '[{"status":"ok"}]'
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

    it("34. falls back to plaintext with malformed JSON warning", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter();
      const stdout = "plain agy output";

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe(stdout);
      expect(result.parseWarnings?.[0]).toContain("Malformed JSON");
    });

    it("35. extracts embedded fenced JSON from text output", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter();
      const stdout = 'Summary:\n```json\n{"ok":true}\n```';

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe(stdout);
      expect(result.structuredJson).toEqual({ ok: true });
    });

    it("36. parses empty stdout as empty text with warning", async () => {
      // Arrange
      const adapter = new AntigravityCliAdapter();
      const stdout = "\n\n";

      // Act
      const result = await adapter.parseResult({ input: {} as any, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe("");
      expect(result.parseWarnings).toContain("Empty stdout");
    });
  });
});
