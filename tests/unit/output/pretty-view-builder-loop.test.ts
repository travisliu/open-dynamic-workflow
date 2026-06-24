import { describe, it, expect } from "vitest";
import { PrettyViewBuilder } from "../../../src/output/pretty-view-builder.js";
import type { EventEnvelope } from "../../../src/output/events.js";
import type { WorkflowNode, LoopNode } from "../../../src/output/pretty-view.js";

describe("PrettyViewBuilder - Loops", () => {
  it("should aggregate loop started and terminal events", () => {
    const builder = new PrettyViewBuilder();
    builder.addStart({ meta: { name: "loop-run" } } as any);

    const events: EventEnvelope[] = [
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "root-id", workflowName: "root" },
      },
      {
        type: "loop.started",
        payload: { loopId: "loop-1", label: "my-loop", maxRounds: 5, workflowInvocationId: "root-id" },
      },
      {
        type: "loop.round.completed",
        payload: { loopId: "loop-1", roundIndex: 0, roundNumber: 1, status: "completed", durationMs: 100 },
      },
      {
        type: "loop.round.completed",
        payload: { loopId: "loop-1", roundIndex: 1, roundNumber: 2, status: "completed", durationMs: 120 },
      },
      {
        type: "loop.completed",
        payload: { 
          loopId: "loop-1", 
          status: "succeeded", 
          roundsCompleted: 2, 
          roundCount: 2,
          maxRounds: 5, 
          durationMs: 300, 
          reason: "done" 
        },
      },
      {
        type: "workflow.invocation.completed",
        payload: { workflowInvocationId: "root-id", durationMs: 500 },
      },
    ] as any[];

    for (const e of events) builder.addEvent(e);

    const view = builder.build({ status: "succeeded", durationMs: 500 } as any);

    expect(view.execution).toHaveLength(1);
    const rootNode = view.execution[0] as WorkflowNode;
    expect(rootNode.children).toHaveLength(1);
    
    const loopNode = rootNode.children[0] as LoopNode;
    expect(loopNode.kind).toBe("loop");
    expect(loopNode.label).toBe("my-loop");
    expect(loopNode.status).toBe("succeeded");
    expect(loopNode.roundCount).toBe(2);
    expect(loopNode.maxRounds).toBe(5);
    expect(loopNode.reason).toBe("done");

    expect(view.summary.loopCounts.total).toBe(1);
    expect(view.summary.loopCounts.succeeded).toBe(1);
  });

  it("should handle failed loops", () => {
    const builder = new PrettyViewBuilder();
    builder.addStart({ meta: { name: "loop-fail" } } as any);

    const events: EventEnvelope[] = [
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "root-id", workflowName: "root" },
      },
      {
        type: "loop.started",
        payload: { loopId: "loop-1", label: "my-loop", maxRounds: 5, workflowInvocationId: "root-id", artifactPath: "loops/loop-1" },
      },
      {
        type: "loop.failed",
        payload: { 
          loopId: "loop-1", 
          status: "failed", 
          roundsCompleted: 1, 
          roundCount: 1,
          maxRounds: 5, 
          durationMs: 200, 
          artifactPath: "loops/loop-1",
          error: { message: "fail" }
        },
      },
      {
        type: "workflow.invocation.failed",
        payload: { workflowInvocationId: "root-id", durationMs: 300 },
      },
    ] as any[];

    for (const e of events) builder.addEvent(e);

    const view = builder.build({ status: "failed", durationMs: 300 } as any);

    const rootNode = view.execution[0] as WorkflowNode;
    const loopNode = rootNode.children[0] as LoopNode;
    expect(loopNode.status).toBe("failed");
    expect(loopNode.artifactPath).toBe("loops/loop-1");

    expect(view.failureRecords).toHaveLength(2);
    expect(view.failureRecords.find(r => r.kind === "loop")?.artifactSubpath).toBe("loops/loop-1");
  });

  it("should fallback to active workflow ID if workflowInvocationId is missing in loop.started", () => {
    const builder = new PrettyViewBuilder();
    builder.addStart({ meta: { name: "loop-run" } } as any);

    const events: EventEnvelope[] = [
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "root-id", workflowName: "root" },
      },
      {
        type: "loop.started",
        payload: { loopId: "loop-1", label: "my-loop", maxRounds: 5 },
      },
    ] as any[];

    for (const e of events) builder.addEvent(e);

    const view = builder.build({ status: "succeeded", durationMs: 500 } as any);

    expect(view.execution).toHaveLength(1);
    const rootNode = view.execution[0] as WorkflowNode;
    expect(rootNode.children).toHaveLength(1);
    const loopNode = rootNode.children[0] as LoopNode;
    expect(loopNode.id).toBe("loop-1");
  });

  it("should aggregate tool.cache_hit event inside a loop", () => {
    const builder = new PrettyViewBuilder();
    builder.addStart({ meta: { name: "loop-run" } } as any);

    const events: EventEnvelope[] = [
      {
        type: "workflow.invocation.started",
        payload: { workflowInvocationId: "root-id", workflowName: "root" },
      },
      {
        type: "loop.started",
        payload: { loopId: "loop-1", label: "my-loop", maxRounds: 5, workflowInvocationId: "root-id" },
      },
      {
        type: "tool.cache_hit",
        payload: {
          toolCallId: "tool-1",
          definition: "echo",
          label: "my-echo",
          loopId: "loop-1",
          artifactPath: "tools/tool-1/output.json"
        }
      },
      {
        type: "loop.completed",
        payload: {
          loopId: "loop-1",
          status: "succeeded",
          roundsCompleted: 1,
          roundCount: 1,
          maxRounds: 5,
          durationMs: 300,
        },
      },
      {
        type: "workflow.invocation.completed",
        payload: { workflowInvocationId: "root-id", durationMs: 500 },
      },
    ] as any[];

    for (const e of events) builder.addEvent(e);

    const view = builder.build({ status: "succeeded", durationMs: 500 } as any);

    const rootNode = view.execution[0] as WorkflowNode;
    const loopNode = rootNode.children[0] as LoopNode;
    expect(loopNode.children).toHaveLength(1);

    const toolNode = loopNode.children![0] as any;
    expect(toolNode.kind).toBe("tool");
    expect(toolNode.id).toBe("tool-1");
    expect(toolNode.label).toBe("my-echo");
    expect(toolNode.status).toBe("succeeded");
    expect(toolNode.cached).toBe(true);
    expect(toolNode.artifactPath).toBe("tools/tool-1/output.json");
  });
});
