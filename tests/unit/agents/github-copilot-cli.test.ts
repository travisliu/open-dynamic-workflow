import { describe, it, expect, vi } from "vitest";
import { GitHubCopilotCliAdapter } from "../../../src/agents/github-copilot-cli.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import * as processRunner from "../../../src/agents/process-runner.js";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("../../../src/agents/process-runner.js");

function runInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    id: "copilot-test",
    provider: "copilot",
    prompt: "Review src/index.ts",
    timeoutMs: 1000,
    cwd: "/workspace",
    env: {},
    permissions: { mode: "default" },
    ...overrides
  };
}

function parseInput(stdout: string, overrides: Partial<ProviderParseInput> = {}): ProviderParseInput {
  return {
    input: runInput(),
    stdout,
    stderr: "",
    exitCode: 0,
    ...overrides
  };
}

function getFixture(name: string): string {
  return readFileSync(join(__dirname, "../../fixtures/copilot", name), "utf8");
}

describe("GitHubCopilotCliAdapter", () => {
  it("exposes the provider name 'copilot'", () => {
    const adapter = new GitHubCopilotCliAdapter();
    expect(adapter.name).toBe("copilot");
  });

  describe("checkHealth", () => {
    it("returns available: true when command exists", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      vi.mocked(processRunner.runProcess).mockResolvedValue({
        stdout: "GitHub Copilot CLI 1.2.3",
        stderr: "",
        exitCode: 0,
        durationMs: 100
      });

      const health = await adapter.checkHealth();
      expect(health.available).toBe(true);
      expect(health.provider).toBe("copilot");
      expect(health.command).toBe("copilot");
      expect(health.supportsModelSelection).toBe(true);
      expect(processRunner.runProcess).toHaveBeenCalledWith(expect.objectContaining({
        command: "copilot",
        args: ["--help"],
        timeoutMs: 2000
      }));
    });

    it("returns available: false when command fails", async () => {
      const adapter = new GitHubCopilotCliAdapter({ command: "custom-copilot" });
      vi.mocked(processRunner.runProcess).mockRejectedValue(new Error("ENOENT"));

      const health = await adapter.checkHealth();
      expect(health.available).toBe(false);
      expect(health.command).toBe("custom-copilot");
      expect(health.message).toContain("Command 'custom-copilot' is not available.");
    });

    it("reports no model support when modelArg is disabled", async () => {
      const adapter = new GitHubCopilotCliAdapter({ modelArg: false });
      vi.mocked(processRunner.runProcess).mockResolvedValue({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        durationMs: 10
      });

      const health = await adapter.checkHealth();
      expect(health.available).toBe(true);
      expect(health.supportsModelSelection).toBe(false);
    });
  });

  describe("buildCommand", () => {
    it("builds the default non-interactive JSONL command", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const input = runInput();
      const cmd = await adapter.buildCommand(input);

      expect(cmd.command).toBe("copilot");
      expect(cmd.cwd).toBe("/workspace");
      expect(cmd.args).toEqual([
        "-s",
        "--no-ask-user",
        "--no-auto-update",
        "--output-format=json"
      ]);
      expect(cmd.stdin).toBe("Review src/index.ts");
      expect(cmd.env).toBeDefined();
    });

    it("preserves configured command and base args", async () => {
      const adapter = new GitHubCopilotCliAdapter({ 
        command: "copilot-dev", 
        args: ["-s", "--output-format=json", "--allow-tool=read"] 
      });
      const input = runInput({ prompt: "Analyze only" });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.command).toBe("copilot-dev");
      expect(cmd.args.slice(0, 3)).toEqual(["-s", "--output-format=json", "--allow-tool=read"]);
      expect(cmd.stdin).toBe("Analyze only");
    });

    it("appends input model with default --model before prompt", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const input = runInput({ model: "gpt-5-copilot", prompt: "Review" });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.args).toEqual([
        "-s",
        "--no-ask-user",
        "--no-auto-update",
        "--output-format=json",
        "--model",
        "gpt-5-copilot"
      ]);
      expect(cmd.stdin).toBe("Review");
    });

    it("uses configured default model when input model is omitted", async () => {
      const adapter = new GitHubCopilotCliAdapter({ defaultModel: "auto" });
      const input = runInput({ prompt: "Review" });
      delete (input as any).model;
      const cmd = await adapter.buildCommand(input);

      expect(cmd.args).toContain("--model");
      expect(cmd.args[cmd.args.indexOf("--model") + 1]).toBe("auto");
    });

    it("rejects requested model when modelArg is disabled", async () => {
      const adapter = new GitHubCopilotCliAdapter({ modelArg: false });
      const input = runInput({ model: "gpt-4" });

      await expect(adapter.buildCommand(input)).rejects.toThrow(/Model selection is not supported/);
    });

    it("uses custom model flag", async () => {
      const adapter = new GitHubCopilotCliAdapter({ modelFlag: "--model-id" });
      const input = runInput({ model: "custom-model" });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.args).toContain("--model-id");
      expect(cmd.args).not.toContain("--model");
      expect(cmd.args[cmd.args.indexOf("--model-id") + 1]).toBe("custom-model");
    });

    it("uses custom prompt flag", async () => {
      const adapter = new GitHubCopilotCliAdapter({ promptMode: "arg", promptFlag: "--prompt" });
      const input = runInput({ prompt: "Review" });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.args.slice(-2)).toEqual(["--prompt", "Review"]);
      expect(cmd.stdin).toBeUndefined();
    });

    it("supports stdin prompt mode", async () => {
      const adapter = new GitHubCopilotCliAdapter({ promptMode: "stdin", promptFlag: "--prompt" });
      const input = runInput({ prompt: "Review from stdin" });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.args).not.toContain("-p");
      expect(cmd.args).not.toContain("--prompt");
      expect(cmd.stdin).toBe("Review from stdin");
    });

    it("rejects oversized promptMode arg prompts before spawn", async () => {
      const adapter = new GitHubCopilotCliAdapter({ promptMode: "arg" });
      const input = runInput({ prompt: "a".repeat(70 * 1024) });

      await expect(adapter.buildCommand(input)).rejects.toThrow(
        /prompt is too large for promptMode="arg"/
      );
    });

    it("injects schema instructions for prompt-based structured output", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const input = runInput({
        prompt: "Return findings",
        schema: { type: "object", properties: { findings: { type: "array" } }, required: ["findings"] },
        structuredOutput: {
          transport: "prompt"
        }
      });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.stdin).toContain("Return findings");
      expect(cmd.stdin).toContain("JSON Schema:");
      expect(cmd.stdin).toContain("findings");
      expect(cmd.args).not.toContain("-p");
    });

    it("does not inject schema instructions for validate-only structured output", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const input = runInput({
        prompt: "Return findings",
        schema: { type: "object", properties: { findings: { type: "array" } } },
        structuredOutput: {
          transport: "validate-only"
        }
      });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.stdin).toBe("Return findings");
    });

    it("throws error for native structured output", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const input = runInput({
        structuredOutput: { transport: "native" }
      });

      await expect(adapter.buildCommand(input)).rejects.toThrow(
        new OpenDynamicWorkflowError(
          ErrorCode.CLI_USAGE_ERROR,
          'GitHub Copilot CLI does not support structuredOutput.transport="native" yet.'
        )
      );
    });

    it("default permissions do not append broad flags", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const input = runInput({ permissions: { mode: "default" } });
      const cmd = await adapter.buildCommand(input);

      const dangerousFlags = ["--allow-all", "--allow-all-tools", "--allow-all-paths", "--allow-all-urls", "--yolo"];
      for (const flag of dangerousFlags) {
        expect(cmd.args).not.toContain(flag);
      }
    });

    it("dangerously-full-access appends exactly one --yolo flag by default", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const input = runInput({ permissions: { mode: "dangerously-full-access" } });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.args.filter(a => a === "--yolo")).toHaveLength(1);
    });

    it("dangerously-full-access respects custom dangerous flag", async () => {
      const adapter = new GitHubCopilotCliAdapter({ dangerouslySkipPermissionsFlag: "--dangerously-allow" });
      const input = runInput({ permissions: { mode: "dangerously-full-access" } });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.args).toContain("--dangerously-allow");
      expect(cmd.args).not.toContain("--yolo");
    });

    it("filters redacted environment variables", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const input = runInput({
        env: {
          PATH: "/bin",
          NODE_ENV: "test",
          GITHUB_TOKEN: "secret",
          GH_TOKEN: "secret",
          COPILOT_GITHUB_TOKEN: "secret",
          MY_SECRET: "secret",
          CUSTOM_TOKEN: "secret",
          APP_SECRET: "secret",
          OPENAI_API_KEY: "secret"
        }
      });
      const cmd = await adapter.buildCommand(input);

      expect(cmd.env).toEqual({ PATH: "/bin", NODE_ENV: "test" });
      const envKeys = Object.keys(cmd.env || {});
      expect(envKeys).not.toContain("GITHUB_TOKEN");
      expect(envKeys).not.toContain("GH_TOKEN");
      expect(envKeys.some(k => k.endsWith("_TOKEN"))).toBe(false);
      expect(envKeys.some(k => k.endsWith("_SECRET"))).toBe(false);
    });
  });

  describe("parseResult", () => {
    it("parses successful JSONL from fixture", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = getFixture("jsonl-success.jsonl");
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toBe("Use the scheduler path for provider execution.");
      expect(result.raw?.format).toBe("copilot-jsonl");
      expect((result.raw as any).events.length).toBeGreaterThanOrEqual(2);
    });

    it("parses JSONL with embedded structured output", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = getFixture("jsonl-embedded-structured-output.jsonl");
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toContain("Result:");
      expect(result.structuredJson).toEqual({
        ok: true,
        files: ["src/agents/github-copilot-cli.ts"]
      });
    });

    it("keeps valid JSONL events when one line is malformed", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = getFixture("jsonl-malformed-line.jsonl");
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toBe("Final Copilot answer");
      expect((result.raw as any).events).toHaveLength(2);
      expect(result.parseWarnings).toContainEqual(expect.stringContaining("Malformed JSON line 2: not-json"));
    });

    it("accepts a single valid JSONL event", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = '{"type":"result","text":"Single JSONL result"}\n';
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toBe("Single JSONL result");
      expect(result.raw?.format).toBe("copilot-jsonl");
    });

    it("falls back to whole JSON object with common text field", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = getFixture("json-single-object.json");
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toBe("Single object response");
      expect(result.json).toEqual({ response: "Single object response" });
    });

    it("treats whole JSON without text field as structured JSON", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = '{ "ok": true, "items": [1, 2] }';
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.structuredJson).toEqual({ ok: true, items: [1, 2] });
      expect(result.json).toEqual({ ok: true, items: [1, 2] });
    });

    it("falls back to plain text when output is not JSON", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = getFixture("plain-success.txt");
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toBe("Plain text response\n");
      expect(result.parseWarnings?.some(w => w.includes("Malformed JSON"))).toBe(true);
    });

    it("handles empty stdout", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const result = await adapter.parseResult(parseInput(""));

      expect(result.text).toBe("");
      expect(result.parseWarnings).toContain("Empty stdout");
    });

    it("returns raw stdout with warning when JSONL has no extractable text", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = '{"type":"status","id":"s1"}\n{"type":"done","status":"ok"}\n';
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toBe(stdout);
      expect(result.raw?.format).toBe("copilot-jsonl");
      expect(result.parseWarnings?.some(w => w.includes("no extractable response text"))).toBe(true);
    });

    it("prefers final-looking event over streaming delta text", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = [
        '{"type": "delta", "text": "partial"}',
        '{"type": "assistant_message", "message": {"content": "Final answer"}}',
        '{"type": "session_completed", "status": "ok"}'
      ].join("\n");
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toBe("Final answer");
    });

    it("scans previous events for embedded JSON when final text has none", async () => {
      const adapter = new GitHubCopilotCliAdapter();
      const stdout = [
        '{"type": "assistant_message", "message": {"content": "```json\\n{\\"ok\\":true}\\n```"}}',
        '{"type": "result", "text": "Done"}'
      ].join("\n");
      const result = await adapter.parseResult(parseInput(stdout));

      expect(result.text).toBe("Done");
      expect(result.structuredJson).toEqual({ ok: true });
    });
  });
});
