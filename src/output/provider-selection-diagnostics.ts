import type { ProviderSettingName } from "../types/provider-selection.js";

/**
 * Projects provider settings for diagnostics to prevent leaking sensitive credentials,
 * environment values, or arbitrary configurations.
 * 
 * Contract:
 * - Returns the value directly if it conforms to the strict expected types:
 *   - 'model': string | null
 *   - 'thinkingEffort': 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
 *   - 'timeoutMs': finite number
 *   - 'provider': string
 * - For 'retry', returns a plain object containing only allowlisted own data properties
 *   passing primitive type checks:
 *     - 'enabled': boolean
 *     - 'maxAttempts': number
 *     - 'delayMs': number
 *     - 'backoff': "fixed" | "exponential"
 *     - 'maxDelayMs': number
 *     - 'jitter': boolean
 *     - 'disableDelay': boolean
 *   Any other fields, undefined fields, inherited properties, or getters are omitted.
 *   If a field exists but has an invalid primitive type, it is omitted.
 * - Any unexpected value (including retry value that is not an object, or other settings with invalid types)
 *   returns the fixed safe placeholder string "[invalid]".
 */
export function projectProviderSettingForDiagnostics(
  setting: ProviderSettingName,
  value: unknown
): unknown {
  if (setting === "provider") {
    return typeof value === "string" ? value : "[invalid]";
  }
  if (setting === "model") {
    return typeof value === "string" || value === null ? value : "[invalid]";
  }
  if (setting === "thinkingEffort") {
    return typeof value === "string" && ["off", "minimal", "low", "medium", "high", "xhigh"].includes(value)
      ? value
      : "[invalid]";
  }
  if (setting === "timeoutMs") {
    return typeof value === "number" && Number.isFinite(value) ? value : "[invalid]";
  }
  if (setting === "retry") {
    if (typeof value !== "object" || value === null) {
      return "[invalid]";
    }
    const projected: Record<string, unknown> = {};
    const allowlist = {
      enabled: "boolean",
      maxAttempts: "number",
      delayMs: "number",
      backoff: "string",
      maxDelayMs: "number",
      jitter: "boolean",
      disableDelay: "boolean",
    } as const;

    for (const [key, expectedType] of Object.entries(allowlist)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (desc && !desc.get) {
          const val = desc.value;
          if (val !== undefined) {
            if (typeof val === expectedType) {
              if (key === "backoff") {
                if (val === "fixed" || val === "exponential") {
                  projected[key] = val;
                }
              } else if (expectedType === "number") {
                if (Number.isFinite(val)) {
                  projected[key] = val;
                }
              } else {
                projected[key] = val;
              }
            }
          }
        }
      }
    }
    return projected;
  }
  return "[invalid]";
}
