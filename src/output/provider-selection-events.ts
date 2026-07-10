import type { RuntimeEventSink } from "../orchestration/scheduler.js";
import type { ResolvedProviderSelection } from "../types/provider-selection.js";
import { projectProviderSettingForDiagnostics } from "./provider-selection-diagnostics.js";
import type {
  AgentProviderAliasResolvedPayload,
  AgentProviderSettingOverriddenPayload,
} from "./events.js";

function readOwnDataProperty(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined;
}

/**
 * Emits provider-alias resolution and setting override events for an agent execution.
 * 
 * Sequencing rules:
 * - Emits agent.provider-alias-resolved first (if the selection is resolved via an alias).
 * - Emits one agent.provider-setting-overridden event per entry in selection.overrides in order.
 * - Enforces that both selected and overridden values are projected through
 *   projectProviderSettingForDiagnostics to prevent credential/config leaks.
 */
export async function emitProviderResolutionEvents(input: {
  eventSink?: RuntimeEventSink | undefined;
  agentId: string;
  label?: string | undefined;
  selection: ResolvedProviderSelection;
}): Promise<void> {
  const { eventSink, agentId, label, selection } = input;
  if (!eventSink) {
    return;
  }

  // 1. If providerAlias is defined, emit the alias resolution event
  if (selection.providerAlias !== undefined) {
    const aliasResolvedPayload: AgentProviderAliasResolvedPayload = {
      agentId,
      label,
      requestedProvider: selection.requestedProvider,
      requestedProviderSource: selection.requestedProviderSource,
      providerAlias: selection.providerAlias,
      providerAliasChain: selection.providerAliasChain ?? [],
      providerAliasDigest: selection.providerAliasDigest ?? "",
      provider: selection.provider,
    };
    await eventSink.emit("agent.provider-alias-resolved", aliasResolvedPayload);
  }

  // 2. Emit an override event for each override in selection.overrides in order
  if (selection.overrides && selection.overrides.length > 0) {
    for (const override of selection.overrides) {
      const selectedValue = projectProviderSettingForDiagnostics(
        override.setting,
        readOwnDataProperty(override.selected, "value")
      );
      const overriddenValue = projectProviderSettingForDiagnostics(
        override.setting,
        readOwnDataProperty(override.overridden, "value")
      );

      const overridePayload: AgentProviderSettingOverriddenPayload = {
        agentId,
        label,
        providerAlias: selection.providerAlias,
        provider: selection.provider,
        setting: override.setting,
        selectedValue,
        selectedSource: override.selected.source,
        selectedSourcePath: override.selected.sourcePath,
        overriddenValue,
        overriddenSource: override.overridden.source,
        overriddenSourcePath: override.overridden.sourcePath,
      };
      await eventSink.emit("agent.provider-setting-overridden", overridePayload);
    }
  }
}
