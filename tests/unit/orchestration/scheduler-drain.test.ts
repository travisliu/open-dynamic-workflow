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

describe("Scheduler: drain() semantics", () => {
  it("drain() resolves when all queued tasks complete", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1 });
    let completedCount = 0;

    const makeTask = (id: string): ScheduledTask<AgentResult> => ({
      id,
      run: async () => {
        await sleep(10);
        completedCount++;
        return makeSuccessResult(id);
      }
    });

    scheduler.schedule(makeTask("t1"));
    scheduler.schedule(makeTask("t2"));
    scheduler.schedule(makeTask("t3"));

    await scheduler.drain();
    expect(completedCount).toBe(3);
  });

  it("drain() resolves immediately when the queue and running set are empty", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });
    const start = Date.now();
    await scheduler.drain();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it("drain() called multiple times is safe", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2 });
    let completed = 0;

    scheduler.schedule({
      id: "t1",
      run: async () => {
        await sleep(20);
        completed++;
        return makeSuccessResult("t1");
      }
    });

    await Promise.all([scheduler.drain(), scheduler.drain()]);
    expect(completed).toBe(1);
  });

  it("drain() waits even if tasks are added to the queue lazily", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1 });
    let completed = 0;

    // Schedule a task that, while running, schedules another task
    scheduler.schedule({
      id: "t1",
      run: async () => {
        await sleep(10);
        // Schedule t2 from within t1 execution
        scheduler.schedule({
          id: "t2",
          run: async () => {
            await sleep(10);
            completed++;
            return makeSuccessResult("t2");
          }
        });
        completed++;
        return makeSuccessResult("t1");
      }
    });

    await scheduler.drain();
    expect(completed).toBe(2);
  });

  it("drain() completes when scheduler is aborted mid-drain", async () => {
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

    const drainPromise = scheduler.drain();
    
    // Abort after 30ms
    setTimeout(() => scheduler.abort("mid-drain abort"), 30);

    // drain should resolve even though tasks were aborted
    await expect(drainPromise).resolves.toBeUndefined();
  });
});
