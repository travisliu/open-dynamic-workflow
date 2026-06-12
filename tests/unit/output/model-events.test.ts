import { describe, expect, it, vi } from "vitest";
import { PrettyReporter } from "../../../src/output/pretty-reporter.js";
import { DefaultAgentExecutor } from "../../../src/agents/execute-agent.js";
import { EventBus } from "../../../src/orchestration/event-bus.js";
import type { ArtifactStore } from "../../../src/types/artifacts.js";
import type { AgentSuccessResult } from "../../../src/types/agent.js";
import { MockAdapter } from "../../../src/agents/mock-adapter.js";
import { createDefaultProviderRegistry } from "../../../src/agents/registry.js";

vi.mock("../../../src/agents/registry.js", () => {
  return {
    createDefaultProviderRegistry: vi.fn().mockReturnValue({
      get: () => new MockAdapter()
    })
  };
});

describe("Model Events, Reports, and Artifacts", () => {
  it("verbose pretty reporter prints provider/model when model is present", () => {
    const writeMock = vi.fn();
    const mockStdout = { write: writeMock } as any;
    const reporter = new PrettyReporter({ stdout: mockStdout } as any, { verbose: true });

    reporter.handle({
      schemaVersion: "openflow.event.v1",
      runId: "run-1",
      sequence: 1,
      timestamp: new Date().toISOString(),
      type: "agent.started",
      payload: {
        agentId: "agent-1",
        provider: "mock",
        model: "gpt-4o",
        cwd: "/root",
        state: "running"
      }
    });

    expect(writeMock).toHaveBeenCalledWith(expect.stringContaining("▶ agent-1 started [mock/gpt-4o]"));

    reporter.handle({
      schemaVersion: "openflow.event.v1",
      runId: "run-1",
      sequence: 2,
      timestamp: new Date().toISOString(),
      type: "agent.completed",
      payload: {
        agentId: "agent-1",
        provider: "mock",
        model: "gpt-4o",
        status: "succeeded",
        durationMs: 123,
        exitCode: 0,
        artifacts: { dir: "" } as any
      }
    });

    expect(writeMock).toHaveBeenCalledWith(expect.stringContaining("✓ agent-1 succeeded [mock/gpt-4o]"));
  });

  it("non-verbose pretty reporter prints only provider even if model is present", () => {
    const writeMock = vi.fn();
    const mockStdout = { write: writeMock } as any;
    const reporter = new PrettyReporter({ stdout: mockStdout } as any, { verbose: false });

    reporter.handle({
      schemaVersion: "openflow.event.v1",
      runId: "run-1",
      sequence: 1,
      timestamp: new Date().toISOString(),
      type: "agent.started",
      payload: {
        agentId: "agent-1",
        provider: "mock",
        model: "gpt-4o",
        cwd: "/root",
        state: "running"
      }
    });

    expect(writeMock).toHaveBeenCalledWith(expect.stringContaining("▶ agent-1 started [mock]"));
  });

  it("DefaultAgentExecutor writes metadata.json containing model and source, and returns model in results", async () => {
    const writtenFiles = new Map<string, any>();
    const mockArtifactStore: ArtifactStore = {
      isRunCreated: () => true,
      createRun: async () => {},
      writeText: async (path, content) => {
        writtenFiles.set(path, content);
      },
      writeJson: async (path, json) => {
        writtenFiles.set(path, json);
      },
      appendText: async () => {},
      readText: async () => "",
      readJson: async () => ({}),
      listArtifacts: async () => [],
      getRunSummary: async () => ({} as any),
      writeFinalReport: async () => {}
    };

    const eventBusMock = {
      emit: vi.fn(),
      drain: async () => {}
    } as any;

    const executor = new DefaultAgentExecutor({
      config: {
        defaultProvider: "mock",
        concurrency: 4,
        timeoutMs: 30000,
        providers: {
          mock: {
            command: "mock",
            args: [],
            defaultModel: null
          }
        },
        security: {
          passEnv: [],
          redactEnv: [],
          allowWorkflowImports: false
        },
        reporting: {
          mode: "pretty",
          verbose: false
        },
        cwd: "/root",
        outDir: "runs",
        cliArgs: {}
      },
      artifactStore: mockArtifactStore,
      eventBus: eventBusMock
    });

    const result = await executor.execute({
      id: "agent-test-run",
      provider: "mock",
      prompt: "hello",
      model: "custom-resolved-model",
      timeoutMs: 10000,
      cwd: "/root",
      metadata: {
        modelResolutionSource: "cli"
      },
      permissions: { mode: "default" },
      signal: new AbortController().signal
    });

    expect(result.ok).toBe(true);
    expect((result as AgentSuccessResult).model).toBe("custom-resolved-model");

    const metadata = writtenFiles.get("agents/agent-test-run/metadata.json");
    expect(metadata).toEqual({
      modelResolutionSource: "cli",
      model: "custom-resolved-model",
      resolutionSource: "cli",
      structuredOutputTransport: undefined,
      permissions: { mode: "default" }
    });
  });
});
