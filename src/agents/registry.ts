import type { AgentAdapter, ResolvedConfig, MockProviderConfig } from "./types.js";
import { MockAdapter } from "./mock-adapter.js";
import { CodexExecAdapter } from "./codex-exec.js";
import { GeminiCliAdapter } from "./gemini-cli.js";
import { OpenCodeCliAdapter, type OpenCodeProviderConfig } from "./opencode-cli.js";
import { AntigravityCliAdapter, type AntigravityProviderConfig } from "./antigravity-cli.js";
import { PiCodingAgentAdapter, type PiCodingAgentProviderConfig } from "./pi-coding-agent.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export class ProviderRegistry {
  private readonly adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Provider adapter already registered: ${adapter.name}`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  get(provider: string): AgentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new OpenFlowError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `Unknown provider: ${provider}`
      );
    }
    return adapter;
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }
}

export interface RegistryDeps {
  config: ResolvedConfig;
  mockConfig?: MockProviderConfig;
}

export function createDefaultProviderRegistry(deps: RegistryDeps): ProviderRegistry {
  const registry = new ProviderRegistry();
  
  // MockProviderConfig can come from explicit mockConfig, or from the provider config's responses/mock fields
  const providerMockConfig = deps.config.providers["mock"] as any;
  const mockConfig: MockProviderConfig | undefined = deps.mockConfig ?? 
    providerMockConfig?.mock ??
    (providerMockConfig?.responses ? { responses: providerMockConfig.responses } : undefined);
  registry.register(new MockAdapter(mockConfig));
  registry.register(new CodexExecAdapter(deps.config.providers["codex"]));
  registry.register(new GeminiCliAdapter(deps.config.providers["gemini"]));
  registry.register(new OpenCodeCliAdapter(deps.config.providers["opencode"] as OpenCodeProviderConfig));
  registry.register(new AntigravityCliAdapter(deps.config.providers["antigravity"] as AntigravityProviderConfig));
  registry.register(new PiCodingAgentAdapter(deps.config.providers["pi"] as PiCodingAgentProviderConfig));
  
  return registry;
}
