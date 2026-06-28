import type { NormalizedResourceDiscovery } from "../config/types.js";
import type { ResourceDiscoveryPatterns } from "../discovery/types.js";

export function toResourcePatterns(resource: NormalizedResourceDiscovery): ResourceDiscoveryPatterns {
  return {
    include: resource.include,
    exclude: resource.exclude,
    compatibilityMode: resource.compatibilityMode,
  };
}
