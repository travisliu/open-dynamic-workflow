import { describe, expect, it } from "vitest";
import {
  shouldRedactEnvName,
  buildProviderEnv,
  redactText,
  collectSecretValues,
  redactJsonValue,
  redactProviderCommand,
  redactSerializedError
} from "../../../src/security/env.js";

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

  it("collects secret values from env", () => {
    const baseEnv = {
      PATH: "/usr/bin",
      MY_API_KEY: "secret-123",
      OTHER_VAR: "not-a-secret",
      GEMINI_SECRET: "secret-456"
    };
    const secrets = collectSecretValues(baseEnv);
    expect(secrets).toContain("secret-123");
    expect(secrets).toContain("secret-456");
    expect(secrets).not.toContain("/usr/bin");
    expect(secrets).not.toContain("not-a-secret");
  });

  it("redacts string values in nested JSON without mutation", () => {
    const original = {
      id: "123",
      nested: {
        secret: "secret-123",
        list: ["secret-123", "public"]
      },
      plain: "nothing"
    };
    const secrets = ["secret-123"];
    const redacted = redactJsonValue(original, secrets) as typeof original;

    expect(redacted.nested.secret).toBe("[REDACTED]");
    expect(redacted.nested.list[0]).toBe("[REDACTED]");
    expect(redacted.nested.list[1]).toBe("public");
    expect(redacted.id).toBe("123");
    expect(redacted.plain).toBe("nothing");

    // Check no mutation
    expect(original.nested.secret).toBe("secret-123");
  });

  it("does not redact short or empty secret candidates in JSON values", () => {
    const original = {
      text: "abc",
      nested: { key: "abc" }
    };
    const secrets = ["abc", "", "   "];
    const redacted = redactJsonValue(original, secrets) as typeof original;

    expect(redacted.text).toBe("abc");
    expect(redacted.nested.key).toBe("abc");
  });

  it("redacts provider command without mutation", () => {
    const original = {
      command: "curl secret-123",
      args: ["-H", "Authorization: Bearer secret-123", "https://example.com"],
      cwd: "/repo",
      env: {
        API_KEY: "secret-123",
        PUBLIC: "yes"
      },
      stdin: "data: secret-123"
    };
    const secrets = ["secret-123"];
    const redacted = redactProviderCommand(original, secrets);

    expect(redacted.command).toBe("curl [REDACTED]");
    expect(redacted.args[1]).toBe("Authorization: Bearer [REDACTED]");
    expect(redacted.env.API_KEY).toBe("[REDACTED]");
    expect(redacted.env.PUBLIC).toBe("yes");
    expect(redacted.stdin).toBe("data: [REDACTED]");

    // Check no mutation
    expect(original.command).toBe("curl secret-123");
  });

  it("handles provider command without env safely", () => {
    const original = {
      command: "curl secret-123",
      args: ["-X", "POST", "secret-123"],
      cwd: "/repo",
      stdin: "secret-123"
    } as any;
    const secrets = ["secret-123"];
    const redacted = redactProviderCommand(original, secrets);

    expect(redacted.command).toBe("curl [REDACTED]");
    expect(redacted.args[2]).toBe("[REDACTED]");
    expect(redacted.stdin).toBe("[REDACTED]");
    expect(redacted.env).toBeUndefined();

    // Original should not be mutated
    expect(original.env).toBeUndefined();
  });

  it("preserves missing env as undefined in redacted command", () => {
    const original = {
      command: "ls",
      args: ["-la"],
      cwd: "/repo"
    } as any;
    const redacted = redactProviderCommand(original, []);
    expect(redacted.env).toBeUndefined();
  });

  it("redacts serialized error without mutation", () => {
    const original = {
      message: "Error with secret-123",
      stack: "stack trace secret-123\nat line 1",
      code: "INTERNAL"
    };
    const secrets = ["secret-123"];
    const redacted = redactSerializedError(original, secrets);

    expect(redacted.message).toBe("Error with [REDACTED]");
    expect(redacted.stack).toBe("stack trace [REDACTED]\nat line 1");
    expect(redacted.code).toBe("INTERNAL");

    // Check no mutation
    expect(original.message).toBe("Error with secret-123");
  });
});
