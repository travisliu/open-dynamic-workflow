import { describe, expect, it } from "vitest";
import { shouldRedactEnvName, buildProviderEnv, redactText } from "../../../src/security/env.js";

describe("env security helpers", () => {
  it("determines secret-looking environment variable names", () => {
    expect(shouldRedactEnvName("MY_API_KEY")).toBe(true);
    expect(shouldRedactEnvName("GITHUB_TOKEN")).toBe(true);
    expect(shouldRedactEnvName("GEMINI_SECRET")).toBe(true);
    expect(shouldRedactEnvName("PASSWORD")).toBe(true);
    expect(shouldRedactEnvName("OPENAI_API_KEY")).toBe(true);
    expect(shouldRedactEnvName("PATH")).toBe(false);
    expect(shouldRedactEnvName("USER")).toBe(false);
  });

  it("builds provider env using allowlist", () => {
    const baseEnv = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      MY_SECRET_KEY: "secret123",
      ALLOWED_VAR: "allowed123"
    };

    const providerEnv = buildProviderEnv({
      baseEnv,
      passEnv: ["ALLOWED_VAR"]
    });

    expect(providerEnv.PATH).toBe("/usr/bin");
    expect(providerEnv.HOME).toBe("/home/user");
    expect(providerEnv.ALLOWED_VAR).toBe("allowed123");
    expect(providerEnv.MY_SECRET_KEY).toBeUndefined();
  });

  it("includes explicit env", () => {
    const baseEnv = {
      PATH: "/usr/bin"
    };

    const providerEnv = buildProviderEnv({
      baseEnv,
      passEnv: [],
      explicitEnv: {
        EXPLICIT_VAR: "explicit123"
      }
    });

    expect(providerEnv.PATH).toBe("/usr/bin");
    expect(providerEnv.EXPLICIT_VAR).toBe("explicit123");
  });

  it("redacts secret values from text", () => {
    const text = "Connect to server using secret-value-123 and token-456";
    const redacted = redactText(text, ["secret-value-123", "token-456", "too-short", "   "]);

    expect(redacted).toBe("Connect to server using [REDACTED] and [REDACTED]");
  });

  it("ignores very short or empty secrets in redaction", () => {
    const text = "A key with secret abc";
    const redacted = redactText(text, ["abc", "a"]);

    // "abc" is length 3, less than 4, so it should not be redacted
    expect(redacted).toBe("A key with secret abc");
  });
});
