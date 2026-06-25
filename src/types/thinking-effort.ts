export type ThinkingEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const THINKING_EFFORT_VALUES = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
] as const;

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === "string" && THINKING_EFFORT_VALUES.includes(value as ThinkingEffort);
}
