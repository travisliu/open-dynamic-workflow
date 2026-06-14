import { describe, it, expect, vi } from "vitest";
import { DefaultWorkflowInvocationManager } from "../../../src/workflow/invocation-manager.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenFlowError } from "../../../src/errors/types.js";

describe("workflow recursion and depth", () => {
  const createMockRuntime = (maxDepth = 8) => ({
    runId: "test-run",
    config: { 
      workflow: { maxDepth },
      timeoutMs: 30000
    },
    args: {},
    abortController: new AbortController(),
    eventSink: { emit: vi.fn() },
    artifactStore: { 
      writeJson: vi.fn().mockResolvedValue(undefined),
      isRunCreated: () => true,
      getRunArtifacts: () => ({ reportPath: "r.json", eventsPath: "e.jsonl" })
    },
    workflowSummaries: []
  } as any);

  it("rejects direct recursion", async () => {
    const runtime = createMockRuntime();
    const defA = { name: "A", parsedWorkflow: { body: "", meta: { name: "A" } } };
    const registry = { 
      require: vi.fn().mockReturnValue(defA)
    } as any;
    
    const manager = new DefaultWorkflowInvocationManager({ 
      runtime, 
      registry, 
      evaluate: async () => ({}) 
    });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "id-a",
      workflowName: "A",
      depth: 0,
      ancestry: ["A"],
      signal: new AbortController().signal,
      deadlineAt: Infinity,
      effectiveConcurrency: 1
    } as any;

    await expect(manager.invokeChild(parentCtx, { name: "A" }))
      .rejects.toThrow(OpenFlowError);
    
    const err = await manager.invokeChild(parentCtx, { name: "A" }).catch(e => e);
    expect(err.code).toBe(ErrorCode.WORKFLOW_RECURSION_DETECTED);
  });

  it("rejects indirect recursion", async () => {
    const runtime = createMockRuntime();
    const defA = { name: "A", parsedWorkflow: { body: "", meta: { name: "A" } } };
    const registry = { 
      require: vi.fn().mockReturnValue(defA)
    } as any;
    
    const manager = new DefaultWorkflowInvocationManager({ 
      runtime, 
      registry, 
      evaluate: async () => ({}) 
    });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "id-b",
      workflowName: "B",
      depth: 1,
      ancestry: ["A", "B"],
      signal: new AbortController().signal,
      deadlineAt: Infinity,
      effectiveConcurrency: 1
    } as any;

    const err = await manager.invokeChild(parentCtx, { name: "A" }).catch(e => e);
    expect(err.code).toBe(ErrorCode.WORKFLOW_RECURSION_DETECTED);
    expect(err.message).toContain("A -> B -> A");
  });

  it("enforces max depth", async () => {
    const runtime = createMockRuntime(2);
    const defC = { name: "C", parsedWorkflow: { body: "", meta: { name: "C" } } };
    const registry = { 
      require: vi.fn().mockReturnValue(defC)
    } as any;
    
    const manager = new DefaultWorkflowInvocationManager({ 
      runtime, 
      registry, 
      evaluate: async () => ({}) 
    });
    
    const parentCtx = {
      runId: "test-run",
      workflowInvocationId: "id-b",
      workflowName: "B",
      depth: 2, // Already at max depth
      ancestry: ["A", "B"],
      signal: new AbortController().signal,
      deadlineAt: Infinity,
      effectiveConcurrency: 1
    } as any;

    const err = await manager.invokeChild(parentCtx, { name: "C" }).catch(e => e);
    expect(err.code).toBe(ErrorCode.WORKFLOW_MAX_DEPTH_EXCEEDED);
  });

  describe("nested sequencing and cache", () => {
    it("shares one monotonic sequence across root and child workflows", async () => {
      const runtime = {
        runId: "run-seq",
        config: { timeoutMs: 30000 },
        callSequence: 0,
        eventSink: { emit: vi.fn() },
        artifactStore: { 
          isRunCreated: () => true, 
          getRunArtifacts: () => ({ workflowInvocationDir: (id: string) => `workflows/${id}` }),
          writeJson: vi.fn().mockResolvedValue("")
        },
        workflowSummaries: [],
        agentResults: [],
        abortController: new AbortController()
      } as any;

      const registry = { 
        require: (name: string) => ({ name, parsedWorkflow: { body: "", meta: { name } } })
      } as any;

      const manager = new DefaultWorkflowInvocationManager({
        runtime,
        registry,
        evaluate: async (ctx) => {
          const dsl = (await import("../../../src/workflow/dsl.js")).createDsl(runtime);
          if (ctx.workflowName === "Root") {
            await dsl.agent({ prompt: "root-1" });
            await dsl.workflow({ name: "Child" });
            await dsl.agent({ prompt: "root-2" });
          } else {
            await dsl.agent({ prompt: "child-1" });
          }
          return {};
        }
      });
      runtime.invocationManager = manager;

      // Mock scheduler to return success
      runtime.scheduler = {
        schedule: vi.fn().mockResolvedValue({ ok: true, status: "succeeded", id: "a", artifacts: {} }),
        drain: vi.fn()
      } as any;

      await manager.executeRoot(registry.require("Root"), {});

      expect(runtime.callSequence).toBe(3);
      const scheduledIds = runtime.scheduler.schedule.mock.calls.map((c: any) => c[0].id);
      expect(scheduledIds).toHaveLength(3);
    });

    it("child-workflow mismatch disables later prefix reuse globally", async () => {
      const cache = {
        readEnabled: true,
        previousRunRoot: "/tmp/prev",
        previousEntries: new Map([
          [1, { sequence: 1, fingerprint: "fp-root-1", status: "succeeded" }],
          [2, { sequence: 2, fingerprint: "fp-child-1-MISMATCH", status: "succeeded" }],
          [3, { sequence: 3, fingerprint: "fp-root-2", status: "succeeded" }]
        ]),
        prefixCacheUsable: true,
        currentEntries: []
      };

      const runtime = {
        runId: "run-disable",
        config: { timeoutMs: 30000 },
        callSequence: 0,
        callCache: cache,
        eventSink: { emit: vi.fn() },
        artifactStore: { 
          isRunCreated: () => true, 
          getRunArtifacts: () => ({ workflowInvocationDir: (id: string) => `workflows/${id}` }),
          writeJson: vi.fn().mockResolvedValue("")
        },
        workflowSummaries: [],
        agentResults: [],
        abortController: new AbortController()
      } as any;

      const registry = { 
        require: (name: string) => ({ name, parsedWorkflow: { body: "", meta: { name } } })
      } as any;

      const manager = new DefaultWorkflowInvocationManager({
        runtime,
        registry,
        evaluate: async (ctx) => {
          const dsl = (await import("../../../src/workflow/dsl.js")).createDsl(runtime);
          if (ctx.workflowName === "Root") {
            await dsl.agent({ prompt: "root-1" });
            await dsl.workflow({ name: "Child" });
            await dsl.agent({ prompt: "root-2" });
          } else {
            await dsl.agent({ prompt: "child-1" });
          }
          return {};
        }
      });
      runtime.invocationManager = manager;

      runtime.scheduler = {
        schedule: vi.fn().mockResolvedValue({ ok: true, status: "succeeded", id: "a", artifacts: {} }),
        drain: vi.fn()
      } as any;

      // Mock computeAgentFingerprint to return constant values for this test
      vi.mock("../../../src/artifacts/call-cache.js", async (importActual) => {
        const actual = await importActual<any>();
        return {
          ...actual,
          computeAgentFingerprint: (input: any) => {
            if (input.call.prompt === "root-1") return "fp-root-1";
            if (input.call.prompt === "child-1") return "fp-child-1-ACTUAL";
            if (input.call.prompt === "root-2") return "fp-root-2";
            return "unknown";
          },
          materializeCachedAgentResult: vi.fn().mockResolvedValue({ ok: true, status: "succeeded", artifacts: {} }),
          recordCall: vi.fn()
        };
      });

      await manager.executeRoot(registry.require("Root"), {});

      // Call 1: root-1 -> Match
      // Call 2: child-1 -> Mismatch -> disables cache
      // Call 3: root-2 -> No check (cache disabled)
      
      expect(cache.prefixCacheUsable).toBe(false);
      // Scheduled calls: Call 2 and Call 3 (Call 1 was hit)
      expect(runtime.scheduler.schedule).toHaveBeenCalledTimes(2);
    });
  });
});
