import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { SharedAgentRegistry } from "./registry.js";
import type { SharedAgentRegistryEntry } from "./types.js";

/**
 * Resolves a shared agent definition from the registry by ID.
 * Rejects path-like IDs to ensure agents are referenced by stable name.
 */
export function resolveSharedAgent(
  registry: SharedAgentRegistry,
  id: unknown
): SharedAgentRegistryEntry {
  if (
    typeof id !== "string" ||
    id.trim() === "" ||
    id.startsWith(".") ||
    id.startsWith("/") ||
    id.includes("/") ||
    id.includes("\\")
  ) {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_NOT_FOUND,
      "Shared agent definition references must use a registry ID, not a path."
    );
  }

  const entry = registry.get(id);
  if (!entry) {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_NOT_FOUND,
      `Shared agent '${id}' was not found in the configured registry.`
    );
  }

  return entry;
}
