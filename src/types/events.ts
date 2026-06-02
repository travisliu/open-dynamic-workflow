export * from "../output/events.js";
import type { EventEnvelope, EventType } from "../output/events.js";

// Keep alias for compatibility if needed
export type WorkflowEventType = EventType;
export type WorkflowEvent = EventEnvelope;
