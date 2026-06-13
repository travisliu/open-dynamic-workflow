import type { ProviderCommand } from "../types/agent.js";

export const DEFAULT_REDACT_PATTERNS = [
  "*_KEY",
  "*_TOKEN",
  "*_SECRET",
  "PASSWORD",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY"
];

export function shouldRedactEnvName(name: string, patterns: string[] = DEFAULT_REDACT_PATTERNS): boolean {
  const upperName = name.toUpperCase();
  for (const pattern of patterns) {
    const upperPattern = pattern.toUpperCase();
    if (upperPattern.startsWith("*") && upperPattern.endsWith("*")) {
      const core = upperPattern.slice(1, -1);
      if (upperName.includes(core)) return true;
    } else if (upperPattern.startsWith("*")) {
      const suffix = upperPattern.slice(1);
      if (upperName.endsWith(suffix)) return true;
    } else if (upperPattern.endsWith("*")) {
      const prefix = upperPattern.slice(0, -1);
      if (upperName.startsWith(prefix)) return true;
    } else {
      if (upperName === upperPattern) return true;
    }
  }
  return false;
}

export function buildProviderEnv(input: {
  baseEnv: NodeJS.ProcessEnv;
  passEnv: string[];
  explicitEnv?: Record<string, string>;
}): Record<string, string> {
  const env: Record<string, string> = {};

  const systemKeys = ["PATH", "HOME", "USER", "LANG", "TERM", "SYSTEMROOT", "WINDIR"];
  const allAllowedKeys = new Set([
    ...systemKeys.map((k) => k.toUpperCase()),
    ...input.passEnv.map((k) => k.toUpperCase())
  ]);

  for (const [key, value] of Object.entries(input.baseEnv)) {
    if (value !== undefined && allAllowedKeys.has(key.toUpperCase())) {
      env[key] = value;
    }
  }

  if (input.explicitEnv) {
    for (const [key, value] of Object.entries(input.explicitEnv)) {
      env[key] = value;
    }
  }

  return env;
}

export function redactText(input: string, secretValues: string[]): string {
  if (!input) return input;
  let redacted = input;

  const validSecrets = secretValues
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

  // Sort by length descending to ensure longer secrets are redacted first
  const sortedSecrets = [...new Set(validSecrets)].sort((a, b) => b.length - a.length);

  for (const secret of sortedSecrets) {
    const escaped = secret.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(escaped, "g");
    redacted = redacted.replace(regex, "[REDACTED]");
  }

  return redacted;
}

/**
 * Stateful redactor for streaming text.
 * Ensures secrets split across chunks are correctly identified and redacted.
 */
export class StreamRedactor {
  private buffer: string = "";
  private readonly secrets: string[];
  private readonly maxSecretLen: number;

  constructor(secretValues: string[]) {
    this.secrets = [...new Set(secretValues.map((s) => s.trim()).filter((s) => s.length >= 4))]
      .sort((a, b) => b.length - a.length);
    this.maxSecretLen = this.secrets.length > 0 ? Math.max(...this.secrets.map((s) => s.length)) : 0;
  }

  /**
   * Processes a new chunk of text and returns the redacted part that is safe to output.
   */
  process(chunk: string): string {
    if (this.maxSecretLen === 0) return chunk;

    this.buffer += chunk;
    let out = "";

    // We keep at least maxSecretLen characters in the buffer to ensure we can 
    // identify any secret that might be starting or ending in this context.
    while (this.buffer.length > this.maxSecretLen) {
      // Use the existing redactText to see what the buffer looks like when redacted
      const redacted = redactText(this.buffer, this.secrets);

      if (redacted.startsWith("[REDACTED]")) {
        // A secret was found at the very beginning of our buffer.
        // We need to figure out which one it was so we can consume it from the original buffer.
        let matchedSecretLen = 0;
        for (const secret of this.secrets) {
          if (this.buffer.startsWith(secret)) {
            matchedSecretLen = secret.length;
            break;
          }
        }

        if (matchedSecretLen > 0) {
          out += "[REDACTED]";
          this.buffer = this.buffer.slice(matchedSecretLen);
          continue;
        }
      }

      // If no secret matched at the beginning, the first character is safe to output
      // because we have at least maxSecretLen context following it.
      out += this.buffer[0];
      this.buffer = this.buffer.slice(1);
    }

    return out;
  }

  /**
   * Flushes any remaining text in the buffer, redacting it one last time.
   */
  flush(): string {
    if (!this.buffer) return "";
    const redacted = redactText(this.buffer, this.secrets);
    this.buffer = "";
    return redacted;
  }
}

export function collectSecretValues(
  baseEnv: NodeJS.ProcessEnv,
  patterns: string[] = DEFAULT_REDACT_PATTERNS
): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value && shouldRedactEnvName(key, patterns)) {
      values.push(value);
    }
  }
  return values;
}

/**
 * Redacts string values inside a JSON-like structure.
 * Accepts JSON-like values only; must not contain circular references.
 */
export function redactJsonValue(value: unknown, secretValues: string[]): unknown {
  if (typeof value === "string") {
    return redactText(value, secretValues);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactJsonValue(v, secretValues));
  }
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      redacted[key] = redactJsonValue(val, secretValues);
    }
    return redacted;
  }
  return value;
}

export function redactProviderCommand(command: ProviderCommand, secretValues: string[]): ProviderCommand {
  const redacted: ProviderCommand = {
    ...command,
    command: redactText(command.command, secretValues),
    args: command.args.map((arg) => redactText(arg, secretValues)),
    stdin: command.stdin ? redactText(command.stdin, secretValues) : command.stdin,
  };

  if (command.env) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(command.env)) {
      env[key] = redactText(value, secretValues);
    }
    redacted.env = env;
  } else {
    redacted.env = undefined;
  }

  return redacted;
}

export function redactSerializedError<T extends { message?: string; stack?: string }>(
  error: T,
  secretValues: string[]
): T {
  return {
    ...error,
    message: error.message ? redactText(error.message, secretValues) : error.message,
    stack: error.stack ? redactText(error.stack, secretValues) : error.stack
  };
}
