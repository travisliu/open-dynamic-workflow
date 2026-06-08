import { describe, expect, it } from "vitest";
import { CodexExecAdapter } from "../../../src/agents/codex-exec.js";
import { GeminiCliAdapter } from "../../../src/agents/gemini-cli.js";
import type { AgentRunInput } from "../../../src/agents/types.js";

describe("Provider adapter execution (Unit)", () => {
  it("Codex adapter builds expected command", async () => {
    // Arrange
    const adapter = new CodexExecAdapter({
      command: "codex",
      args: ["exec", "--json", "--ephemeral"]
    });

    const input: AgentRunInput = {
      id: "run-03-02",
      provider: "codex",
      prompt: "generate a test",
      cwd: "/work/project",
      timeoutMs: 30000,
      env: {
        "PATH": "/usr/bin",
        "NODE_ENV": "test",
        "OPENAI_API_KEY": "sk-12345"
      },
      permissions: { mode: "default" }
    };

    // Act
    const cmd = await adapter.buildCommand(input);

    // Assert
    expect(cmd.command).toBe("codex");
    expect(cmd.args).toEqual(["exec", "--json", "--ephemeral"]);
    expect(cmd.stdin).toBe("generate a test");
    expect(cmd.cwd).toBe("/work/project");
    expect(cmd.env).toHaveProperty("PATH");
    expect(cmd.env).toHaveProperty("NODE_ENV");
    expect(cmd.env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("Gemini adapter builds expected command", async () => {
    // Arrange
    const adapter = new GeminiCliAdapter({
      command: "gemini",
      args: ["--output-format", "json"]
    });

    const input: AgentRunInput = {
      id: "run-03-03",
      provider: "gemini",
      prompt: "generate a test",
      cwd: "/work/project",
      timeoutMs: 30000,
      env: {
        "PATH": "/usr/bin",
        "NODE_ENV": "test",
        "GEMINI_API_KEY": "AIza-12345"
      },
      permissions: { mode: "default" }
    };

    // Act
    const cmd = await adapter.buildCommand(input);

    // Assert
    expect(cmd.command).toBe("gemini");
    expect(cmd.args).toContain("--output-format");
    expect(cmd.args).toContain("json");
    expect(cmd.args).toContain("-p");
    expect(cmd.args).toContain("generate a test");
    expect(cmd.cwd).toBe("/work/project");
    expect(cmd.env).toHaveProperty("PATH");
    expect(cmd.env).toHaveProperty("NODE_ENV");
    expect(cmd.env).not.toHaveProperty("GEMINI_API_KEY");
  });

  it("Gemini adapter with dangerously-full-access succeeds (does not throw)", async () => {
    // Arrange: use base args with --approval-mode plan to mimic real defaults
    const adapter = new GeminiCliAdapter({
      command: "gemini",
      args: ["--output-format", "json", "--approval-mode", "plan"]
    });

    const input: AgentRunInput = {
      id: "run-full-access",
      provider: "gemini",
      prompt: "apply the patch",
      cwd: "/work/project",
      timeoutMs: 30000,
      env: { "PATH": "/usr/bin" },
      permissions: { mode: "dangerously-full-access" }
    };

    // Act: must not throw
    const cmd = await adapter.buildCommand(input);

    // Assert: command uses yolo approval mode
    expect(cmd.command).toBe("gemini");
    const idx = cmd.args.indexOf("--approval-mode");
    expect(idx).toBeGreaterThan(-1);
    expect(cmd.args[idx + 1]).toBe("yolo");
    expect(cmd.args.filter(a => a === "--approval-mode").length).toBe(1);
  });
});
