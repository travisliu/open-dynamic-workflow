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

describe("Scheduler: cancellation/abort behavior", () => {
  it("abort before task starts marks queued task as skipped", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1 });

    // Occupy the slot with a long task
    const blocker: ScheduledTask<AgentResult> = {
      id: "blocker",
      run: async (signal) => {
        await sleep(500, signal);
        return makeSuccessResult("blocker");
      }
    };

    // Queue another task
    const queued: ScheduledTask<AgentResult> = {
      id: "queued",
      run: async () => makeSuccessResult("queued")
    };

    scheduler.schedule(blocker);
    const pQueued = scheduler.schedule(queued);

    // Abort immediately
    scheduler.abort("Pre-start abort");

    const result = await pQueued;

    expect(result.ok).toBe(false);
    expect(result.status === "skipped" || result.status === "cancelled").toBe(true);
  });

  it("abort while task is running sends abort signal to the running task", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });
    let task1Aborted = false;

    const task1: ScheduledTask<AgentResult> = {
      id: "t1",
      run: async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            task1Aborted = true;
            resolve();
          });
        });
        return { ok: false, status: "cancelled", id: "t1", provider: "mock", stdout: "", stderr: "", exitCode: null, durationMs: 0, artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }, error: { name: "Cancelled", message: "aborted" } };
      }
    };

    const promise = scheduler.schedule(task1);
    
    // Allow t1 to start
    await sleep(10);
    
    scheduler.abort("Abort running task");

    const result = await promise;
    expect(task1Aborted).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("cancelled running task resolves (not rejects) from schedule()", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });

    const task: ScheduledTask<AgentResult> = {
      id: "t1",
      run: async (signal) => {
        try {
          await sleep(200, signal);
          return makeSuccessResult("t1");
        } catch {
          // task was aborted - throw so scheduler catches it
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        }
      }
    };

    const promise = scheduler.schedule(task);
    await sleep(20);
    scheduler.abort("test abort");

    // schedule() should resolve, not reject
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.status === "cancelled" || result.status === "skipped").toBe(true);
  });

  it("drain() completes after cancellation settles", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });

    scheduler.schedule({
      id: "t1",
      run: async (signal) => {
        await sleep(100, signal);
        return makeSuccessResult("t1");
      }
    });

    scheduler.schedule({
      id: "t2",
      run: async (signal) => {
        await sleep(100, signal);
        return makeSuccessResult("t2");
      }
    });

    setTimeout(() => scheduler.abort("abort for drain test"), 20);

    // Should complete - not hang forever
    await expect(scheduler.drain()).resolves.toBeUndefined();
  });

  it("no task remains running after abort()", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 3 });
    const runningTasks = new Set<string>();

    const makeTask = (id: string): ScheduledTask<AgentResult> => ({
      id,
      run: async (signal) => {
        runningTasks.add(id);
        try {
          await sleep(500, signal);
          return makeSuccessResult(id);
        } finally {
          runningTasks.delete(id);
        }
      }
    });

    scheduler.schedule(makeTask("t1"));
    scheduler.schedule(makeTask("t2"));
    scheduler.schedule(makeTask("t3"));

    await sleep(20); // Let tasks start
    expect(runningTasks.size).toBe(3);

    scheduler.abort("Stop all");

    await scheduler.drain();
    expect(runningTasks.size).toBe(0);
  });

  it("abort after all tasks complete is a no-op (does not cause errors)", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });

    await scheduler.schedule({ id: "t1", run: async () => makeSuccessResult("t1") });
    await scheduler.schedule({ id: "t2", run: async () => makeSuccessResult("t2") });

    expect(() => scheduler.abort("late abort")).not.toThrow();
    expect(scheduler.getSnapshot().completedCount).toBe(2);
  });
});
