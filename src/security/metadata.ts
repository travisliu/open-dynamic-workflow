/**
 * Sanitizes metadata for external exposure in events, reports, and artifacts.
 * This prevents sensitive data or excessive volume from leaking while preserving
 * essential shared-agent and pipeline context.
 */
export function sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const safeFields = new Set([
    "sharedAgentId",
    "sharedAgentSource",
    "pipelineId",
    "pipelineLabel",
    "itemIndex",
    "stageIndex",
    "stageName",
    "modelResolutionSource",
    "thinkingEffort",
    "thinkingEffortResolutionSource",
  ]);

  const MAX_STRING_LENGTH = 256;
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (!safeFields.has(key)) {
      continue;
    }

    if (typeof value === "string") {
      sanitized[key] = value.length > MAX_STRING_LENGTH 
        ? value.substring(0, MAX_STRING_LENGTH) + "..." 
        : value;
    } else if (typeof value === "boolean") {
      sanitized[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    }
    // Objects and arrays are dropped as per requirements
  }

  return sanitized;
}
