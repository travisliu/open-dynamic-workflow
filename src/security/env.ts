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

  const sortedSecrets = [...new Set(validSecrets)].sort((a, b) => b.length - a.length);

  for (const secret of sortedSecrets) {
    const escaped = secret.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(escaped, "g");
    redacted = redacted.replace(regex, "[REDACTED]");
  }

  return redacted;
}
