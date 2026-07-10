import { describe, expect, it } from "vitest";
import { projectProviderSettingForDiagnostics } from "../../../src/output/provider-selection-diagnostics.js";

describe("projectProviderSettingForDiagnostics", () => {
  it("projects 'provider' correctly", () => {
    expect(projectProviderSettingForDiagnostics("provider", "mock-provider")).toBe("mock-provider");
    expect(projectProviderSettingForDiagnostics("provider", 123)).toBe("[invalid]");
    expect(projectProviderSettingForDiagnostics("provider", null)).toBe("[invalid]");
  });

  it("projects 'model' correctly", () => {
    expect(projectProviderSettingForDiagnostics("model", "gpt-4")).toBe("gpt-4");
    expect(projectProviderSettingForDiagnostics("model", null)).toBe(null);
    expect(projectProviderSettingForDiagnostics("model", 123)).toBe("[invalid]");
  });

  it("projects 'thinkingEffort' correctly", () => {
    expect(projectProviderSettingForDiagnostics("thinkingEffort", "high")).toBe("high");
    expect(projectProviderSettingForDiagnostics("thinkingEffort", "off")).toBe("off");
    expect(projectProviderSettingForDiagnostics("thinkingEffort", "invalid-value")).toBe("[invalid]");
    expect(projectProviderSettingForDiagnostics("thinkingEffort", null)).toBe("[invalid]");
  });

  it("projects 'timeoutMs' correctly", () => {
    expect(projectProviderSettingForDiagnostics("timeoutMs", 5000)).toBe(5000);
    expect(projectProviderSettingForDiagnostics("timeoutMs", Number.POSITIVE_INFINITY)).toBe("[invalid]");
    expect(projectProviderSettingForDiagnostics("timeoutMs", "5000")).toBe("[invalid]");
  });

  it("projects 'retry' correctly with allowed properties", () => {
    const validRetry = {
      enabled: true,
      maxAttempts: 3,
      delayMs: 1000,
      backoff: "exponential" as const,
      maxDelayMs: 5000,
      jitter: true,
      disableDelay: false,
    };
    expect(projectProviderSettingForDiagnostics("retry", validRetry)).toEqual(validRetry);
  });

  it("omits unknown keys and undefined/unsupported properties on 'retry'", () => {
    const retryWithExtras = {
      enabled: true,
      maxAttempts: 3,
      secretToken: "secret",
      otherConfig: { foo: "bar" },
      delayMs: undefined,
    };
    expect(projectProviderSettingForDiagnostics("retry", retryWithExtras)).toEqual({
      enabled: true,
      maxAttempts: 3,
    });
  });

  it("ignores inherited/prototype properties on 'retry'", () => {
    const proto = { enabled: true, maxAttempts: 5 };
    const retryObj = Object.create(proto);
    retryObj.jitter = true;

    // inherited 'enabled' and 'maxAttempts' should be ignored
    expect(projectProviderSettingForDiagnostics("retry", retryObj)).toEqual({
      jitter: true,
    });
  });

  it("does not invoke accessor properties (getters) and omits them on 'retry'", () => {
    let getterCalled = false;
    const retryObj = {
      enabled: true,
      get maxAttempts() {
        getterCalled = true;
        return 3;
      },
    };

    const projected = projectProviderSettingForDiagnostics("retry", retryObj);
    expect(getterCalled).toBe(false);
    expect(projected).toEqual({
      enabled: true,
    });
  });

  it("handles non-object retry input and invalid field types", () => {
    expect(projectProviderSettingForDiagnostics("retry", "not-an-object")).toBe("[invalid]");
    expect(projectProviderSettingForDiagnostics("retry", null)).toBe("[invalid]");
    
    const invalidTypes = {
      enabled: "yes", // should be boolean
      maxAttempts: "three", // should be number
      delayMs: 1000,
      backoff: "linear", // should be fixed or exponential
    };
    expect(projectProviderSettingForDiagnostics("retry", invalidTypes)).toEqual({
      delayMs: 1000,
    });
  });
});
