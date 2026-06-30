import { glob, type GlobOptions } from "tinyglobby";
import picomatch from "picomatch";

export interface ExpandIncludePatternInput {
  cwd: string;
  pattern: string;
}

export const TINYGLOBBY_OPTIONS = {
  absolute: true,
  onlyFiles: true,
  dot: true,
  expandDirectories: false,
  braceExpansion: true,
  extglob: true,
  globstar: true,
  followSymbolicLinks: false,
  ignore: [],
} satisfies Partial<GlobOptions>;

export async function expandIncludePattern(input: ExpandIncludePatternInput): Promise<string[]> {
  let normalizedPattern = input.pattern.replace(/\\/g, "/");
  if (normalizedPattern.startsWith("./")) {
    normalizedPattern = normalizedPattern.slice(2);
  }

  const results = await glob(normalizedPattern, {
    cwd: input.cwd,
    ...TINYGLOBBY_OPTIONS,
  });

  const normalizedResults = results.map((p) => p.replace(/\\/g, "/"));
  normalizedResults.sort((a, b) => a.localeCompare(b));
  return normalizedResults;
}

export function matchesDiscoveryPattern(relativePath: string, pattern: string): boolean {
  let normalizedPattern = pattern.replace(/\\/g, "/");
  if (normalizedPattern.startsWith("./")) {
    normalizedPattern = normalizedPattern.slice(2);
  }
  const normalizedPath = relativePath.replace(/\\/g, "/");
  return picomatch.isMatch(normalizedPath, normalizedPattern, { dot: true });
}

