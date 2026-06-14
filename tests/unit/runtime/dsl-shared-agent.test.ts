import { describe, it, expect, vi } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { RuntimeState } from "../../../src/workflow/types.js";
import { SharedAgentRegistry } from "../../../src/shared-agents/registry.js";
import type { AgentCallInput, AgentResult } from "../../../src/types/agent.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenFlowError } from "../../../src/errors/types.js";

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
    await expect(dsl.agent({ definition: "security-review", unexpected: true })).rejects.toThrow(OpenFlowError);
    
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

    await expect(dsl.agent({ definition: "nested-agent" })).rejects.toThrow(OpenFlowError);
  });

  it("existing agent still works", async () => {
    const runtime = createMockRuntime();
    const dsl = createDsl(runtime);

    const result = await dsl.agent({ prompt: "hello" });
    expect(result.ok).toBe(true);
    expect(runtime.scheduler.schedule).toHaveBeenCalled();
  });
});
