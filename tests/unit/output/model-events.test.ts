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

vi.mock("../../../src/agents/process-runner.js", () => ({
  runProcess: vi.fn().mockResolvedValue({
    exitCode: 0,
    timedOut: false,
    cancelled: false
  })
}));

describe("Model Events, Reports, and Artifacts", () => {
  it("pretty reporter prints provider/model when model is present in final layout", () => {
    let stdoutData = "";
    const writeMock = vi.fn((chunk) => { stdoutData += chunk.toString(); return true; });
    const mockStdout = { write: writeMock } as any;
    const reporter = new PrettyReporter({ stdout: mockStdout } as any);

    reporter.start({ meta: { name: "test-run" } } as any);

    reporter.handle({
      schemaVersion: "open-dynamic-workflow.event.v1",
      runId: "run-1",
      sequence: 1,
      timestamp: new Date().toISOString(),
      type: "agent.started",
      payload: {
        agentId: "agent-1",
        label: "agent-1",
        provider: "mock",
        model: "gpt-4o",
        cwd: "/root",
        state: "running"
      }
    });

    reporter.handle({
      schemaVersion: "open-dynamic-workflow.event.v1",
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

    reporter.finish({ status: "succeeded", durationMs: 123, artifactsDir: "/tmp" } as any);

    expect(stdoutData).toContain("✓ agent-1  mock/gpt-4o  0.1s");
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
      provider: "codex",
      prompt: "hello",
      model: "custom-resolved-model",
      thinkingEffort: "medium",
      timeoutMs: 10000,
      cwd: "/root",
      metadata: {
        modelResolutionSource: "cli",
        thinkingEffortResolutionSource: "agent"
      },
      permissions: { mode: "default" },
      signal: new AbortController().signal
    });

    expect(result.ok).toBe(true);
    expect((result as AgentSuccessResult).model).toBe("custom-resolved-model");

    const metadata = writtenFiles.get("agents/agent-test-run/metadata.json");
    expect(metadata).toEqual({
      modelResolutionSource: "cli",
      thinkingEffortResolutionSource: "agent",
      model: "custom-resolved-model",
      resolutionSource: "cli",
      structuredOutputTransport: undefined,
      permissions: { mode: "default" },
      thinkingEffort: "medium"
    });
  });
});
