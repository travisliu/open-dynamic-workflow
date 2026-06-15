import { join } from "node:path";
import { stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import {
  SUPPORTED_INIT_PROVIDERS,
  PROVIDER_CANDIDATES,
} from "./defaults.js";
import type {
  SupportedInitProvider,
  ProviderCandidate,
  ProviderSelection
} from "./types.js";

export function isSupportedInitProvider(value: string): value is SupportedInitProvider {
  return SUPPORTED_INIT_PROVIDERS.includes(value as SupportedInitProvider);
}

export async function isExecutableOnPath(
  command: string,
  envPath: string = process.env.PATH || "",
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  if (!command) return false;

  const pathSeparator = platform === "win32" ? ";" : ":";
  const directories = envPath.split(pathSeparator);
  const extensions = platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").map(e => e.toLowerCase())
    : [""];

  for (const dir of directories) {
    if (!dir) continue;
    for (const ext of extensions) {
      const fullPath = join(dir, command + ext);
      try {
        const stats = await stat(fullPath);
        if (stats.isFile()) {
          if (platform === "win32") {
            // On Windows, if it's a file with a valid extension in PATH, we assume it's executable
            return true;
          } else {
            // On POSIX, check execution bit
            await access(fullPath, constants.X_OK);
            return true;
          }
        }
      } catch {
        // Continue to next path/extension
      }
    }
  }

  return false;
}

export async function detectProviders(input?: {
  envPath?: string;
  platform?: NodeJS.Platform;
}): Promise<ProviderCandidate[]> {
  const envPath = input?.envPath ?? process.env.PATH ?? "";
  const platform = input?.platform ?? process.platform;

  const results: ProviderCandidate[] = [];

  for (const candidate of PROVIDER_CANDIDATES) {
    if (candidate.builtIn) {
      results.push({
        ...candidate,
        detected: true
      });
    } else {
      const detected = await isExecutableOnPath(candidate.command || "", envPath, platform);
      results.push({
        ...candidate,
        detected
      });
    }
  }

  return results;
}

export function recommendProvider(candidates: ProviderCandidate[]): SupportedInitProvider {
  const detectedExternal = candidates
    .filter(c => !c.builtIn && c.detected)
    .sort((a, b) => a.recommendedRank - b.recommendedRank);

  if (detectedExternal.length > 0) {
    return detectedExternal[0]!.name;
  }

  return "mock";
}

export function selectProviderNonInteractive(input: {
  requestedProvider?: SupportedInitProvider;
  candidates: ProviderCandidate[];
}): ProviderSelection {
  const { requestedProvider, candidates } = input;

  if (!requestedProvider) {
    const recommended = recommendProvider(candidates);
    return {
      defaultProvider: recommended,
      selectedReason: recommended === "mock" ? "mock-fallback" : "auto-detected"
    };
  }

  const candidate = findProviderCandidate(candidates, requestedProvider);
  if (candidate?.detected) {
    return {
      defaultProvider: requestedProvider,
      requestedProvider,
      selectedReason: "explicit-detected"
    };
  }

  // Unavailable requested provider in non-interactive mode falls back to mock
  return {
    defaultProvider: "mock",
    requestedProvider,
    selectedReason: "explicit-undetected-noninteractive-fallback",
    warning: `requested provider "${requestedProvider}" was not found in PATH.`
  };
}

export function findProviderCandidate(
  candidates: ProviderCandidate[],
  provider: SupportedInitProvider
): ProviderCandidate | undefined {
  return candidates.find(c => c.name === provider);
}
