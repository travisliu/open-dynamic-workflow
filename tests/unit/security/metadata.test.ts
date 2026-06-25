import { describe, it, expect } from "vitest";
import { sanitizeMetadata } from "../../../src/security/metadata.js";

describe("sanitizeMetadata", () => {
  it("should preserve allowlisted fields", () => {
    const metadata = {
      sharedAgentId: "agent-1",
      sharedAgentSource: "registry",
      pipelineId: "pipe-1",
      pipelineLabel: "My Pipeline",
      itemIndex: 0,
      stageIndex: 1,
      stageName: "Stage 1",
      modelResolutionSource: "config",
      thinkingEffort: "high",
      thinkingEffortResolutionSource: "agent",
    };
    expect(sanitizeMetadata(metadata)).toEqual(metadata);
  });

  it("should redact non-allowlisted fields", () => {
    const metadata = {
      sharedAgentId: "agent-1",
      secret: "pass123",
      other: "value",
      opencodeVariant: "high",
    };
    const sanitized = sanitizeMetadata(metadata);
    expect(sanitized).toEqual({
      sharedAgentId: "agent-1",
    });
    expect(sanitized).not.toHaveProperty("secret");
    expect(sanitized).not.toHaveProperty("other");
    expect(sanitized).not.toHaveProperty("opencodeVariant");
  });

  it("should cap string length", () => {
    const longString = "a".repeat(300);
    const metadata = {
      sharedAgentId: longString,
    };
    const sanitized = sanitizeMetadata(metadata);
    expect(sanitized.sharedAgentId).toHaveLength(256 + 3); // 256 + "..."
    expect(sanitized.sharedAgentId).toMatch(/aaa\.\.\.$/);
  });

  it("should preserve booleans and finite numbers", () => {
    const metadata = {
      itemIndex: 42,
      pipelineLabel: "test",
      isStep: true,
      stageIndex: 0,
    };
    // Note: isStep is NOT in allowlist, so it should be dropped
    const sanitized = sanitizeMetadata(metadata);
    expect(sanitized).toEqual({
      itemIndex: 42,
      pipelineLabel: "test",
      stageIndex: 0,
    });
    expect(typeof sanitized.itemIndex).toBe("number");
  });

  it("should drop non-finite numbers", () => {
    const metadata = {
      itemIndex: Infinity,
      stageIndex: NaN,
    };
    const sanitized = sanitizeMetadata(metadata);
    expect(sanitized).toEqual({});
  });

  it("should drop objects and arrays", () => {
    const metadata = {
      pipelineId: { id: "p1" },
      stageName: ["s1", "s2"],
    };
    const sanitized = sanitizeMetadata(metadata);
    expect(sanitized).toEqual({});
  });

  it("should handle null or undefined metadata", () => {
    expect(sanitizeMetadata(undefined)).toEqual({});
    expect(sanitizeMetadata(null as any)).toEqual({});
  });
});
