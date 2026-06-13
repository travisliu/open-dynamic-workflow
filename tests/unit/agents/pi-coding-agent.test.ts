import { describe, expect, it } from "vitest";
import { PiCodingAgentAdapter } from "../../../src/agents/pi-coding-agent.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("PiCodingAgentAdapter", () => {
  const defaultInput: AgentRunInput = {
    id: "run-1",
    provider: "pi",
    prompt: "review",
    cwd: "/repo",
    timeoutMs: 1000,
    env: { PATH: "/bin" },
    permissions: { mode: "default" }
  };

  describe("buildCommand", () => {
    it("37. builds default JSON command with safe one-shot flags", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();

      // Act
      const cmd = await adapter.buildCommand(defaultInput);

      // Assert
      expect(cmd.command).toBe("pi");
      expect(cmd.args.slice(0, 2)).toEqual(["--mode", "json"]);
      expect(cmd.args).toContain("--no-session");
      expect(cmd.args).toContain("--no-context-files");
      expect(cmd.args).toContain("--no-approve");
      expect(cmd.args).toContain("--tools");
      expect(cmd.args[cmd.args.indexOf("--tools") + 1]).toBe("read,grep,find,ls");
      expect(cmd.args[cmd.args.length - 1]).toBe("review");
    });

    it("38. omits resource-disabling flags only when explicitly false", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter({
        noSession: false,
        noContextFiles: false
      });

      // Act
      const cmd = await adapter.buildCommand(defaultInput);

      // Assert
      expect(cmd.args).not.toContain("--no-session");
      expect(cmd.args).not.toContain("--no-context-files");
      expect(cmd.args).toContain("--no-extensions");
      expect(cmd.args).toContain("--no-skills");
    });

    it("39. applies approval mode variants", async () => {
      // Arrange
      const adapterApprove = new PiCodingAgentAdapter({ approvalMode: "approve" });
      const adapterNoApprove = new PiCodingAgentAdapter({ approvalMode: "no-approve" });
      const adapterOmit = new PiCodingAgentAdapter({ approvalMode: "omit" });

      // Act
      const cmdApprove = await adapterApprove.buildCommand(defaultInput);
      const cmdNoApprove = await adapterNoApprove.buildCommand(defaultInput);
      const cmdOmit = await adapterOmit.buildCommand(defaultInput);

      // Assert
      expect(cmdApprove.args).toContain("--approve");
      expect(cmdNoApprove.args).toContain("--no-approve");
      expect(cmdOmit.args).not.toContain("--approve");
      expect(cmdOmit.args).not.toContain("--no-approve");
    });

    it("40. switches tools for dangerous permissions without approving project trust", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const input: AgentRunInput = {
        ...defaultInput,
        permissions: { mode: "dangerously-full-access" }
      };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args[cmd.args.indexOf("--tools") + 1]).toBe("read,bash,edit,write,grep,find,ls");
      expect(cmd.args).not.toContain("--approve");
      expect(cmd.args).toContain("--no-approve");
      expect(cmd.args).toContain("--no-session");
    });

    it("41. maps Pi provider, model, thinking, and system prompt flags", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter({
        piProvider: "anthropic",
        thinking: "medium",
        systemPrompt: "system",
        appendSystemPrompt: "append"
      });
      const input: AgentRunInput = { ...defaultInput, model: "claude-sonnet-4" };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.args).toContain("--provider");
      expect(cmd.args[cmd.args.indexOf("--provider") + 1]).toBe("anthropic");
      expect(cmd.args).toContain("--model");
      expect(cmd.args[cmd.args.indexOf("--model") + 1]).toBe("claude-sonnet-4");
      expect(cmd.args).toContain("--thinking");
      expect(cmd.args[cmd.args.indexOf("--thinking") + 1]).toBe("medium");
      expect(cmd.args).toContain("--system-prompt");
      expect(cmd.args[cmd.args.indexOf("--system-prompt") + 1]).toBe("system");
      expect(cmd.args).toContain("--append-system-prompt");
      expect(cmd.args[cmd.args.indexOf("--append-system-prompt") + 1]).toBe("append");
    });

    it("42. supports stdin prompt mode", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter({ promptMode: "stdin" });
      const input: AgentRunInput = { ...defaultInput, prompt: "long prompt" };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.stdin).toBe("long prompt");
      expect(cmd.args[cmd.args.length - 1]).not.toBe("long prompt");
    });

    it("43. rejects native structured output", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const input: AgentRunInput = {
        ...defaultInput,
        schema: { type: "object" },
        structuredOutput: { transport: "native" }
      };

      // Act & Assert
      await expect(adapter.buildCommand(input)).rejects.toThrow(
        "Pi does not support structuredOutput.transport=\"native\" yet."
      );
    });

    it("44. filters env and adds deterministic Pi defaults", async () => {
      // Arrange
      const input: AgentRunInput = {
        ...defaultInput,
        env: {
          PATH: "/bin",
          OPENAI_API_KEY: "secret",
          CUSTOM_SECRET: "secret",
          PI_TELEMETRY: "custom"
        }
      };
      const adapter = new PiCodingAgentAdapter();

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.env?.PATH).toBe("/bin");
      expect(cmd.env?.OPENAI_API_KEY).toBeUndefined();
      expect(cmd.env?.CUSTOM_SECRET).toBeUndefined();
      expect(cmd.env?.PI_SKIP_VERSION_CHECK).toBe("1");
      expect(cmd.env?.PI_TELEMETRY).toBe("custom");
      expect(cmd.env?.PI_OFFLINE).toBeUndefined();
    });

    it("45. allows deterministic env defaults to be disabled", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter({ deterministicEnv: false });
      const input: AgentRunInput = { ...defaultInput, env: { PATH: "/bin" } };

      // Act
      const cmd = await adapter.buildCommand(input);

      // Assert
      expect(cmd.env?.PI_SKIP_VERSION_CHECK).toBeUndefined();
      expect(cmd.env?.PI_TELEMETRY).toBeUndefined();
      expect(cmd.env?.PI_OFFLINE).toBeUndefined();
    });

    it("AAV2-T005: builds print command when executionMode is print and args is undefined", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter({
        executionMode: "print"
      });

      // Act
      const cmd = await adapter.buildCommand(defaultInput);

      // Assert
      expect(cmd.args).toContain("--print");
      expect(cmd.args).not.toContain("--mode");
      expect(cmd.args).not.toContain("json");
    });
  });

  describe("parseResult", () => {
    const fixturesDir = join(__dirname, "../../fixtures/pi");

    it("46. parses final assistant text from agent_end", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const stdout = readFileSync(join(fixturesDir, "json-success.jsonl"), "utf8");

      // Act
      const result = await adapter.parseResult({ input: defaultInput, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe("Done");
      expect((result.raw as any).mode).toBe("json");
      expect((result.raw as any).events.length).toBeGreaterThan(0);
      expect(result.parseWarnings ?? []).toHaveLength(0);
    });

    it("47. parses final assistant text from turn_end and message_end", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const cases = [
        { stdout: '{"type":"turn_end","message":{"role":"assistant","content":"hello turn"}}', expected: "hello turn" },
        { stdout: '{"type":"message_end","message":{"role":"assistant","content":"hello message"}}', expected: "hello message" }
      ];

      for (const { stdout, expected } of cases) {
        // Act
        const result = await adapter.parseResult({ input: defaultInput, stdout, stderr: "", exitCode: 0 });
        // Assert
        expect(result.text).toBe(expected);
      }
    });

    it("48. joins Pi content array shapes and message update deltas", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const stdoutArray = '{"type":"agent_end","message":{"role":"assistant","content":["part1", "part2"]}}';
      const stdoutDeltas = [
        '{"type":"message_update","delta":{"text":"hello"}}',
        '{"type":"message_update","delta":{"text":" world"}}',
        '{"type":"turn_end"}'
      ].join("\n");
      const stdoutText = [
        '{"type":"message_update","text":"hello"}',
        '{"type":"message_update","text":" world"}'
      ].join("\n");
      const stdoutContent = [
        '{"type":"message_update","content":"hello"}',
        '{"type":"message_update","content":" world"}'
      ].join("\n");

      // Act & Assert
      const resArray = await adapter.parseResult({ input: defaultInput, stdout: stdoutArray, stderr: "", exitCode: 0 });
      expect(resArray.text).toBe("part1part2");

      const resDeltas = await adapter.parseResult({ input: defaultInput, stdout: stdoutDeltas, stderr: "", exitCode: 0 });
      expect(resDeltas.text).toBe("hello world");

      const resText = await adapter.parseResult({ input: defaultInput, stdout: stdoutText, stderr: "", exitCode: 0 });
      expect(resText.text).toBe("hello world");

      const resContent = await adapter.parseResult({ input: defaultInput, stdout: stdoutContent, stderr: "", exitCode: 0 });
      expect(resContent.text).toBe("hello world");
    });

    it("49. tolerates malformed JSONL lines while preserving valid events", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const stdout = readFileSync(join(fixturesDir, "json-malformed-line.jsonl"), "utf8");

      // Act
      const result = await adapter.parseResult({ input: defaultInput, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe("Recovered from malformed line");
      expect((result.raw as any).malformedLines).toContain("NOT_JSON_LINE");
      expect(result.parseWarnings?.[0]).toContain("Line 2 is malformed JSON");
    });

    it("50. warns when JSON event stream has no assistant message", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const stdout = readFileSync(join(fixturesDir, "json-no-assistant.jsonl"), "utf8");

      // Act
      const result = await adapter.parseResult({ input: defaultInput, stdout: stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe(stdout);
      expect(result.parseWarnings).toContain("Could not identify final assistant message in Pi JSON event stream");
    });

    it("51. extracts embedded structured JSON from final assistant text", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const stdout = readFileSync(join(fixturesDir, "json-embedded-structured-output.jsonl"), "utf8");

      // Act
      const result = await adapter.parseResult({ input: defaultInput, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.structuredJson).toEqual({ ok: true, message: "Success" });
    });

    it("52. parses print mode output as plain text", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter({ executionMode: "print" });
      const stdout = readFileSync(join(fixturesDir, "print-success.txt"), "utf8");

      // Act
      const result = await adapter.parseResult({ input: defaultInput, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe(stdout);
    });

    it("53. parses empty Pi stdout as warning", async () => {
      // Arrange
      const adapter = new PiCodingAgentAdapter();
      const stdout = "";

      // Act
      const result = await adapter.parseResult({ input: defaultInput, stdout, stderr: "", exitCode: 0 });

      // Assert
      expect(result.text).toBe("");
      expect(result.parseWarnings).toContain("Empty stdout");
    });
  });
});
