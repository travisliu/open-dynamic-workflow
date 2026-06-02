export interface ExtractJsonSuccess {
  ok: true;
  value: unknown;
  source: "direct" | "fenced" | "balanced";
}

export interface ExtractJsonFailure {
  ok: false;
  error: string;
}

export type ExtractJsonResult = ExtractJsonSuccess | ExtractJsonFailure;

export function extractJson(stdout: string): ExtractJsonResult {
  const trimmed = stdout.trim();

  // 1. Direct JSON parse
  try {
    const value = JSON.parse(trimmed);
    return { ok: true, value, source: "direct" };
  } catch {
    // Continue
  }

  // 2. Fenced JSON code blocks (e.g. ```json ... ``` or ``` ... ```)
  const fencedRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let match: RegExpExecArray | null;
  while ((match = fencedRegex.exec(stdout)) !== null) {
    const candidate = match[1]?.trim();
    if (candidate) {
      try {
        const value = JSON.parse(candidate);
        return { ok: true, value, source: "fenced" };
      } catch {
        // Continue
      }
    }
  }

  // 3. Balanced JSON structure (object or array)
  try {
    const value = findBalancedJson(stdout);
    return { ok: true, value, source: "balanced" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function findBalancedJson(text: string): unknown {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{' || char === '[') {
      const start = i;
      let depth = 0;
      let inString = false;
      let escapeNext = false;

      for (let j = start; j < text.length; j++) {
        const c = text[j]!;
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (c === '\\') {
          escapeNext = true;
          continue;
        }
        if (c === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (c === '{' || c === '[') {
            depth++;
          } else if (c === '}' || c === ']') {
            depth--;
            if (depth === 0) {
              const candidate = text.substring(start, j + 1);
              try {
                return JSON.parse(candidate);
              } catch {
                break; // Current bracket matching failed parsing, break to continue outer loop search
              }
            }
          }
        }
      }
    }
  }
  throw new Error("No balanced JSON structure found");
}
