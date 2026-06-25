import { describe, it, expect } from "vitest";
import { assertThinkingEffortSupported } from "../../../src/agents/thinking-effort-support.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("thinking-effort-support", () => {
  it("should accept undefined for any provider", () => {
    expect(() => assertThinkingEffortSupported("codex", undefined)).not.toThrow();
    expect(() => assertThinkingEffortSupported("pi", undefined)).not.toThrow();
    expect(() => assertThinkingEffortSupported("opencode", undefined)).not.toThrow();
    expect(() => assertThinkingEffortSupported("gemini", undefined)).not.toThrow();
  });

  it("should throw THINKING_EFFORT_NOT_SUPPORTED for unsupported providers", () => {
    try {
      assertThinkingEffortSupported("gemini", "medium");
      fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
      expect(err.code).toBe(ErrorCode.THINKING_EFFORT_NOT_SUPPORTED);
      expect(err.message).toContain("Provider 'gemini' does not support thinkingEffort");
      expect(err.message).toContain("Supported providers: codex, pi, opencode");
    }
  });

  it("should validate codex supports only minimal, low, medium, high", () => {
    expect(() => assertThinkingEffortSupported("codex", "minimal")).not.toThrow();
    expect(() => assertThinkingEffortSupported("codex", "low")).not.toThrow();
    expect(() => assertThinkingEffortSupported("codex", "medium")).not.toThrow();
    expect(() => assertThinkingEffortSupported("codex", "high")).not.toThrow();

    const invalidCodex = ["off", "xhigh"] as const;
    for (const val of invalidCodex) {
      try {
        assertThinkingEffortSupported("codex", val);
        fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
        expect(err.code).toBe(ErrorCode.THINKING_EFFORT_VALUE_UNSUPPORTED);
        expect(err.message).toContain(`Provider 'codex' does not support thinkingEffort '${val}'`);
        expect(err.message).toContain("Supported values: minimal, low, medium, high");
      }
    }
  });

  it("should validate pi supports all six values", () => {
    const values = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
    for (const val of values) {
      expect(() => assertThinkingEffortSupported("pi", val)).not.toThrow();
    }

    try {
      assertThinkingEffortSupported("pi", "invalid-value" as any);
      fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
      expect(err.code).toBe(ErrorCode.THINKING_EFFORT_VALUE_UNSUPPORTED);
      expect(err.message).toContain("Provider 'pi' does not support thinkingEffort 'invalid-value'");
      expect(err.message).toContain("Supported values: off, minimal, low, medium, high, xhigh");
    }
  });

  it("should validate opencode supports all six values", () => {
    const values = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
    for (const val of values) {
      expect(() => assertThinkingEffortSupported("opencode", val)).not.toThrow();
    }

    try {
      assertThinkingEffortSupported("opencode", "invalid-value" as any);
      fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(OpenDynamicWorkflowError);
      expect(err.code).toBe(ErrorCode.THINKING_EFFORT_VALUE_UNSUPPORTED);
      expect(err.message).toContain("Provider 'opencode' does not support thinkingEffort 'invalid-value'");
      expect(err.message).toContain("Supported values: off, minimal, low, medium, high, xhigh");
    }
  });
});

function fail(message: string): never {
  throw new Error(message);
}
