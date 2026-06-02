import { describe, expect, it } from "vitest";
import { DefaultScheduler } from "../../../src/orchestration/scheduler.js";
import type { AgentResult } from "../../../src/types/agent.js";
import type { ScheduledTask } from "../../../src/types/scheduler.js";

function makeSuccessResult(id: string): AgentResult {
  return {
    ok: true,
    status: "succeeded",
    id,
    provider: "mock",
    stdout: `done ${id}`,
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    }
  });
}

describe("Scheduler: concurrency enforcement", () => {
  it("concurrency=1 never runs more than one task at once", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1 });
    let active = 0;
    let maxActive = 0;

    const makeTask = (id: string): ScheduledTask<AgentResult> => ({
      id,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(20);
        active--;
        return makeSuccessResult(id);
      }
    });

    await Promise.all([
      scheduler.schedule(makeTask("t1")),
      scheduler.schedule(makeTask("t2")),
      scheduler.schedule(makeTask("t3"))
    ]);

    expect(maxActive).toBe(1);
  });

  it("concurrency=2 never runs more than two tasks at once", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });
    let active = 0;
    let maxActive = 0;

    const makeTask = (id: string): ScheduledTask<AgentResult> => ({
      id,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(20);
        active--;
        return makeSuccessResult(id);
      }
    });

    await Promise.all([
      scheduler.schedule(makeTask("t1")),
      scheduler.schedule(makeTask("t2")),
      scheduler.schedule(makeTask("t3")),
      scheduler.schedule(makeTask("t4"))
    ]);

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(0);
  });

  it("concurrency=3 allows three simultaneous tasks", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 3 });
    let active = 0;
    let maxActive = 0;

    const makeTask = (id: string): ScheduledTask<AgentResult> => ({
      id,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(30);
        active--;
        return makeSuccessResult(id);
      }
    });

    await Promise.all([
      scheduler.schedule(makeTask("t1")),
      scheduler.schedule(makeTask("t2")),
      scheduler.schedule(makeTask("t3")),
      scheduler.schedule(makeTask("t4"))
    ]);

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });

  it("queued tasks start in FIFO order", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1 });
    const startOrder: string[] = [];

    const makeTask = (id: string): ScheduledTask<AgentResult> => ({
      id,
      run: async () => {
        startOrder.push(id);
        await sleep(10);
        return makeSuccessResult(id);
      }
    });

    await Promise.all([
      scheduler.schedule(makeTask("t1")),
      scheduler.schedule(makeTask("t2")),
      scheduler.schedule(makeTask("t3"))
    ]);

    expect(startOrder).toEqual(["t1", "t2", "t3"]);
  });

  it("queued tasks start when a running task completes", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1 });
    const completionOrder: string[] = [];

    const makeTask = (id: string, delayMs: number): ScheduledTask<AgentResult> => ({
      id,
      run: async () => {
        await sleep(delayMs);
        completionOrder.push(id);
        return makeSuccessResult(id);
      }
    });

    await Promise.all([
      scheduler.schedule(makeTask("t1", 20)),
      scheduler.schedule(makeTask("t2", 10)),
      scheduler.schedule(makeTask("t3", 5))
    ]);

    // t1 runs first (FIFO), then t2, then t3 — regardless of delay
    expect(completionOrder[0]).toBe("t1");
    expect(completionOrder.length).toBe(3);
  });

  it("drain() resolves only after all queued and running tasks complete", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1 });
    let completed = 0;

    const makeTask = (id: string): ScheduledTask<AgentResult> => ({
      id,
      run: async () => {
        await sleep(15);
        completed++;
        return makeSuccessResult(id);
      }
    });

    // Schedule without awaiting
    scheduler.schedule(makeTask("t1"));
    scheduler.schedule(makeTask("t2"));
    scheduler.schedule(makeTask("t3"));

    await scheduler.drain();

    expect(completed).toBe(3);
  });

  it("drain() resolves immediately when scheduler is empty", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });

    await expect(scheduler.drain()).resolves.toBeUndefined();
  });

  it("completed task count is correct after all tasks finish", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });

    await Promise.all([
      scheduler.schedule({ id: "t1", run: async () => makeSuccessResult("t1") }),
      scheduler.schedule({ id: "t2", run: async () => makeSuccessResult("t2") }),
      scheduler.schedule({ id: "t3", run: async () => makeSuccessResult("t3") })
    ]);

    expect(scheduler.getSnapshot().completedCount).toBe(3);
  });
});
