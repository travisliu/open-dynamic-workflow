import { describe, it, expect, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { RuntimeState } from "../../../src/workflow/types.js";
import { SharedAgentRegistry } from "../../../src/shared-agents/registry.js";
import type { AgentCallInput, AgentResult } from "../../../src/types/agent.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

describe("DSL shared-agent calls", () => {
  const createMockRuntime = (registry?: SharedAgentRegistry): RuntimeState => ({
    runId: "run-1",
    parsedWorkflow: {
      meta: { name: "test", description: "test" },
      body: "",
      sourcePath: "test.js",
      sourceHash: "123",
      sourceText: ""
    },
    config: {
      defaultProvider: "mock",
      concurrency: 1,
      timeoutMs: 30000,
      providers: {},
      security: { allowWorkflowImports: false, passEnv: [], redactEnv: [] },
      reporting: { mode: "pretty", verbose: false },
      sharedAgents: { paths: [], allowDynamicIds: false, maxDefinitions: 100, strictPromptTemplateVariables: true },
      cwd: "/repo",
      outDir: "/out"
    } as any,
    cli: { args: {} } as any,
    args: {},
    cwd: "/repo",
    artifactsDir: "/out/run-1",
    agentResults: [],
    scheduler: {
      schedule: vi.fn().mockResolvedValue({ ok: true, status: "succeeded" } as AgentResult),
      abort: vi.fn(),
      drain: vi.fn()
    } as any,
    agentExecutor: { execute: vi.fn() } as any,
    eventSink: { emit: vi.fn() } as any,
    abortController: new AbortController(),
    agentCounter: 0,
    startedAt: new Date().toISOString(),
    sharedAgentRegistry: registry
  });

  it("agent({ definition }) calls executeSharedAgent", async () => {
    const registry = new SharedAgentRegistry();
    registry.register({
      id: "test-agent",
      sourcePath: "test.agent.js",
      definition: {
        id: "test-agent",
        description: "Test",
        inputSchema: { type: "object", properties: { name: { type: "string" } } },
        run: async (context, runtime) => {
          return await runtime.agent({ prompt: `Hello ${context.name}`, provider: "mock" });
        }
      },
      validatedAt: new Date().toISOString()
    });

    const runtime = createMockRuntime(registry);
    const dsl = createDsl(runtime);

    const result = await dsl.agent({ definition: "test-agent", name: "World" });
    expect(result.ok).toBe(true);
    expect(runtime.scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        label: "test-agent",
        metadata: expect.objectContaining({
          sharedAgentId: "test-agent"
        }),
        run: expect.any(Function)
      }),
      expect.any(Object)
    );
  });

  it("throws if registry is missing", async () => {
    const runtime = createMockRuntime(undefined);
    const dsl = createDsl(runtime);

    await expect(dsl.agent({ definition: "test-agent" })).rejects.toThrow(/Shared agent registry is not available/);
  });

  it("converts schema validation failures to failed agent results", async () => {
    const registry = new SharedAgentRegistry();
    registry.register({
      id: "security-review",
      sourcePath: "security.js",
      definition: {
        id: "security-review",
        description: "Review",
        inputSchema: {
          type: "object",
          required: ["prompt"],
          properties: {
            definition: { type: "string" },
            prompt: { type: "string" }
          }
        },
        run: async (context, runtime) => {
          return await runtime.agent({ prompt: context.prompt as string });
        }
      },
      validatedAt: new Date().toISOString()
    });

    const runtime = createMockRuntime(registry);
    const dsl = createDsl(runtime);

    // Call agent without the required 'prompt' field
    await expect(dsl.agent({ definition: "security-review", unexpected: true })).rejects.toThrow(OpenDynamicWorkflowError);
    
    // Check that a failed agent result is recorded in runtime.agentResults
    expect(runtime.agentResults).toHaveLength(1);
    const failResult = runtime.agentResults[0];
    expect(failResult.ok).toBe(false);
    expect(failResult.label).toBe("security-review");
    expect(failResult.error.code).toBe("SHARED_AGENT_CONTEXT_VALIDATION_FAILED");
  });

  it("rejects nested definition calls from inside definitions", async () => {
    const registry = new SharedAgentRegistry();
    registry.register({
      id: "nested-agent",
      sourcePath: "nested.js",
      definition: {
        id: "nested-agent",
        description: "Nested",
        run: async (context, runtime) => {
          // Attempting nested call should be disallowed by typed agent interface
          return await (runtime.agent as any)({ definition: "other-agent" });
        }
      },
      validatedAt: new Date().toISOString()
    });

    const runtime = createMockRuntime(registry);
    const dsl = createDsl(runtime);

    await expect(dsl.agent({ definition: "nested-agent" })).rejects.toThrow(OpenDynamicWorkflowError);
  });

  it("existing agent still works", async () => {
    const runtime = createMockRuntime();
    const dsl = createDsl(runtime);

    const result = await dsl.agent({ prompt: "hello" });
    expect(result.ok).toBe(true);
    expect(runtime.scheduler.schedule).toHaveBeenCalled();
  });

  describe("cache interaction", () => {
    it("inner direct agent calls can hit cache", async () => {
      const registry = new SharedAgentRegistry();
      registry.register({
        id: "cached-wrapper",
        sourcePath: "cached-wrapper.js",
        definition: {
          id: "cached-wrapper",
          run: async (context, runtime) => {
            return await runtime.agent({ prompt: "constant prompt", provider: "mock" });
          }
        },
        validatedAt: new Date().toISOString()
      });

      const runtime = createMockRuntime(registry);
      runtime.callSequence = 0;

      const enrichedInput = {
        prompt: "constant prompt",
        provider: "mock",
        label: "cached-wrapper",
        metadata: {
          sharedAgentId: "cached-wrapper",
          sharedAgentSource: "registry"
        }
      };

      const fingerprint = (await import("../../../src/artifacts/call-cache.js")).computeAgentFingerprint({
        call: enrichedInput,
        provider: "mock",
        timeoutMs: 30000,
        cwd: "/repo",
        providerConfig: undefined
      });

      runtime.callCache = {
        readEnabled: true,
        previousRunRoot: "/tmp/prev",
        previousEntries: new Map([[1, {
          kind: "agent",
          sequence: 1,
          callId: "cached-wrapper",
          fingerprint,
          status: "succeeded",
          resultPath: "agents/old/res.json",
          agentId: "old"
        }]]),
        prefixCacheUsable: true,
        currentEntries: []
      } as any;

      runtime.artifactStore = {
        getRunArtifacts: () => ({ rootDir: "/tmp/new" }),
        isRunCreated: () => true,
        writeText: vi.fn(),
        writeJson: vi.fn(),
        appendJsonl: vi.fn()
      } as any;

      // Mock fs read for materializeCachedAgentResult
      vi.mock("node:fs/promises", async (importActual) => {
        const actual = await importActual<any>();
        return {
          ...actual,
          readFile: vi.fn().mockResolvedValue(JSON.stringify({ text: "cached answer" }))
        };
      });

      const dsl = createDsl(runtime);
      const result = await dsl.agent({ definition: "cached-wrapper" });

      expect(result.ok).toBe(true);
      expect(result.cache).toBeUndefined();
      expect(runtime.scheduler.schedule).not.toHaveBeenCalled();
    });
  });

  it("shared-agent specifies thinkingEffort and propagates to executor", async () => {
    const registry = new SharedAgentRegistry();
    registry.register({
      id: "thinking-shared-agent",
      sourcePath: "thinking.agent.js",
      definition: {
        id: "thinking-shared-agent",
        description: "Test thinking effort inside shared agent",
        run: async (context, runtime) => {
          return await runtime.agent({ prompt: "Hello", provider: "mock", thinkingEffort: "high" });
        }
      },
      validatedAt: new Date().toISOString()
    });

    const executor = { execute: vi.fn().mockResolvedValue({ ok: true, status: "succeeded" } as AgentResult) };
    const scheduler = {
      schedule: vi.fn(async (task: any) => {
        return task.run(new AbortController().signal);
      }),
      abort: vi.fn(),
      drain: vi.fn()
    };

    const runtime = createMockRuntime(registry);
    runtime.scheduler = scheduler as any;
    runtime.agentExecutor = executor as any;
    const dsl = createDsl(runtime);

    const result = await dsl.agent({ definition: "thinking-shared-agent" });
    expect(result.ok).toBe(true);

    expect(executor.execute).toHaveBeenCalledTimes(1);
    const execInput = executor.execute.mock.calls[0]![0];
    expect(execInput.thinkingEffort).toBe("high");
    expect(execInput.metadata?.thinkingEffortResolutionSource).toBe("agent");
  });
});
