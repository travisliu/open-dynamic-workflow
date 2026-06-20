import { describe, expect, it, vi } from "vitest";
import {
  createLoopRoundContext,
  withActiveLoopContext,
  getActiveLoopContext,
  recordLoopChildAgentId,
  recordLoopChildWorkflowInvocationId,
} from "../../../src/loop/context.js";

describe("Loop Context Helpers", () => {
  const mockDsl = {
    agent: vi.fn(),
    workflow: vi.fn(),
    log: vi.fn(),
  };

  const input = {
    loopId: "loop-1",
    label: "bounded-repair-loop",
    runId: "run-1",
    artifactsDir: "/tmp",
    roundIndex: 0,
    roundNumber: 1,
    signal: new AbortController().signal,
    dsl: mockDsl as any,
  };

  describe("createLoopRoundContext", () => {
    it("exposes required properties", () => {
      const ctx = createLoopRoundContext(input);
      expect(ctx.loopId).toBe("loop-1");
      expect(ctx.label).toBe("bounded-repair-loop");
      expect(ctx.roundIndex).toBe(0);
      expect(ctx.roundNumber).toBe(1);
    });

    it("ctx.agent preserves explicit agent IDs and records them", async () => {
      const ctx = createLoopRoundContext(input);
      const activeCtx = { loopId: "loop-1", label: "bounded-repair-loop", roundIndex: 0, roundNumber: 1, roundId: "round-1", childAgentIds: [], childWorkflowInvocationIds: [], signal: input.signal };
      
      await withActiveLoopContext(activeCtx, async () => {
        await ctx.agent({ prompt: "hi", id: "my-agent" });
      });

      expect(mockDsl.agent).toHaveBeenCalledWith(expect.objectContaining({
        id: "my-agent"
      }));
      expect(activeCtx.childAgentIds).toContain("my-agent");
    });

    it("ctx.agent generates loop-scoped IDs from label or counter when ID is absent", async () => {
      const ctx = createLoopRoundContext(input);
      const activeCtx = { loopId: "loop-1", label: "bounded-repair-loop", roundIndex: 0, roundNumber: 1, roundId: "round-1", childAgentIds: [], childWorkflowInvocationIds: [], signal: input.signal };
      
      await withActiveLoopContext(activeCtx, async () => {
        await ctx.agent({ prompt: "hi", label: "review" });
        await ctx.agent({ prompt: "hello" });
        await ctx.agent({ prompt: "invalid label", label: "some label with spaces" });
      });

      expect(mockDsl.agent).toHaveBeenNthCalledWith(2, expect.objectContaining({
        id: "bounded-repair-loop:round-1:review"
      }));
      expect(mockDsl.agent).toHaveBeenNthCalledWith(3, expect.objectContaining({
        id: "bounded-repair-loop:round-1:agent-2"
      }));
      expect(mockDsl.agent).toHaveBeenNthCalledWith(4, expect.objectContaining({
        id: "bounded-repair-loop:round-1:agent-3"
      }));

      expect(activeCtx.childAgentIds).toContain("bounded-repair-loop:round-1:review");
      expect(activeCtx.childAgentIds).toContain("bounded-repair-loop:round-1:agent-2");
      expect(activeCtx.childAgentIds).toContain("bounded-repair-loop:round-1:agent-3");
    });

    it("ctx.agent preserves IDs returned by ctx.agentId()", async () => {
      const ctx = createLoopRoundContext(input);
      const activeCtx = { loopId: "loop-1", label: "bounded-repair-loop", roundIndex: 0, roundNumber: 1, roundId: "round-1", childAgentIds: [], childWorkflowInvocationIds: [], signal: input.signal };
      
      await withActiveLoopContext(activeCtx, async () => {
        await ctx.agent({ prompt: "hi", id: ctx.agentId("custom-name") });
      });

      expect(mockDsl.agent).toHaveBeenNthCalledWith(5, expect.objectContaining({
        id: "bounded-repair-loop:round-1:custom-name"
      }));
      expect(activeCtx.childAgentIds).toContain("bounded-repair-loop:round-1:custom-name");
    });

    it("ctx.log includes loop metadata", () => {
      const ctx = createLoopRoundContext(input);
      ctx.log("hello", { foo: "bar" });
      expect(mockDsl.log).toHaveBeenCalledWith("hello", expect.objectContaining({
        foo: "bar",
        loop: {
          loopId: "loop-1",
          label: "bounded-repair-loop",
          roundIndex: 0,
          roundNumber: 1
        }
      }));
    });

    it("ctx.sleep removes abort listener after resolving", async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      const ctx = createLoopRoundContext({ ...input, signal });
      
      const addEventListenerSpy = vi.spyOn(signal, "addEventListener");
      const removeEventListenerSpy = vi.spyOn(signal, "removeEventListener");

      await ctx.sleep(10);

      expect(addEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("ctx.sleep removes abort listener after rejection", async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      const ctx = createLoopRoundContext({ ...input, signal });
      
      const removeEventListenerSpy = vi.spyOn(signal, "removeEventListener");

      const promise = ctx.sleep(100);
      controller.abort("manual abort");

      await expect(promise).rejects.toBe("manual abort");
      expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });
  });

  describe("ActiveLoopContext Storage", () => {
    it("manages context in AsyncLocalStorage", () => {
      const activeCtx = { loopId: "loop-1", label: "bounded-repair-loop", roundIndex: 0, roundNumber: 1, roundId: "round-1", childAgentIds: [], childWorkflowInvocationIds: [], signal: input.signal };
      withActiveLoopContext(activeCtx, () => {
        expect(getActiveLoopContext()).toBe(activeCtx);
        recordLoopChildAgentId("agent-1");
        expect(activeCtx.childAgentIds).toContain("agent-1");
        
        recordLoopChildWorkflowInvocationId("wf-1");
        recordLoopChildWorkflowInvocationId("wf-1");
        expect(activeCtx.childWorkflowInvocationIds).toEqual(["wf-1"]);
      });
      expect(getActiveLoopContext()).toBeUndefined();
    });

    it("ctx.workflow with settled result records workflowInvocationId", async () => {
      const activeCtx = { loopId: "loop-1", label: "bounded-repair-loop", roundIndex: 0, roundNumber: 1, roundId: "round-1", childAgentIds: [], childWorkflowInvocationIds: [], signal: input.signal };
      const ctx = createLoopRoundContext(input);
      mockDsl.workflow.mockResolvedValueOnce({
        workflowInvocationId: "wf-1234",
        status: "succeeded",
        result: "ok"
      });

      await withActiveLoopContext(activeCtx, async () => {
        await ctx.workflow({ name: "some-child", failureMode: "settled" });
      });

      expect(activeCtx.childWorkflowInvocationIds).toContain("wf-1234");
    });
  });
});
