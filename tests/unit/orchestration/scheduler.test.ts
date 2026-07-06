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

  it("deferred fail-fast does not abort other tasks on failure or error", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });

    const failTask = async () => {
      return { ok: false, status: "failed" } as AgentResult;
    };

    const throwTask = async () => {
      throw new Error("Task threw an error");
    };

    const successTask = async () => {
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    // Schedule a failed task with deferFailFastUntilLogicalResult: true
    const pFail = scheduler.schedule(
      { id: "t-fail", run: failTask },
      { deferFailFastUntilLogicalResult: true }
    );
    // Schedule a throwing task with deferFailFastUntilLogicalResult: true
    const pThrow = scheduler.schedule(
      { id: "t-throw", run: throwTask },
      { deferFailFastUntilLogicalResult: true }
    );
    // Schedule a successful task
    const pSuccess = scheduler.schedule(
      { id: "t-success", run: successTask }
    );

    const rFail = await pFail;
    expect(rFail.ok).toBe(false);
    expect(scheduler.getSnapshot().aborted).toBe(false);

    const rThrow = await pThrow;
    expect(rThrow.ok).toBe(false);
    expect(scheduler.getSnapshot().aborted).toBe(false);

    const rSuccess = await pSuccess;
    expect(rSuccess.ok).toBe(true);
    expect(scheduler.getSnapshot().aborted).toBe(false);
  });

  it("concurrency and queue ordering still work while deferral is enabled", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2, failFast: true });
    const order: string[] = [];

    const makeTask = (id: string, ok: boolean, delay: number) => {
      return {
        id,
        run: async () => {
          order.push(`start-${id}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          order.push(`end-${id}`);
          return { ok, status: ok ? "succeeded" : "failed" } as AgentResult;
        }
      };
    };

    const p1 = scheduler.schedule(makeTask("t1", false, 30), { deferFailFastUntilLogicalResult: true });
    const p2 = scheduler.schedule(makeTask("t2", true, 10), { deferFailFastUntilLogicalResult: true });
    const p3 = scheduler.schedule(makeTask("t3", true, 10));

    await Promise.all([p1, p2, p3]);

    // Check order and execution
    expect(order[0]).toBe("start-t1");
    expect(order[1]).toBe("start-t2");
    // t2 ends first because of 10ms delay vs t1's 30ms delay
    expect(order[2]).toBe("end-t2");
    expect(order[3]).toBe("start-t3");
    expect(order[4]).toBe("end-t3");
    expect(order[5]).toBe("end-t1");

    expect(scheduler.getSnapshot().aborted).toBe(false);
  });

  it("aborted scheduler behavior skips queued work regardless of deferral", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });

    const longTask = async (signal: AbortSignal) => {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 100);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("aborted"));
        });
      });
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    const nextTask = async () => {
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    const pLong = scheduler.schedule({ id: "t-long", run: longTask }, { deferFailFastUntilLogicalResult: true });
    const pNext = scheduler.schedule({ id: "t-next", run: nextTask }, { deferFailFastUntilLogicalResult: true });

    // Allow t-long to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Manually abort
    scheduler.abort("Force cancel");

    const rLong = await pLong;
    const rNext = await pNext;

    expect(rLong.ok).toBe(false);
    expect(rLong.status).toBe("cancelled");
    expect(rNext.ok).toBe(false);
    expect(rNext.status).toBe("skipped");
    expect(scheduler.getSnapshot().aborted).toBe(true);
  });

  it("timeout handling aborts individual task while deferral is enabled without triggering global fail-fast", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });

    const longTask = async (signal: AbortSignal) => {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 100);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("aborted"));
        });
      });
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    const nextTask = async () => {
      return { ok: true, status: "succeeded" } as AgentResult;
    };

    const pLong = scheduler.schedule(
      { id: "t-long", run: longTask },
      { timeoutMs: 10, deferFailFastUntilLogicalResult: true }
    );
    const pNext = scheduler.schedule(
      { id: "t-next", run: nextTask }
    );

    const rLong = await pLong;
    expect(rLong.ok).toBe(false);
    expect(rLong.status).toBe("cancelled"); // Task timed out and got cancelled
    expect(scheduler.getSnapshot().aborted).toBe(false); // Global scheduler is NOT aborted

    const rNext = await pNext;
    expect(rNext.ok).toBe(true);
  });
});
