import type { SharedAgentDefinition } from "./types.js";

const SHARED_AGENT_MARKER = Symbol.for("openflow.sharedAgentDefinition");

export function defineAgent<T extends SharedAgentDefinition>(definition: T): T {
  Object.defineProperty(definition, SHARED_AGENT_MARKER, {
    value: true,
    enumerable: false,
    configurable: false
  });
  return definition;
}

export function isDefinedSharedAgent(value: unknown): value is SharedAgentDefinition {
  return !!value &&
    typeof value === "object" &&
    (value as Record<symbol, unknown>)[SHARED_AGENT_MARKER] === true;
}
