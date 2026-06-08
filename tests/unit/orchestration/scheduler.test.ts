import { describe, expect, it } from "vitest";
import { DefaultScheduler } from "../../../src/orchestration/scheduler.js";
import type { AgentResult } from "../../../src/types/agent.js";
import type { ScheduledTask } from "../../../src/types/scheduler.js";

describe("DefaultScheduler", () => {
  it("enforces global concurrency limits", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });
    let activeTasks = 0;
    let maxActiveTasks = 0;

    const taskFn = async (signal: AbortSignal) => {
      activeTasks++;
      maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeTasks--;
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    const t1: ScheduledTask<AgentResult> = { id: "t1", run: taskFn };
    const t2: ScheduledTask<AgentResult> = { id: "t2", run: taskFn };
    const t3: ScheduledTask<AgentResult> = { id: "t3", run: taskFn };
    const t4: ScheduledTask<AgentResult> = { id: "t4", run: taskFn };

    const promises = [
      scheduler.schedule(t1),
      scheduler.schedule(t2),
      scheduler.schedule(t3),
      scheduler.schedule(t4)
    ];

    await Promise.all(promises);
    expect(maxActiveTasks).toBeLessThanOrEqual(2);
    expect(scheduler.getSnapshot().completedCount).toBe(4);
  });

  it("drain waits for queued and running tasks", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1 });
    let completed = 0;

    const taskFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed++;
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    scheduler.schedule({ id: "t1", run: taskFn });
    scheduler.schedule({ id: "t2", run: taskFn });

    await scheduler.drain();
    expect(completed).toBe(2);
  });

  it("fail-fast aborts running and skips queued tasks", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });
    
    const successTask = async () => {
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    const failTask = async () => {
      return { ok: false, status: "failed" } as AgentResult;
    };

    const longTask = async (signal: AbortSignal) => {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 100);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("aborted"));
        });
      });
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    const r1 = await scheduler.schedule({ id: "t1", run: successTask });
    expect(r1.ok).toBe(true);

    const pFail = scheduler.schedule({ id: "t2", run: failTask });
    const pLong = scheduler.schedule({ id: "t3", run: longTask });

    const r2 = await pFail;
    expect(r2.ok).toBe(false);

    // t3 should be cancelled / skipped since it was queued/running after fail-fast
    const r3 = await pLong;
    expect(r3.ok).toBe(false);
    expect(r3.status === "skipped" || r3.status === "cancelled").toBe(true);
    expect(scheduler.getSnapshot().aborted).toBe(true);
  });

  it("scheduler abort propagates signal to running tasks", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });
    let t1Aborted = false;

    const task1 = async (signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          t1Aborted = true;
          resolve();
        });
      });
      return { ok: false, status: "cancelled" } as AgentResult;
    };

    const promise1 = scheduler.schedule({ id: "t1", run: task1 });
    
    // Allow t1 to start
    await new Promise((resolve) => setTimeout(resolve, 5));
    
    scheduler.abort("Manual cancel");

    const r1 = await promise1;
    expect(t1Aborted).toBe(true);
    expect(r1.ok).toBe(false);
    expect(r1.status).toBe("cancelled");
  });

  it("emits events containing permissions", async () => {
    const events: Array<{ type: string; payload: any }> = [];
    const eventSink = {
      emit: (type: string, payload: any) => {
        events.push({ type, payload });
      }
    };
    const scheduler = new DefaultScheduler({ concurrency: 1 }, { eventSink });

    const taskFn = async () => {
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    const task = {
      id: "t1",
      permissions: { mode: "dangerously-full-access" as const },
      run: taskFn
    };

    await scheduler.schedule(task);

    const queuedEvent = events.find((e) => e.type === "agent.queued");
    expect(queuedEvent).toBeDefined();
    expect(queuedEvent?.payload.permissions).toEqual({ mode: "dangerously-full-access" });

    const startedEvent = events.find((e) => e.type === "agent.started");
    expect(startedEvent).toBeDefined();
    expect(startedEvent?.payload.permissions).toEqual({ mode: "dangerously-full-access" });

    const completedEvent = events.find((e) => e.type === "agent.completed");
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.payload.permissions).toEqual({ mode: "dangerously-full-access" });
  });
});
