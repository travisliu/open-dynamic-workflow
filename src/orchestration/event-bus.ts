import type { EventEnvelope, EventType } from "../output/events.js";
import type { ArtifactStore } from "../types/artifacts.js";

export interface EventSubscriber {
  handle(event: EventEnvelope): Promise<void> | void;
}

export interface EventBusOptions {
  runId: string;
  artifactStore: Pick<ArtifactStore, "appendJsonl">;
  subscribers?: EventSubscriber[];
  now?: () => Date;
}

export class EventBus {
  private readonly runId: string;
  private readonly artifactStore: Pick<ArtifactStore, "appendJsonl">;
  private readonly subscribers: EventSubscriber[] = [];
  private readonly nowFn: () => Date;
  private sequence = 0;
  private emitQueue: Promise<unknown> = Promise.resolve();

  constructor(options: EventBusOptions) {
    this.runId = options.runId;
    this.artifactStore = options.artifactStore;
    this.nowFn = options.now ?? (() => new Date());
    if (options.subscribers) {
      this.subscribers.push(...options.subscribers);
    }
  }

  emit<TPayload>(type: EventType, payload: TPayload): Promise<EventEnvelope<TPayload>> {
    this.sequence += 1;
    const currentSequence = this.sequence;
    const timestamp = this.nowFn().toISOString();

    const event: EventEnvelope<TPayload> = {
      schemaVersion: "execflow.event.v1",
      runId: this.runId,
      sequence: currentSequence,
      timestamp,
      type,
      payload
    };

    const promise = this.emitQueue.then(async () => {
      // 1. Persist the event to events.jsonl
      await this.artifactStore.appendJsonl("events.jsonl", event);

      // 2. Notify subscribers sequentially
      for (const subscriber of this.subscribers) {
        await subscriber.handle(event);
      }
      return event;
    });

    this.emitQueue = promise.catch(() => {});
    return promise;
  }

  subscribe(subscriber: EventSubscriber): void {
    this.subscribers.push(subscriber);
  }

  async drain(): Promise<void> {
    await this.emitQueue;
  }

  getSequence(): number {
    return this.sequence;
  }
}
