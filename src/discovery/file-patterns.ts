import { promises as fs } from "node:fs";
import { join } from "node:path";

export async function* walk(dir: string): AsyncGenerator<string> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const res = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walk(res);
      } else {
        yield res;
      }
    }
  } catch (err) {
    // Directory might not exist
  }
}

export function matchGlob(path: string, pattern: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  let normalizedPattern = pattern.replace(/\\/g, "/");
  if (normalizedPattern.startsWith("./")) {
    normalizedPattern = normalizedPattern.slice(2);
  }

  if (normalizedPattern === "." || normalizedPattern === "") {
    return true;
  }

  if (!normalizedPattern.includes("*")) {
    return normalizedPath === normalizedPattern || normalizedPath.startsWith(normalizedPattern + "/");
  }

  const pathParts = normalizedPath.split("/");
  const patternParts = normalizedPattern.split("/");

  function matchParts(pathIdx: number, patternIdx: number): boolean {
    if (patternIdx === patternParts.length) {
      return pathIdx === pathParts.length;
    }

    const patternPart = patternParts[patternIdx];
    if (patternPart === undefined) {
      return false;
    }

    if (patternPart === "**") {
      for (let skip = 0; pathIdx + skip <= pathParts.length; skip++) {
        if (matchParts(pathIdx + skip, patternIdx + 1)) {
          return true;
        }
      }
      return false;
    }

    if (pathIdx === pathParts.length) {
      return false;
    }

    const pathPart = pathParts[pathIdx];
    if (pathPart === undefined) {
      return false;
    }
    let regexStr = "^";
    for (let i = 0; i < patternPart.length; i++) {
      const char = patternPart[i];
      if (char === undefined) continue;
      if (char === "*") {
        regexStr += ".*";
      } else if (/[.+^${}()|[\]\\\-]/.test(char)) {
        regexStr += "\\" + char;
      } else {
        regexStr += char;
      }
    }
    regexStr += "$";
    const regex = new RegExp(regexStr);
    if (!regex.test(pathPart)) {
      return false;
    }

    return matchParts(pathIdx + 1, patternIdx + 1);
  }

  return matchParts(0, 0);
}

export function getGlobBaseDir(pattern: string): string {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  const baseParts: string[] = [];

  for (const part of parts) {
    if (part.includes("*")) {
      break;
    }
    baseParts.push(part);
  }

  return baseParts.length > 0 ? baseParts.join("/") : ".";
}
