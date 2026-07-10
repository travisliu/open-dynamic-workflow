import * as crypto from "node:crypto";
import type { JsonSchema } from "../types/common.js";
import type { AgentCallInput, AgentPermissions, StructuredOutputConfig } from "../types/agent.js";
import type { ThinkingEffort } from "../types/thinking-effort.js";
import type { ResolvedProviderSelection, RetryPolicyArtifact } from "../types/provider-selection.js";

export interface AgentFingerprintMaterialV2 {
  schemaVersion: "open-dynamic-workflow.agent-fingerprint.v2";
  call: {
    prompt: string;
    schema?: JsonSchema | undefined;
    structuredOutput?: StructuredOutputConfig | undefined;
    cwd: string;
    metadata?: Record<string, unknown> | undefined;
    permissions: AgentPermissions;
  };
  providerSelection: {
    requestedProvider: string;
    providerAlias?: string | undefined;
    providerAliasDigest?: string | undefined;
    provider: string;
    model?: string | null | undefined;
    thinkingEffort?: ThinkingEffort | undefined;
    timeoutMs: number;
    retry: RetryPolicyArtifact;
  };
  providerConfigDigest: string;
}

export interface AgentFingerprintDiagnosticMaterial {
  requestedProvider: string;
  providerAlias?: string | undefined;
  providerAliasDigest?: string | undefined;
  provider: string;
  model?: string | null | undefined;
  thinkingEffort?: ThinkingEffort | undefined;
  timeoutMs: number;
  retry: RetryPolicyArtifact;
}

export function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        sorted[key] = sortValue(child);
      }
    }
    return sorted;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function toAgentFingerprintMaterial(input: {
  call: AgentCallInput;
  permissions: AgentPermissions;
  cwd: string;
  selection: ResolvedProviderSelection;
  providerConfig?: unknown;
}): AgentFingerprintMaterialV2 {
  const retryPolicy: RetryPolicyArtifact = {
    enabled: input.selection.retry.enabled,
    maxAttempts: input.selection.retry.policy?.maxAttempts ?? 1,
    delayMs: input.selection.retry.policy?.delayMs ?? 1000,
    backoff: input.selection.retry.policy?.backoff ?? "exponential",
    maxDelayMs: input.selection.retry.policy?.maxDelayMs ?? 30000,
    jitter: input.selection.retry.policy?.jitter ?? true,
    disableDelay: input.selection.retry.policy?.disableDelay ?? false
  };

  const configStr = input.providerConfig !== undefined && input.providerConfig !== null
    ? stableStringify(input.providerConfig)
    : "";
  const providerConfigDigest = crypto.createHash("sha256").update(configStr).digest("hex");

  return {
    schemaVersion: "open-dynamic-workflow.agent-fingerprint.v2",
    call: {
      // Definition-backed calls are normalized before fingerprinting, but the
      // shared input type also permits their prompt to be omitted.
      prompt: input.call.prompt ?? "",
      schema: input.call.schema,
      structuredOutput: input.call.structuredOutput,
      cwd: input.cwd,
      metadata: input.call.metadata,
      permissions: input.permissions
    },
    providerSelection: {
      requestedProvider: input.selection.requestedProvider,
      providerAlias: input.selection.providerAlias,
      providerAliasDigest: input.selection.providerAliasDigest,
      provider: input.selection.provider,
      model: input.selection.model,
      thinkingEffort: input.selection.thinkingEffort,
      timeoutMs: input.selection.timeoutMs,
      retry: retryPolicy
    },
    providerConfigDigest
  };
}

export function toAgentFingerprintDiagnosticMaterial(
  selection: ResolvedProviderSelection
): AgentFingerprintDiagnosticMaterial {
  return {
    requestedProvider: selection.requestedProvider,
    providerAlias: selection.providerAlias,
    providerAliasDigest: selection.providerAliasDigest,
    provider: selection.provider,
    model: selection.model,
    thinkingEffort: selection.thinkingEffort,
    timeoutMs: selection.timeoutMs,
    retry: {
      enabled: selection.retry.enabled,
      maxAttempts: selection.retry.policy?.maxAttempts ?? 1,
      delayMs: selection.retry.policy?.delayMs ?? 1000,
      backoff: selection.retry.policy?.backoff ?? "exponential",
      maxDelayMs: selection.retry.policy?.maxDelayMs ?? 30000,
      jitter: selection.retry.policy?.jitter ?? true,
      disableDelay: selection.retry.policy?.disableDelay ?? false
    }
  };
}

export function computeAgentFingerprint(input: any): string {
  if (input && input.schemaVersion === "open-dynamic-workflow.agent-fingerprint.v2") {
    return crypto
      .createHash("sha256")
      .update(stableStringify(input))
      .digest("hex");
  }

  return computeLegacyAgentFingerprint(input);
}

/**
 * Computes the pre-v2 fingerprint shape for reading legacy cache entries.
 * Keep this separate from the v2 helper so runtime instrumentation and
 * diagnostics treat the v2 fingerprint as the call's one authoritative hash.
 */
export function computeLegacyAgentFingerprint(input: any): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify({
      prompt: input.call.prompt,
      schema: input.call.schema,
      structuredOutput: input.call.structuredOutput,
      provider: input.provider,
      model: input.model,
      timeoutMs: input.timeoutMs,
      cwd: input.cwd,
      metadata: input.call.metadata,
      providerConfig: input.providerConfig,
      thinkingEffort: input.thinkingEffort,
      retry: {
        enabled: input.retry?.enabled ?? false,
        policy: {
          maxAttempts: input.retry?.policy?.maxAttempts ?? 1,
          delayMs: input.retry?.policy?.delayMs ?? 1000,
          backoff: input.retry?.policy?.backoff ?? "exponential",
          maxDelayMs: input.retry?.policy?.maxDelayMs ?? 30000,
          jitter: input.retry?.policy?.jitter ?? true,
          disableDelay: input.retry?.policy?.disableDelay ?? false
        }
      }
    }))
    .digest("hex");
}
