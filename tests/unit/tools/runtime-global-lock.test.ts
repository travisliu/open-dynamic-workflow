import { describe, it, expect } from "vitest";
import { createToolRuntimeGlobalLock, toolRuntimeGlobalLock } from "../../../src/tools/runtime-global-lock.js";

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runtime-global-lock", () => {
  it("should export a process-wide singleton", () => {
    expect(toolRuntimeGlobalLock).toBeDefined();
    expect(typeof toolRuntimeGlobalLock.runExclusive).toBe("function");
  });

  it("should run operations in FIFO order and serialize them", async () => {
    const lock = createToolRuntimeGlobalLock();
    const events: string[] = [];

    const d1 = createDeferred<void>();
    const d2 = createDeferred<void>();
    const d3 = createDeferred<void>();

    const start1 = createDeferred<void>();
    const start2 = createDeferred<void>();
    const start3 = createDeferred<void>();

    const p1 = lock.runExclusive(async () => {
      events.push("start-1");
      start1.resolve();
      await d1.promise;
      events.push("end-1");
      return "res-1";
    });

    const p2 = lock.runExclusive(async () => {
      events.push("start-2");
      start2.resolve();
      await d2.promise;
      events.push("end-2");
      return "res-2";
    });

    const p3 = lock.runExclusive(async () => {
      events.push("start-3");
      start3.resolve();
      await d3.promise;
      events.push("end-3");
      return "res-3";
    });

    // Wait for the first to start
    await start1.promise;
    expect(events).toEqual(["start-1"]);

    // Yield control to ensure p2 and p3 are queued but have not started
    await Promise.resolve();
    expect(events).toEqual(["start-1"]);

    // Attempting to resolve d2 or d3 should not start them yet
    d2.resolve();
    d3.resolve();
    await Promise.resolve();
    expect(events).toEqual(["start-1"]);

    // Resolve d1 -> should end 1 and start/end 2, and start/end 3 (since they are already resolved)
    d1.resolve();
    
    // Wait for all three to complete
    expect(await p1).toBe("res-1");
    expect(await p2).toBe("res-2");
    expect(await p3).toBe("res-3");

    expect(events).toEqual([
      "start-1",
      "end-1",
      "start-2",
      "end-2",
      "start-3",
      "end-3"
    ]);
  });

  it("should handle synchronous return values and throws", async () => {
    const lock = createToolRuntimeGlobalLock();
    
    const p1 = lock.runExclusive(() => "sync-val");
    const p2 = lock.runExclusive(() => {
      throw new Error("sync-err");
    });
    const p3 = lock.runExclusive(() => "after-sync");

    expect(await p1).toBe("sync-val");
    await expect(p2).rejects.toThrow("sync-err");
    expect(await p3).toBe("after-sync");
  });

  it("should handle asynchronous rejections without poisoning the lock", async () => {
    const lock = createToolRuntimeGlobalLock();
    const events: string[] = [];

    const d1 = createDeferred<void>();
    const d2 = createDeferred<void>();

    const start1 = createDeferred<void>();
    const start2 = createDeferred<void>();

    const p1 = lock.runExclusive(async () => {
      events.push("start-1");
      start1.resolve();
      await d1.promise;
      throw new Error("async-err");
    });

    const p2 = lock.runExclusive(async () => {
      events.push("start-2");
      start2.resolve();
      await d2.promise;
      events.push("end-2");
      return "val-2";
    });

    // Wait for the first to start
    await start1.promise;
    expect(events).toEqual(["start-1"]);

    // Reject the first
    d1.reject(new Error("async-err"));
    await expect(p1).rejects.toThrow("async-err");

    // Wait for the second to start
    await start2.promise;
    expect(events).toEqual(["start-1", "start-2"]);

    d2.resolve();
    expect(await p2).toBe("val-2");
    expect(events).toEqual(["start-1", "start-2", "end-2"]);
  });
});
