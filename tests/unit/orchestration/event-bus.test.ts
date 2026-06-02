import { describe, expect, it } from "vitest";
import { EventBus } from "../../../src/orchestration/event-bus.js";
import type { EventEnvelope } from "../../../src/output/events.js";

describe("EventBus", () => {
  it("emits events with incrementing sequence and correct schema", async () => {
    const mockStore = {
      appended: [] as any[],
      async appendJsonl(path: string, value: unknown) {
        this.appended.push({ path, value });
        return "";
      }
    };

    const now = new Date("2026-06-02T10:00:00.000Z");
    const bus = new EventBus({
      runId: "run-abc",
      artifactStore: mockStore,
      now: () => now
    });

    const received: EventEnvelope[] = [];
    bus.subscribe({
      handle(event) {
        received.push(event);
      }
    });

    const event1 = await bus.emit("workflow.started", { workflowPath: "foo.js", artifactsDir: "bar" });
    expect(event1.sequence).toBe(1);
    expect(event1.schemaVersion).toBe("execflow.event.v1");
    expect(event1.runId).toBe("run-abc");
    expect(event1.timestamp).toBe(now.toISOString());
    expect(event1.type).toBe("workflow.started");

    const event2 = await bus.emit("phase.started", { name: "review" });
    expect(event2.sequence).toBe(2);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(event1);
    expect(received[1]).toEqual(event2);

    expect(mockStore.appended).toHaveLength(2);
    expect(mockStore.appended[0]?.path).toBe("events.jsonl");
    expect(mockStore.appended[0]?.value).toEqual(event1);
  });

  it("persists event to events.jsonl before notifying subscribers", async () => {
    const order: string[] = [];
    const mockStore = {
      async appendJsonl() {
        order.push("persist");
      }
    };

    const bus = new EventBus({
      runId: "run-abc",
      artifactStore: mockStore
    });

    bus.subscribe({
      handle() {
        order.push("subscriber");
      }
    });

    await bus.emit("workflow.log", { message: "test" });
    expect(order).toEqual(["persist", "subscriber"]);
  });

  it("notifies multiple subscribers", async () => {
    const mockStore = {
      async appendJsonl() {}
    };

    const bus = new EventBus({
      runId: "run-abc",
      artifactStore: mockStore
    });

    let sub1Called = false;
    let sub2Called = false;

    bus.subscribe({
      handle() {
        sub1Called = true;
      }
    });
    bus.subscribe({
      handle() {
        sub2Called = true;
      }
    });

    await bus.emit("workflow.log", { message: "test" });
    expect(sub1Called).toBe(true);
    expect(sub2Called).toBe(true);
  });

  it("fails emit if persistence fails", async () => {
    const mockStore = {
      async appendJsonl() {
        throw new Error("Disk full");
      }
    };

    const bus = new EventBus({
      runId: "run-abc",
      artifactStore: mockStore
    });

    await expect(bus.emit("workflow.log", { message: "test" })).rejects.toThrow("Disk full");
  });
});
