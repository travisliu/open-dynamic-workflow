import { describe, it, expect, vi } from "vitest";
import { CursorAgentAdapter } from "../../../src/agents/cursor-agent.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";
import * as processRunner from "../../../src/agents/process-runner.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { createDefaultProviderRegistry } from "../../../src/agents/registry.js";
import type { ResolvedConfig } from "../../../src/agents/types.js";

vi.mock("../../../src/agents/process-runner.js");

function createRunInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    id: "cursor-acceptance-test",
    provider: "cursor",
    prompt: "Implement authentication service",
    timeoutMs: 5000,
    cwd: "/root/workspace",
    env: {},
    permissions: { mode: "default" },
    ...overrides
  };
}

describe("Cursor Agent Adapter Acceptance Tests (AAA)", () => {
  describe("checkHealth", () => {
    it("CURSOR-AC-002: resolves to available: true when the help command execution succeeds", async () => {
      // Arrange: Configure adapter and mock successful command run
      const adapter = new CursorAgentAdapter({ command: "cursor-cli-tool" });
      vi.mocked(processRunner.runProcess).mockResolvedValue({
        stdout: "Cursor CLI --help output",
        stderr: "",
        exitCode: 0,
        durationMs: 42
      });

      // Act: Trigger health check action
      const healthResult = await adapter.checkHealth();

      // Assert: Verify checkHealth output matches expectations
      expect(healthResult.available).toBe(true);
      expect(healthResult.provider).toBe("cursor");
      expect(healthResult.command).toBe("cursor-cli-tool");
      expect(processRunner.runProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "cursor-cli-tool",
          args: ["--help"]
        })
      );
    });

    it("CURSOR-AC-003: resolves to available: false when the command execution fails", async () => {
      // Arrange: Configure adapter and mock failing command run
      const adapter = new CursorAgentAdapter({ command: "broken-cursor-cli" });
      vi.mocked(processRunner.runProcess).mockRejectedValue(
        new Error("ENOENT: Command broken-cursor-cli not found")
      );

      // Act: Trigger health check action
      const healthResult = await adapter.checkHealth();

      // Assert: Verify health check resolves with unavailable state and proper error logs
      expect(healthResult.available).toBe(false);
      expect(healthResult.command).toBe("broken-cursor-cli");
      expect(healthResult.message).toContain("Command 'broken-cursor-cli' is not available.");
      expect(healthResult.error?.message).toContain("ENOENT");
    });
  });

  describe("buildCommand", () => {
    it("CURSOR-AC-004, CURSOR-AC-005, CURSOR-AC-007, CURSOR-AC-010: builds default command successfully with correct flag order", async () => {
      // Arrange: Instantiate standard adapter and default run inputs
      const adapter = new CursorAgentAdapter();
      const input = createRunInput();

      // Act: Trigger command build action
      const resultCommand = await adapter.buildCommand(input);

      // Assert: Verify command structure, argument ordering, output format, trust flag, mode defaults, and workspace CWD
      expect(resultCommand.command).toBe("agent");
      expect(resultCommand.cwd).toBe("/root/workspace");
      expect(resultCommand.args).toEqual([
        "--output-format",
        "json",
        "--trust",
        "--mode",
        "ask",
        "-p",
        "Implement authentication service"
      ]);
      expect(resultCommand.stdin).toBeUndefined();
    });

    it("CURSOR-AC-006, CURSOR-AC-008, CURSOR-AC-009: supports model flag, dangerous mode, stdin prompt input and custom flags", async () => {
      // Arrange: Configure adapter with custom flags and stdin mode
      const adapter = new CursorAgentAdapter({
        command: "custom-cursor",
        promptMode: "stdin",
        dangerouslySkipPermissionsFlag: "--yolo"
      });
      const input = createRunInput({
        model: "gpt-4o-custom",
        permissions: { mode: "dangerously-full-access" }
      });

      // Act: Trigger command build action
      const resultCommand = await adapter.buildCommand(input);

      // Assert: Verify custom command, stdin, model selection, custom yolo flag and missing ask mode flag
      expect(resultCommand.command).toBe("custom-cursor");
      expect(resultCommand.stdin).toBe("Implement authentication service");
      expect(resultCommand.args).toContain("--model");
      expect(resultCommand.args[resultCommand.args.indexOf("--model") + 1]).toBe("gpt-4o-custom");
      expect(resultCommand.args).toContain("--yolo");
      expect(resultCommand.args).not.toContain("--force");
      expect(resultCommand.args).not.toContain("--mode");
      expect(resultCommand.args).not.toContain("-p");
    });

    it("CURSOR-AC-011: rejects native structured output transport with a clear error", async () => {
      // Arrange: Configure adapter and input with native structured output transport
      const adapter = new CursorAgentAdapter();
      const input = createRunInput({
        schema: { type: "object", properties: { key: { type: "string" } } },
        structuredOutput: { transport: "native" }
      });

      // Act: Trigger command build and assert rejection
      const actPromise = adapter.buildCommand(input);

      // Assert: Verify rejection is of standard error class with clear error message
      await expect(actPromise).rejects.toThrow(OpenDynamicWorkflowError);
      await expect(actPromise).rejects.toThrow('Cursor Agent does not support structuredOutput.transport="native" yet.');
    });

    it("CURSOR-AC-016: redacts/filters secret-like environment variables from the process environment", async () => {
      // Arrange: Configure adapter and input containing secrets
      const adapter = new CursorAgentAdapter();
      const input = createRunInput({
        env: {
          PATH: "/usr/bin:/bin",
          SAFE_ENV_VAR: "non-sensitive-value",
          GITHUB_TOKEN: "ghp_secretTokenValue",
          CURSOR_API_KEY: "cursor_super_secret",
          PASSWORD: "adminpassword",
          DB_SECRET: "mydbsecret"
        }
      });

      // Act: Trigger command build action
      const resultCommand = await adapter.buildCommand(input);

      // Assert: Verify that safe environment variables remain while secrets are redacted
      expect(resultCommand.env).toBeDefined();
      expect(resultCommand.env?.PATH).toBe("/usr/bin:/bin");
      expect(resultCommand.env?.SAFE_ENV_VAR).toBe("non-sensitive-value");
      expect(resultCommand.env?.GITHUB_TOKEN).toBeUndefined();
      expect(resultCommand.env?.CURSOR_API_KEY).toBeUndefined();
      expect(resultCommand.env?.PASSWORD).toBeUndefined();
      expect(resultCommand.env?.DB_SECRET).toBeUndefined();
    });
  });

  describe("parseResult", () => {
    it("CURSOR-AC-012: normalizes empty stdout output with warning", async () => {
      // Arrange: Setup inputs with empty/whitespace stdout
      const adapter = new CursorAgentAdapter();
      const parseInput: ProviderParseInput = {
        input: createRunInput(),
        stdout: "   \n  ",
        stderr: "",
        exitCode: 0
      };

      // Act: Trigger response parse action
      const parsedResult = await adapter.parseResult(parseInput);

      // Assert: Verify parsed text is empty and warning is present
      expect(parsedResult.text).toBe("");
      expect(parsedResult.parseWarnings).toContain("Empty stdout");
    });

    it("CURSOR-AC-013: normalizes JSON stdout with a text field correctly", async () => {
      // Arrange: Setup inputs with valid JSON output containing a text field
      const adapter = new CursorAgentAdapter();
      const parseInput: ProviderParseInput = {
        input: createRunInput(),
        stdout: JSON.stringify({
          text: "Operation completed successfully.",
          response: "different text",
          otherMeta: 42
        }),
        stderr: "",
        exitCode: 0
      };

      // Act: Trigger response parse action
      const parsedResult = await adapter.parseResult(parseInput);

      // Assert: Verify normalized result fields
      expect(parsedResult.text).toBe("Operation completed successfully.");
      expect(parsedResult.json).toEqual(expect.objectContaining({ text: "Operation completed successfully." }));
      expect(parsedResult.raw).toBeDefined();
    });

    it("CURSOR-AC-014: normalizes JSON stdout without text fields, preserving structured data", async () => {
      // Arrange: Setup inputs with valid JSON containing only custom structured fields
      const adapter = new CursorAgentAdapter();
      const parseInput: ProviderParseInput = {
        input: createRunInput(),
        stdout: JSON.stringify({
          status: "success",
          filesCreated: ["src/index.ts", "tests/main.ts"],
          runScore: 100
        }),
        stderr: "",
        exitCode: 0
      };

      // Act: Trigger response parse action
      const parsedResult = await adapter.parseResult(parseInput);

      // Assert: Verify text is undefined and json/structuredJson are populated
      expect(parsedResult.text).toBeUndefined();
      expect(parsedResult.json).toEqual({
        status: "success",
        filesCreated: ["src/index.ts", "tests/main.ts"],
        runScore: 100
      });
      expect(parsedResult.structuredJson).toEqual({
        status: "success",
        filesCreated: ["src/index.ts", "tests/main.ts"],
        runScore: 100
      });
    });

    it("CURSOR-AC-015: normalizes plain text stdout correctly falling back from malformed JSON", async () => {
      // Arrange: Setup inputs with plain text stdout output (invalid JSON)
      const adapter = new CursorAgentAdapter();
      const parseInput: ProviderParseInput = {
        input: createRunInput(),
        stdout: "Standard textual output from cursor cli. Not a JSON object.",
        stderr: "",
        exitCode: 0
      };

      // Act: Trigger response parse action
      const parsedResult = await adapter.parseResult(parseInput);

      // Assert: Verify text is raw stdout, json is undefined
      expect(parsedResult.text).toBe("Standard textual output from cursor cli. Not a JSON object.");
      expect(parsedResult.json).toBeUndefined();
      expect(parsedResult.structuredJson).toBeUndefined();
    });
  });

  describe("Registry resolution", () => {
    it("CURSOR-AC-001, CURSOR-AC-017: resolves Cursor adapter and preserves built-in providers list", () => {
      // Arrange: Mock resolved config with cursor settings
      const dummyConfig = {
        defaultProvider: "mock",
        concurrency: 2,
        timeoutMs: 5000,
        providers: {
          codex: { command: "codex" },
          gemini: { command: "gemini" },
          copilot: { command: "copilot" },
          opencode: { command: "opencode" },
          antigravity: { command: "agy" },
          pi: { command: "pi" },
          cursor: { command: "agent" }
        },
        security: {
          allowWorkflowImports: false,
          passEnv: [],
          redactEnv: []
        },
        reporting: {
          mode: "pretty",
          verbose: false
        },
        cwd: "/root",
        outDir: "/root/out",
        cliArgs: {}
      } as unknown as ResolvedConfig;

      // Act: Get Default Registry
      const registry = createDefaultProviderRegistry({ config: dummyConfig });
      const providersList = registry.list().map((a) => a.name);
      const cursorAdapter = registry.get("cursor");

      // Assert: Verify list of providers and cursor instance
      expect(providersList).toContain("cursor");
      expect(providersList).toEqual(["mock", "codex", "gemini", "copilot", "opencode", "antigravity", "pi", "cursor"]);
      expect(cursorAdapter).toBeDefined();
      expect(cursorAdapter.name).toBe("cursor");
    });
  });
});
