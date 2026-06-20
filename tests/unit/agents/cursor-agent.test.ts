import { describe, it, expect } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { CursorAgentAdapter } from "../../../src/agents/cursor-agent.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

function runInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    id: "cursor-test",
    provider: "cursor",
    prompt: "Review src/index.ts",
    timeoutMs: 1000,
    cwd: "/workspace",
    env: {},
    permissions: { mode: "default" },
    ...overrides
  };
}

function getFixture(name: string): string {
  return readFileSync(join(__dirname, "../../fixtures/cursor", name), "utf8");
}

describe("CursorAgentAdapter", () => {
  it("exposes the provider name 'cursor'", () => {
    const adapter = new CursorAgentAdapter();
    expect(adapter.name).toBe("cursor");
  });

  describe("checkHealth", () => {
    it("returns available: false when command fails/does not exist", async () => {
      const adapter = new CursorAgentAdapter({ command: "missing-agent-binary-xyz" });

      const health = await adapter.checkHealth();
      expect(health.available).toBe(false);
      expect(health.command).toBe("missing-agent-binary-xyz");
      expect(health.message).toContain("Command 'missing-agent-binary-xyz' is not available.");
    });

    it("health check passes a safe env with PATH but without API keys and returns available: true", async () => {
      const dir = await mkdtemp(join(tmpdir(), "open-dynamic-workflow-cursor-health-"));
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

        const adapter = new CursorAgentAdapter({ command });
        const health = await adapter.checkHealth();

        expect(health.available).toBe(true);
        expect(health.command).toBe(command);
      } finally {
        if (previousOpenAiKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = previousOpenAiKey;
        }
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("buildCommand", () => {
    it("builds default command", async () => {
      const adapter = new CursorAgentAdapter();
      const cmd = await adapter.buildCommand(runInput({ prompt: "generate a test" }));
      expect(cmd.command).toBe("agent");
      expect(cmd.args).toEqual([
        "--output-format",
        "json",
        "--trust",
        "--mode",
        "ask",
        "-p",
        "generate a test"
      ]);
      expect(cmd.stdin).toBeUndefined();
    });

    it("uses defaultModel if model is not set in input", async () => {
      const adapter = new CursorAgentAdapter({ defaultModel: "custom-model" });
      const cmd = await adapter.buildCommand(runInput());
      expect(cmd.args).toContain("--model");
      expect(cmd.args[cmd.args.indexOf("--model") + 1]).toBe("custom-model");
    });

    it("includes model argument when model is set in input", async () => {
      const adapter = new CursorAgentAdapter();
      const cmd = await adapter.buildCommand(runInput({ model: "composer-2" }));
      expect(cmd.args).toContain("--model");
      expect(cmd.args[cmd.args.indexOf("--model") + 1]).toBe("composer-2");
    });

    it("handles modelArg as false to throw if model is requested", async () => {
      const adapter = new CursorAgentAdapter({ modelArg: false });
      await expect(
        adapter.buildCommand(runInput({ model: "composer-2" }))
      ).rejects.toThrow(OpenDynamicWorkflowError);
    });

    it("does not leak secrets from environment", async () => {
      const adapter = new CursorAgentAdapter();
      const cmd = await adapter.buildCommand(
        runInput({
          env: {
            PATH: "/bin",
            CURSOR_API_KEY: "secret-key",
            OPENAI_API_KEY: "openai-secret",
            MY_TOKEN: "my-token",
            DB_SECRET: "db-secret",
            PASSWORD: "pass",
            SAFE_ENV: "safe-value"
          }
        })
      );
      expect(cmd.env).toBeDefined();
      expect(cmd.env?.PATH).toBe("/bin");
      expect(cmd.env?.SAFE_ENV).toBe("safe-value");
      expect(cmd.env?.CURSOR_API_KEY).toBeUndefined();
      expect(cmd.env?.OPENAI_API_KEY).toBeUndefined();
      expect(cmd.env?.MY_TOKEN).toBeUndefined();
      expect(cmd.env?.DB_SECRET).toBeUndefined();
      expect(cmd.env?.PASSWORD).toBeUndefined();
    });

    it("handles dangerously-full-access permissions mode", async () => {
      const adapter = new CursorAgentAdapter();
      const cmd = await adapter.buildCommand(
        runInput({ permissions: { mode: "dangerously-full-access" } })
      );
      expect(cmd.args).toContain("--force");
      expect(cmd.args).not.toContain("--mode");
      expect(cmd.args).not.toContain("ask");
    });

    it("handles custom dangerous permission mode flag", async () => {
      const adapter = new CursorAgentAdapter({
        dangerouslySkipPermissionsFlag: "--yolo"
      });
      const cmd = await adapter.buildCommand(
        runInput({ permissions: { mode: "dangerously-full-access" } })
      );
      expect(cmd.args).toContain("--yolo");
      expect(cmd.args).not.toContain("--force");
    });

    it("handles promptMode stdin", async () => {
      const adapter = new CursorAgentAdapter({ promptMode: "stdin" });
      const cmd = await adapter.buildCommand(runInput({ prompt: "generate a test" }));
      expect(cmd.stdin).toBe("generate a test");
      expect(cmd.args).not.toContain("-p");
      expect(cmd.args).not.toContain("generate a test");
    });

    it("respects workspaceFlag with input.cwd", async () => {
      const adapter = new CursorAgentAdapter({ workspaceFlag: "--workspace" });
      const cmd = await adapter.buildCommand(runInput({ cwd: "/workspace-path" }));
      expect(cmd.args).toContain("--workspace");
      expect(cmd.args[cmd.args.indexOf("--workspace") + 1]).toBe("/workspace-path");
    });

    it("does not synthesize workspace flag when workspaceFlag is false", async () => {
      const adapter = new CursorAgentAdapter({ workspaceFlag: false });
      const cmd = await adapter.buildCommand(runInput({ cwd: "/workspace-path" }));
      expect(cmd.args).not.toContain("--workspace");
      expect(cmd.args).not.toContain("/workspace-path");
    });

    it("rejects native structured output transport", async () => {
      const adapter = new CursorAgentAdapter();
      const input = runInput({
        schema: { type: "object", properties: {} },
        structuredOutput: { transport: "native" }
      });
      await expect(adapter.buildCommand(input)).rejects.toThrow(
        'Cursor Agent does not support structuredOutput.transport="native" yet.'
      );
    });

    it("injects schema into prompt when transport is not native/validate-only", async () => {
      const adapter = new CursorAgentAdapter();
      const input = runInput({
        schema: { type: "object", properties: { age: { type: "number" } } }
      });
      const cmd = await adapter.buildCommand(input);
      expect(cmd.args[cmd.args.length - 1]).toContain("JSON Schema");
      expect(cmd.args[cmd.args.length - 1]).toContain("age");
    });
  });

  describe("parseResult", () => {
    const defaultInput = runInput();

    it("parses empty stdout", async () => {
      const adapter = new CursorAgentAdapter();
      const res = await adapter.parseResult({
        input: defaultInput,
        stdout: getFixture("json-empty.txt"),
        stderr: "",
        exitCode: 0
      });
      expect(res.text).toBe("");
      expect(res.parseWarnings).toContain("Empty stdout");
    });

    it("parses JSON stdout with text field", async () => {
      const adapter = new CursorAgentAdapter();
      const res = await adapter.parseResult({
        input: defaultInput,
        stdout: getFixture("json-success.json"),
        stderr: "",
        exitCode: 0
      });
      expect(res.text).toBe("Hello from Cursor json-success");
      expect(res.json).toEqual({ text: "Hello from Cursor json-success" });
      expect(res.raw).toEqual({ text: "Hello from Cursor json-success" });
    });

    it("parses JSON stdout with response field", async () => {
      const adapter = new CursorAgentAdapter();
      const res = await adapter.parseResult({
        input: defaultInput,
        stdout: getFixture("success.json"),
        stderr: "",
        exitCode: 0
      });
      expect(res.text).toBe("Success with response key");
      expect(res.json).toEqual({ response: "Success with response key" });
    });

    it("parses JSON stdout containing embedded structured output JSON", async () => {
      const adapter = new CursorAgentAdapter();
      const res = await adapter.parseResult({
        input: defaultInput,
        stdout: getFixture("json-embedded-structured-output.json"),
        stderr: "",
        exitCode: 0
      });
      expect(res.text).toContain("embedded-success");
      expect(res.structuredJson).toEqual({ result: "embedded-success" });
    });

    it("parses JSON stdout without text fields as direct object", async () => {
      const adapter = new CursorAgentAdapter();
      const res = await adapter.parseResult({
        input: defaultInput,
        stdout: '{"custom": 123}',
        stderr: "",
        exitCode: 0
      });
      expect(res.text).toBeUndefined();
      expect(res.json).toEqual({ custom: 123 });
      expect(res.structuredJson).toEqual({ custom: 123 });
    });

    it("falls back to plain text stdout on malformed JSON", async () => {
      const adapter = new CursorAgentAdapter();
      const res = await adapter.parseResult({
        input: defaultInput,
        stdout: getFixture("plain-text.txt"),
        stderr: "",
        exitCode: 0
      });
      expect(res.text).toBe("Plain text fallback content\n");
      expect(res.json).toBeUndefined();
      expect(res.structuredJson).toBeUndefined();
    });
  });
});
