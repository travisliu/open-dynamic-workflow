import { describe, expect, it, vi, beforeEach } from "vitest";
import { DefaultAgentExecutor } from "../../../src/agents/execute-agent.js";
import { EventBus } from "../../../src/orchestration/event-bus.js";
import * as registryModule from "../../../src/agents/registry.js";
import * as processRunnerModule from "../../../src/agents/process-runner.js";

class FakeArtifactStore {
  files: Record<string, string> = {};
  jsonFiles: Record<string, any> = {};

  async writeText(path: string, content: string) {
    this.files[path] = content;
  }
  async appendText(path: string, content: string) {
    this.files[path] = (this.files[path] || "") + content;
  }
  async writeJson(path: string, content: any) {
    this.jsonFiles[path] = content;
  }
  async appendJsonl(path: string, content: any) {
    this.files[path] = (this.files[path] || "") + JSON.stringify(content) + "\n";
  }
}

describe("DefaultAgentExecutor Verbose Logging", () => {
  let store: FakeArtifactStore;
  let eventBus: EventBus;
  let config: any;
  let events: any[] = [];

  beforeEach(() => {
    store = new FakeArtifactStore();
    events = [];
    eventBus = new EventBus({
      runId: "test-run",
      artifactStore: store as any,
      subscribers: [
        {
          handle: async (envelope) => {
            events.push(envelope);
          }
        }
      ]
    });

    config = {
      defaultProvider: "mock",
      providers: {
        mock: {
          command: "mock",
          responses: {
            "success-agent": {
              text: "Success response with secret-12345",
              stdout: "Mock stdout secret-12345",
              stderr: "Mock stderr secret-12345",
              exitCode: 0
            },
            "failure-agent": {
              exitCode: 1,
              stderr: "Mock error with secret-12345"
            }
          }
        }
      },
      security: {
        redactEnv: ["*_TOKEN"]
      }
    };
  });

  it("emits verbose command and result events on success", async () => {
    process.env.OPEN_DYNAMIC_WORKFLOW_VERBOSE_TEST_TOKEN = "secret-12345";
    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    const result = await executor.execute({
      id: "success-agent",
      label: "Success Agent",
      provider: "mock",
      prompt: "Review token secret-12345",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: { key: "value" }
    });

    const commandEvent = events.find(e => e.type === "agent.verbose.command");
    const resultEvent = events.find(e => e.type === "agent.verbose.result");

    expect(commandEvent).toBeDefined();
    expect(resultEvent).toBeDefined();
    
    // Command before result
    expect(events.indexOf(commandEvent)).toBeLessThan(events.indexOf(resultEvent));

    expect(commandEvent.payload.agentId).toBe("success-agent");
    expect(commandEvent.payload.prompt).toContain("[REDACTED]");
    expect(commandEvent.payload.prompt).not.toContain("secret-12345");
    expect(commandEvent.payload.command).toBeDefined();
    expect(commandEvent.payload.command.cwd).toBe("/test/cwd");

    expect(resultEvent.payload.agentId).toBe("success-agent");
    expect(resultEvent.payload.status).toBe("succeeded");
    expect(resultEvent.payload.stdout).toContain("[REDACTED]");
    expect(resultEvent.payload.stdout).not.toContain("secret-12345");
    expect(resultEvent.payload.normalized).toContain("[REDACTED]");
    expect(typeof resultEvent.payload.durationMs).toBe("number");

    delete process.env.OPEN_DYNAMIC_WORKFLOW_VERBOSE_TEST_TOKEN;
  });

  it("emits verbose result with status failed on non-zero exit", async () => {
    process.env.OPEN_DYNAMIC_WORKFLOW_VERBOSE_TEST_TOKEN = "secret-12345";
    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    await executor.execute({
      id: "failure-agent",
      label: "Failure Agent",
      provider: "mock",
      prompt: "test prompt with secret-12345",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    const resultEvent = events.find(e => e.type === "agent.verbose.result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent.payload.status).toBe("failed");
    expect(resultEvent.payload.exitCode).toBe(1);
    expect(resultEvent.payload.error.message).toContain("[REDACTED]");
    expect(resultEvent.payload.error.message).not.toContain("secret-12345");

    delete process.env.OPEN_DYNAMIC_WORKFLOW_VERBOSE_TEST_TOKEN;
  });

  it("emits verbose result on timeout", async () => {
    config.providers.mock.responses["timeout-agent"] = {
      delayMs: 200,
      timeout: true
    };
    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    await executor.execute({
      id: "timeout-agent",
      label: "Timeout Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 50,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: AbortSignal.timeout(50),
      metadata: {}
    });

    const resultEvent = events.find(e => e.type === "agent.verbose.result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent.payload.status).toBe("timed_out");
  });

  it("emits verbose result on cancellation", async () => {
    const controller = new AbortController();
    config.providers.mock.responses["cancel-agent"] = {
      delayMs: 500
    };
    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    const promise = executor.execute({
      id: "cancel-agent",
      label: "Cancel Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: controller.signal,
      metadata: {}
    });

    // Give it a tiny bit of time to start the delay
    await new Promise(r => setTimeout(r, 10));
    controller.abort();
    await promise.catch(() => {});

    const resultEvent = events.find(e => e.type === "agent.verbose.result");
    expect(resultEvent).toBeDefined();
    expect(resultEvent.payload.status).toBe("cancelled");
  });

  it("emits safe verbose result on command construction failure", async () => {
    const brokenAdapter = {
      buildCommand: async () => {
        throw new Error("Failed to build command with secret-12345");
      },
      name: "mock"
    };
    
    const registryMock = vi.spyOn(registryModule, "createDefaultProviderRegistry");
    registryMock.mockReturnValue({
        get: () => brokenAdapter,
        has: () => true,
        register: () => {}
    } as any);

    process.env.OPEN_DYNAMIC_WORKFLOW_VERBOSE_TEST_TOKEN = "secret-12345";
    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    await executor.execute({
      id: "broken-agent",
      label: "Broken Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    const commandEvent = events.find(e => e.type === "agent.verbose.command");
    const resultEvent = events.find(e => e.type === "agent.verbose.result");

    expect(commandEvent).toBeUndefined();
    expect(resultEvent).toBeDefined();
    expect(resultEvent.payload.status).toBe("failed");
    expect(resultEvent.payload.error.message).toContain("[REDACTED]");
    expect(resultEvent.payload.error.message).not.toContain("secret-12345");

    delete process.env.OPEN_DYNAMIC_WORKFLOW_VERBOSE_TEST_TOKEN;
    registryMock.mockRestore();
  });

  it("includes injected schema in verbose command prompt when structured output is used", async () => {
    config.providers.mock.responses["structured-agent"] = {
      text: "{}",
      exitCode: 0
    };
    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    await executor.execute({
      id: "structured-agent",
      label: "Structured Agent",
      provider: "mock",
      prompt: "Extract data",
      model: "mock-model",
      schema: { type: "object", properties: { foo: { type: "string" } } },
      structuredOutput: { transport: "prompt" },
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    const commandEvent = events.find(e => e.type === "agent.verbose.command");
    expect(commandEvent).toBeDefined();
    expect(commandEvent.payload.prompt).toContain("Extract data");
    expect(commandEvent.payload.prompt).toContain("JSON Schema:");
    expect(commandEvent.payload.prompt).toContain("\"foo\":");
  });

  it("redacts injected schema in verbose command prompt if it contains secrets", async () => {
    process.env.OPEN_DYNAMIC_WORKFLOW_VERBOSE_TEST_TOKEN = "secret-12345";
    config.providers.mock.responses["structured-agent-secret"] = {
      text: "{}",
      exitCode: 0
    };
    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    await executor.execute({
      id: "structured-agent-secret",
      label: "Structured Agent",
      provider: "mock",
      prompt: "Extract data with secret-12345",
      model: "mock-model",
      schema: { type: "object", properties: { foo: { type: "string", description: "secret-12345" } } },
      structuredOutput: { transport: "prompt" },
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    const commandEvent = events.find(e => e.type === "agent.verbose.command");
    expect(commandEvent).toBeDefined();
    expect(commandEvent.payload.prompt).toContain("[REDACTED]");
    expect(commandEvent.payload.prompt).not.toContain("secret-12345");
    
    delete process.env.OPEN_DYNAMIC_WORKFLOW_VERBOSE_TEST_TOKEN;
  });

  it("succeeds when provider command omits env", async () => {
    const registryMock = vi.spyOn(registryModule, "createDefaultProviderRegistry");
    const runProcessMock = vi.spyOn(processRunnerModule, "runProcess");

    runProcessMock.mockResolvedValue({
      exitCode: 0,
      timedOut: false,
      cancelled: false
    });

    const minimalAdapter = {
      buildCommand: async () => ({
        command: "echo",
        args: ["hello"],
        cwd: "/test/cwd"
        // env omitted
      }),
      parseResult: async (res: any) => ({
        text: "hello",
        ok: true
      }),
      execute: async () => ({
        text: "hello",
        exitCode: 0,
        stdout: "hello",
        stderr: ""
      }),
      name: "minimal"
    };

    registryMock.mockReturnValue({
      get: () => minimalAdapter,
      has: () => true,
      register: () => {}
    } as any);

    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    const result = await executor.execute({
      id: "minimal-agent",
      label: "Minimal Agent",
      provider: "minimal",
      prompt: "test",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    expect(result.ok).toBe(true);
    const commandEvent = events.find(e => e.type === "agent.verbose.command");
    expect(commandEvent).toBeDefined();
    expect(commandEvent.payload.command.env).toBeUndefined();

    registryMock.mockRestore();
    runProcessMock.mockRestore();
  });

  it("snapshots artifacts before emitting verbose command to prevent retroactive mutation", async () => {
    config.providers.mock.responses["validation-fail-agent"] = {
      text: JSON.stringify({ notFoo: 123 }),
      exitCode: 0
    };
    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    await executor.execute({
      id: "validation-fail-agent",
      label: "Validation Fail",
      provider: "mock",
      prompt: "test",
      model: "mock-model",
      schema: { type: "object", properties: { foo: { type: "string" } }, required: ["foo"] },
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    const commandEvent = events.find(e => e.type === "agent.verbose.command");
    const resultEvent = events.find(e => e.type === "agent.verbose.result");

    expect(commandEvent).toBeDefined();
    expect(resultEvent).toBeDefined();
    
    // The result should have validationErrorPath
    expect(resultEvent.payload.artifacts.validationErrorPath).toBeDefined();
    
    // The command event emitted EARLIER should NOT have validationErrorPath
    expect(commandEvent.payload.artifacts.validationErrorPath).toBeUndefined();
  });

  it("includes resolved thinkingEffort in agent.verbose.command payload when defined and omits it when undefined", async () => {
    config.providers.mock.responses["thinking-verbose-agent"] = {
      text: "Success",
      exitCode: 0
    };
    const registryMock = vi.spyOn(registryModule, "createDefaultProviderRegistry");
    registryMock.mockReturnValue({
      get: () => ({
        name: "codex",
        checkHealth: async () => ({ provider: "codex" as any, available: true }),
        lookupResponse: () => ({ stdout: "success", exitCode: 0 }),
        buildCommand: async () => ({ command: "node", args: ["-e", "process.exit(0)"] }),
        parseResult: async () => ({ text: "success" })
      }),
      has: () => true,
      register: () => {}
    } as any);

    const executor = new DefaultAgentExecutor({ config, artifactStore: store as any, eventBus });

    await executor.execute({
      id: "thinking-verbose-agent",
      label: "Thinking Verbose Agent",
      provider: "codex" as any,
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      thinkingEffort: "high"
    });

    const commandEvent = events.find(e => e.type === "agent.verbose.command");
    expect(commandEvent).toBeDefined();
    expect(commandEvent.payload.thinkingEffort).toBe("high");

    events.length = 0; // Clear events array

    await executor.execute({
      id: "thinking-verbose-agent-omit",
      label: "Thinking Verbose Agent Omit",
      provider: "codex" as any,
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: "/test/cwd",
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      thinkingEffort: undefined
    });

    const commandEventOmit = events.find(e => e.type === "agent.verbose.command");
    expect(commandEventOmit).toBeDefined();
    expect(commandEventOmit.payload).not.toHaveProperty("thinkingEffort");

    registryMock.mockRestore();
  });
});
