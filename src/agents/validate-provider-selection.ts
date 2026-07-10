import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { ResolvedProviderSelection } from "../types/provider-selection.js";
import type { ProviderConfig } from "../config/types.js";
import { BUILT_IN_PROVIDER_NAMES } from "./provider-names.js";
import { assertThinkingEffortSupported } from "./thinking-effort-support.js";

export function validateResolvedProviderSelection(
  selection: ResolvedProviderSelection,
  providerConfig: ProviderConfig | undefined
): void {
  const isBuiltIn = BUILT_IN_PROVIDER_NAMES.includes(selection.provider as any);
  if (!isBuiltIn && !providerConfig) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      `Unknown provider: ${selection.provider}`
    );
  }

  assertThinkingEffortSupported(selection.provider, selection.thinkingEffort);
}
