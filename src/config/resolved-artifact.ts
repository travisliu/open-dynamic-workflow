import { toResolvedProviderAliasArtifactRegistry } from "./provider-aliases.js";

export function toResolvedConfigArtifact(resolvedConfig: unknown): unknown {
  if (resolvedConfig === null || typeof resolvedConfig !== "object") {
    return resolvedConfig;
  }

  const config = resolvedConfig as any;
  const { _executionDefaultLayers, ...rest } = config;
  const projected: any = { ...rest };

  if (config.providerAliases) {
    projected.providerAliases = toResolvedProviderAliasArtifactRegistry(config.providerAliases);
  }

  return projected;
}
