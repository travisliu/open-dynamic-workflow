import type { ProviderRegistry } from "./registry.js";
import type { ProviderHealth } from "./types.js";

export async function checkProviderHealth(registry: ProviderRegistry): Promise<ProviderHealth[]> {
  const providers = registry.list();
  const results: ProviderHealth[] = [];

  for (const provider of providers) {
    if (provider.checkHealth) {
      try {
        const health = await provider.checkHealth();
        results.push(health);
      } catch (err) {
        results.push({
          provider: provider.name,
          available: false,
          error: {
            name: (err as Error).name,
            message: (err as Error).message
          }
        });
      }
    } else {
      results.push({
        provider: provider.name,
        available: true
      });
    }
  }

  return results;
}
