import { describe, it, expect, vi } from "vitest";
import { executeSharedAgent } from "../../../src/shared-agents/execute.js";
import { SharedAgentRegistry } from "../../../src/shared-agents/registry.js";
import type { SharedAgentRegistryEntry } from "../../../src/shared-agents/types.js";
import type { AgentCallInput, AgentResult } from "../../../src/types/agent.js";
import type { ResolvedConfig } from "../../../src/types/config.js";

describe("executeSharedAgent", () => {
  const mockConfig = {
    sharedAgents: {
      strictPromptTemplateVariables: true
    }
  } as ResolvedConfig;

  const mockDeps = {
    config: mockConfig,
    runId: "run-1",
    cwd: "/repo",
    signal: new AbortController().signal,
    agent: vi.fn(),
    log: vi.fn(),
    artifactsDir: "/repo/.openflow/runs/run-1",
  };

  it("uses custom ID from context if provided", async () => {
    const registry = new SharedAgentRegistry();
    const entry: SharedAgentRegistryEntry = {
      id: "test-agent",
      sourcePath: "test.agent.js",
      definition: {
        id: "test-agent",
        description: "Test Agent",
        run: async (ctx, runtime) => {
          return await runtime.agent({ prompt: "Prompt", id: ctx.id as string });
        }
      },
      validatedAt: new Date().toISOString()
    };
    registry.register(entry);

    mockDeps.agent.mockResolvedValue({ ok: true, status: "succeeded" } as AgentResult);

    await executeSharedAgent({
      sharedAgentId: "test-agent",
      context: { id: "custom-id" },
      origin: "workflow"
    }, { ...mockDeps, registry });

    expect(mockDeps.agent).toHaveBeenCalledWith(expect.objectContaining({
      id: "custom-id"
    }));
  });

  it("throws for missing agent in registry", async () => {
    const registry = new SharedAgentRegistry();
    await expect(executeSharedAgent({
      sharedAgentId: "missing",
      origin: "workflow"
    }, { ...mockDeps, registry })).rejects.toThrow(/was not found in the configured registry/);
  });

  it("throws for invalid context", async () => {
    const registry = new SharedAgentRegistry();
    const entry: SharedAgentRegistryEntry = {
      id: "test-agent",
      sourcePath: "test.agent.js",
      definition: {
        id: "test-agent",
        description: "Test Agent",
        run: async () => ({ ok: true, status: "succeeded" } as AgentResult),
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "number" }
          }
        }
      },
      validatedAt: new Date().toISOString()
    };
    registry.register(entry);

    await expect(executeSharedAgent({
      sharedAgentId: "test-agent",
      context: { input: "not-a-number" },
      origin: "workflow"
    }, { ...mockDeps, registry })).rejects.toThrow(/context validation failed/);
  });

  it("executes a function-based shared agent successfully", async () => {
    const registry = new SharedAgentRegistry();
    const entry: SharedAgentRegistryEntry = {
      id: "func-agent",
      sourcePath: "test.agent.js",
      definition: {
        id: "func-agent",
        description: "Func Agent",
        run: async (ctx, runtime) => {
          runtime.log("Running func agent");
          return await runtime.agent({ prompt: "func prompt" });
        }
      },
      validatedAt: new Date().toISOString()
    };
    registry.register(entry);

    mockDeps.agent.mockResolvedValue({ ok: true, status: "succeeded" } as AgentResult);

    const result = await executeSharedAgent({
      sharedAgentId: "func-agent",
      context: {},
      origin: "workflow"
    }, { ...mockDeps, registry });

    expect(result.ok).toBe(true);
    expect(mockDeps.log).toHaveBeenCalledWith("Running func agent");
    expect(mockDeps.agent).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "func prompt"
    }));
  });

  it("executes a function-based shared agent with both agentPrompt and run", async () => {
    const registry = new SharedAgentRegistry();
    const entry: SharedAgentRegistryEntry = {
      id: "hybrid-agent",
      sourcePath: "test.agent.js",
      definition: {
        id: "hybrid-agent",
        description: "Hybrid Agent",
        agentPrompt: "Template: {{val}}",
        inputSchema: {
          type: "object",
          properties: {
            val: { type: "string" }
          }
        },
        run: async (ctx, runtime) => {
          const prompt = runtime.renderAgentPrompt(ctx);
          const outDir = runtime.artifactsDir;
          return await runtime.agent({ prompt, metadata: { outDir } });
        }
      },
      validatedAt: new Date().toISOString()
    };
    registry.register(entry);

    mockDeps.agent.mockResolvedValue({ ok: true, status: "succeeded" } as AgentResult);

    const result = await executeSharedAgent({
      sharedAgentId: "hybrid-agent",
      context: { val: "test-value" },
      origin: "workflow"
    }, { ...mockDeps, registry });

    expect(result.ok).toBe(true);
    expect(mockDeps.agent).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Template: test-value",
      metadata: expect.objectContaining({
        outDir: "/repo/.openflow/runs/run-1"
      })
    }));
  });

  it("throws when calling renderAgentPrompt if definition lacks agentPrompt", async () => {
    const registry = new SharedAgentRegistry();
    const entry: SharedAgentRegistryEntry = {
      id: "no-prompt-agent",
      sourcePath: "test.agent.js",
      definition: {
        id: "no-prompt-agent",
        description: "No Prompt Agent",
        run: async (ctx, runtime) => {
          runtime.renderAgentPrompt(ctx);
          return { ok: true, status: "succeeded" } as AgentResult;
        }
      },
      validatedAt: new Date().toISOString()
    };
    registry.register(entry);

    await expect(executeSharedAgent({
      sharedAgentId: "no-prompt-agent",
      context: {},
      origin: "workflow"
    }, { ...mockDeps, registry })).rejects.toThrow(/Cannot render agent prompt because 'agentPrompt' is not defined/);
  });
});
