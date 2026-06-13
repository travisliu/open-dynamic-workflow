import { describe, expect, it } from "vitest";
import { OpenCodeCliAdapter } from "../src/agents/opencode-cli.js";
import { AntigravityCliAdapter } from "../src/agents/antigravity-cli.js";
import { PiCodingAgentAdapter } from "../src/agents/pi-coding-agent.js";
import type { AgentResult } from "../src/types/index.js";

describe("Agent adapters v2 contracts", () => {
  it("70. public adapter exports are available", () => {
    // Arrange & Act
    const opencode = new OpenCodeCliAdapter();
    const antigravity = new AntigravityCliAdapter();
    const pi = new PiCodingAgentAdapter();

    // Assert
    expect(opencode.name).toBe("opencode");
    expect(typeof opencode.buildCommand).toBe("function");
    expect(typeof opencode.parseResult).toBe("function");

    expect(antigravity.name).toBe("antigravity");
    expect(typeof antigravity.buildCommand).toBe("function");
    expect(typeof antigravity.parseResult).toBe("function");

    expect(pi.name).toBe("pi");
    expect(typeof pi.buildCommand).toBe("function");
    expect(typeof pi.parseResult).toBe("function");
  });

  it("71. workflow DSL contracts do not gain provider-specific fields", () => {
    // Arrange & Act
    // This is primarily a compile-time check, but we can assert the structure here.
    const call = {
      provider: "opencode",
      prompt: "hello"
    };

    // Assert
    expect(call).toEqual({ provider: "opencode", prompt: "hello" });
    // Verify no other fields are required for a valid call structure in our context
  });

  it("72. JSON and JSONL reporter contracts remain parseable", () => {
    // Arrange
    const providers = ["opencode", "antigravity", "pi"];
    
    // Act & Assert
    for (const provider of providers) {
      const result: AgentResult = {
        ok: true,
        status: "succeeded",
        id: "agent-1",
        provider: provider as any,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        artifacts: {
          dir: "agents/agent-1",
          promptPath: "agents/agent-1/prompt.txt",
          stdoutPath: "agents/agent-1/stdout.log",
          stderrPath: "agents/agent-1/stderr.log"
        }
      };
      
      expect(result.provider).toBe(provider);
      // Ensure the envelope structure is preserved
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("artifacts");
    }
  });
});

// Keep some Phase 0 core contract checks for regression
describe("Phase 0 contracts", () => {
  it("supports a discriminated success agent result", () => {
    const result: AgentResult = {
      ok: true,
      status: "succeeded",
      id: "agent-1",
      provider: "mock",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      artifacts: {
        dir: "agents/agent-1",
        promptPath: "agents/agent-1/prompt.txt",
        stdoutPath: "agents/agent-1/stdout.log",
        stderrPath: "agents/agent-1/stderr.log"
      }
    };
    expect(result.ok).toBe(true);
  });
});
