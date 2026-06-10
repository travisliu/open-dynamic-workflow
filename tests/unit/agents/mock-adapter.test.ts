import { describe, expect, it } from "vitest";
import { MockAdapter } from "../../../src/agents/mock-adapter.js";
import type { AgentRunInput, ProviderParseInput } from "../../../src/agents/types.js";

describe("MockAdapter", () => {
  it("declares provider-neutral capabilities", () => {
    const adapter = new MockAdapter();
    expect(adapter.capabilities()).toEqual({
      prompt: { transports: ["stdin"] },
      output: { formats: ["text", "json"] },
      structuredOutput: { modes: ["prompt", "validate-only"] },
      usage: { source: "none" },
      sessions: { modes: ["none"] },
      permissions: { modes: ["none"] }
    });
  });

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
      env: {}
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
      env: {}
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
      env: {}
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
      env: {}
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
      env: {}
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
      env: {}
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

  it("can simulate usage, provider thread metadata, and provider-reported failure", async () => {
    const adapter = new MockAdapter({
      responses: {
        "run-protocol": {
          text: "provider failed after partial output",
          usage: {
            inputTokens: 10,
            outputTokens: 3,
            totalTokens: 13
          },
          providerThreadId: "mock-thread-1",
          providerMetadata: { source: "unit-test" },
          failure: {
            name: "MockProviderFailure",
            message: "mock terminal failure",
            code: "PROVIDER_REPORTED_FAILURE"
          }
        }
      }
    });

    const input: AgentRunInput = {
      id: "run-protocol",
      provider: "mock",
      prompt: "hello",
      cwd: "/root",
      timeoutMs: 1000,
      env: {}
    };

    const parsed = await adapter.parseResult({
      input,
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    expect(parsed.text).toBe("provider failed after partial output");
    expect(parsed.usage).toEqual({ inputTokens: 10, outputTokens: 3, totalTokens: 13 });
    expect(parsed.providerThreadId).toBe("mock-thread-1");
    expect(parsed.providerMetadata).toEqual({ source: "unit-test" });
    expect(parsed.failure).toEqual({
      name: "MockProviderFailure",
      message: "mock terminal failure",
      code: "PROVIDER_REPORTED_FAILURE"
    });
  });
});
