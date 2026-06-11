import { validateSharedAgentInput } from "./validate.js";
import type { SharedAgentDefinition } from "./types.js";

export function normalizeSharedAgentContext(
  definition: SharedAgentDefinition,
  context: unknown
): Record<string, unknown> {
  return validateSharedAgentInput(definition, context);
}
