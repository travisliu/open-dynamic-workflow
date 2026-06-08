import { describe, expect, it } from "vitest";
import { MockAdapter } from "../../../src/agents/mock-adapter.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";

describe("MockAdapter", () => {
  it("health check is always available", async () => {
    const adapter = new MockAdapter();
    const health = await adapter.checkHealth();
    expect(health.available).toBe(true);
    expect(health.provider).toBe("mock");
  });

  it("default mock text response", async () => {
    const adapter = new MockAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "mock",
      prompt: "hello",
      cwd: "/root",
      timeoutMs: 1000,
      env: {},
      permissions: { mode: "default" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.command).toBe("mock-process");

    const parseInput: ProviderParseInput = {
      input,
      stdout: "",
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("mock response");
  });

  it("rejects native structured output transport", async () => {
    const adapter = new MockAdapter();
    const input: AgentRunInput = {
      id: "run-native",
      provider: "mock",
      prompt: "hello",
      schema: {
        type: "object",
        properties: {
          value: { type: "string" }
        }
      },
      structuredOutput: { transport: "native" },
      cwd: "/root",
      timeoutMs: 1000,
      env: {},
      permissions: { mode: "default" }
    };

    await expect(adapter.buildCommand(input)).rejects.toThrow(
      'Mock provider does not support structuredOutput.transport="native" yet.'
    );
  });

  it("mock response by id", async () => {
    const adapter = new MockAdapter({
      responses: {
        "run-special": { text: "special value" }
      }
    });

    const input: AgentRunInput = {
      id: "run-special",
      provider: "mock",
      prompt: "hello",
      cwd: "/root",
      timeoutMs: 1000,
      env: {},
      permissions: { mode: "default" }
    };

    const parseInput: ProviderParseInput = {
      input,
      stdout: "",
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("special value");
  });

  it("mock JSON response by id", async () => {
    const adapter = new MockAdapter({
      responses: {
        "run-json": { json: { success: true } }
      }
    });

    const input: AgentRunInput = {
      id: "run-json",
      provider: "mock",
      prompt: "hello",
      cwd: "/root",
      timeoutMs: 1000,
      env: {},
      permissions: { mode: "default" }
    };

    const parseInput: ProviderParseInput = {
      input,
      stdout: "",
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.json).toEqual({ success: true });
    expect(parsed.text).toBe(JSON.stringify({ success: true }));
  });

  it("mock response by label", async () => {
    const adapter = new MockAdapter({
      responses: {
        "label-test": { text: "labeled text" }
      }
    });

    const input: AgentRunInput = {
      id: "run-xyz",
      label: "label-test",
      provider: "mock",
      prompt: "hello",
      cwd: "/root",
      timeoutMs: 1000,
      env: {},
      permissions: { mode: "default" }
    };

    const parseInput: ProviderParseInput = {
      input,
      stdout: "",
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("labeled text");
  });

  it("handles defaultResponse", async () => {
    const adapter = new MockAdapter({
      defaultResponse: { text: "default fallback response" }
    });

    const input: AgentRunInput = {
      id: "run-random",
      provider: "mock",
      prompt: "hello",
      cwd: "/root",
      timeoutMs: 1000,
      env: {},
      permissions: { mode: "default" }
    };

    const parseInput: ProviderParseInput = {
      input,
      stdout: "",
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("default fallback response");
  });

  it("accepts resolved permissions without changing deterministic behavior", async () => {
    const adapter = new MockAdapter();
    const input: AgentRunInput = {
      id: "run-1",
      provider: "mock",
      prompt: "hello",
      cwd: "/root",
      timeoutMs: 1000,
      env: {},
      permissions: { mode: "dangerously-full-access" }
    };

    const cmd = await adapter.buildCommand(input);
    expect(cmd.command).toBe("mock-process");

    const parseInput: ProviderParseInput = {
      input,
      stdout: "",
      stderr: "",
      exitCode: 0
    };

    const parsed = await adapter.parseResult(parseInput);
    expect(parsed.text).toBe("mock response");
  });
});
