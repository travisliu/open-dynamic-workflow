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

function makeFailureResult(id: string): AgentResult {
  return {
    ok: false,
    status: "failed",
    id,
    provider: "mock",
    stdout: "",
    stderr: "agent failed",
    exitCode: 1,
    durationMs: 5,
    artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
    error: { name: "AgentFailure", message: "agent failed", code: "PROVIDER_PROCESS_FAILED" }
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

describe("Scheduler: fail-fast behavior", () => {
  it("with fail-fast OFF, one failed result does not abort others", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 3, failFast: false });
    const completed: string[] = [];

    const makeTask = (id: string, ok: boolean): ScheduledTask<AgentResult> => ({
      id,
      run: async () => {
        await sleep(10);
        completed.push(id);
        return ok ? makeSuccessResult(id) : makeFailureResult(id);
      }
    });

    await Promise.all([
      scheduler.schedule(makeTask("success1", true)),
      scheduler.schedule(makeTask("fail1", false)),
      scheduler.schedule(makeTask("success2", true))
    ]);

    expect(completed).toContain("success1");
    expect(completed).toContain("fail1");
    expect(completed).toContain("success2");
    expect(scheduler.getSnapshot().aborted).toBe(false);
  });

  it("with fail-fast ON, failed result triggers abort of running tasks", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 2, failFast: true });
    let slowTaskAborted = false;

    const failTask: ScheduledTask<AgentResult> = {
      id: "fail1",
      run: async () => makeFailureResult("fail1")
    };

    const slowTask: ScheduledTask<AgentResult> = {
      id: "slow1",
      run: async (signal) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          signal.addEventListener("abort", () => {
            slowTaskAborted = true;
            clearTimeout(timer);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
        return makeSuccessResult("slow1");
      }
    };

    const p1 = scheduler.schedule(failTask);
    const p2 = scheduler.schedule(slowTask);

    const r1 = await p1;
    expect(r1.ok).toBe(false);

    const r2 = await p2;
    // slow1 should have been aborted or skipped
    expect(r2.ok).toBe(false);
    expect(slowTaskAborted || r2.status === "skipped" || r2.status === "cancelled").toBe(true);
  });

  it("with fail-fast ON, queued tasks are skipped", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });

    const failTask: ScheduledTask<AgentResult> = {
      id: "fail1",
      run: async () => makeFailureResult("fail1")
    };

    const queuedTask: ScheduledTask<AgentResult> = {
      id: "queued1",
      run: async () => makeSuccessResult("queued1")
    };

    // fail task runs first (concurrency=1), queued task waits
    const p1 = scheduler.schedule(failTask);
    const p2 = scheduler.schedule(queuedTask);

    await p1;
    const r2 = await p2;

    expect(r2.ok).toBe(false);
    expect(r2.status === "skipped" || r2.status === "cancelled").toBe(true);
  });

  it("partial results are preserved after fail-fast", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });

    const r1 = await scheduler.schedule({
      id: "success1",
      run: async () => makeSuccessResult("success1")
    });
    expect(r1.ok).toBe(true);

    const p2 = scheduler.schedule({ id: "fail1", run: async () => makeFailureResult("fail1") });
    const p3 = scheduler.schedule({ id: "queued1", run: async () => makeSuccessResult("queued1") });

    const r2 = await p2;
    const r3 = await p3;

    // r1 was already completed - check r2 is the failure
    expect(r2.ok).toBe(false);
    // r3 should be skipped
    expect(r3.ok).toBe(false);
    expect(scheduler.getSnapshot().aborted).toBe(true);
  });

  it("fail-fast reason is available in scheduler snapshot as structured object", async () => {
    const scheduler = new DefaultScheduler({ concurrency: 1, failFast: true });

    await scheduler.schedule({ id: "fail1", run: async () => makeFailureResult("fail1") });

    const snapshot = scheduler.getSnapshot();
    expect(snapshot.aborted).toBe(true);
    expect(snapshot.abortReason).toBeDefined();
    expect(typeof snapshot.abortReason).toBe("object");
    expect(snapshot.abortReason!.type).toBe("fail-fast");
    expect(snapshot.abortReason!.cause).toBe("failure");
    expect(snapshot.abortReason!.source).toBe("fail1");
  });
});
