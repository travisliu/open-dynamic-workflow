import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { SharedAgentRegistryEntry } from "./types.js";

export class SharedAgentRegistry {
  private readonly entries = new Map<string, SharedAgentRegistryEntry>();

  register(entry: SharedAgentRegistryEntry): void {
    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new OpenFlowError(
        ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
        `Shared agent in ${entry.sourcePath} must declare a non-empty id.`
      );
    }

    const existing = this.entries.get(entry.id);
    if (existing) {
      throw new OpenFlowError(
        ErrorCode.SHARED_AGENT_DUPLICATE_ID,
        `Duplicate shared agent id '${entry.id}' in ${existing.sourcePath} and ${entry.sourcePath}.`
      );
    }

    this.entries.set(entry.id, entry);
  }

  get(id: string): SharedAgentRegistryEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  list(): SharedAgentRegistryEntry[] {
    return Array.from(this.entries.values());
  }
}
