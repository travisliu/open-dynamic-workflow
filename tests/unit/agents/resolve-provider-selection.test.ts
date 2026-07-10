import { describe, expect, it } from "vitest";
import {
  resolveProviderReference,
  resolveProviderSelection,
  toProviderSelectionArtifact
} from "../../../src/agents/resolve-provider-selection.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import type { ResolvedProviderAliasRegistry, ProviderConfig, ExecutionDefaultLayers } from "../../../src/config/types.js";

describe("Authoritative Provider Selection Service", () => {
  const providers: Record<string, ProviderConfig> = {
    mock: {
      command: "mock",
      defaultModel: "mock-model",
      timeoutMs: 15000,
      defaultThinkingEffort: "medium"
    },
    gemini: {
      command: "gemini",
      defaultModel: "gemini-3.5-flash",
      timeoutMs: 30000,
      thinking: "high" // Legacy fallback behavior
    }
  };

  const aliases: ResolvedProviderAliasRegistry = {
    aliasA: {
      name: "aliasA",
      inheritanceChain: ["aliasA"],
      provider: "mock",
      origins: { provider: "aliasA", model: "aliasA", timeoutMs: "aliasA" },
      digest: "sha256:aliasA-digest",
      model: "aliasA-model",
      timeoutMs: 5000,
      retry: { maxAttempts: 3 }
    },
    childAlias: {
      name: "childAlias",
      inheritanceChain: ["parentAlias", "childAlias"],
      provider: "mock",
      origins: {
        provider: "parentAlias",
        model: "childAlias",
        timeoutMs: "parentAlias",
        retry: {
          sourceAlias: "childAlias",
          fieldSources: {
            maxAttempts: "parentAlias",
            delayMs: "childAlias"
          }
        }
      },
      digest: "sha256:childAlias-digest",
      model: "child-model",
      timeoutMs: 10000,
      retry: { maxAttempts: 5, delayMs: 500 }
    }
  };

  const layers: ExecutionDefaultLayers = {
    cli: {
      provider: "gemini",
      model: "gemini-cli-model",
      timeoutMs: 20000,
      thinkingEffort: "low",
      retry: { maxAttempts: 2 }
    },
    config: {
      defaultProvider: "mock",
      defaultModel: "config-model",
      timeoutMs: 25000,
      retry: { maxAttempts: 4 }
    },
    builtIn: {
      defaultProvider: "mock",
      timeoutMs: 900000
    }
  };

  describe("resolveProviderReference", () => {
    it("performs own-property alias-first lookup", () => {
      const ref = resolveProviderReference({
        requestedProvider: "aliasA",
        aliases,
        providers
      });
      expect(ref.kind).toBe("alias");
      expect(ref.provider).toBe("mock");
      if (ref.kind === "alias") {
        expect(ref.alias.name).toBe("aliasA");
      }
    });

    it("performs configured provider lookup if alias is not found", () => {
      const ref = resolveProviderReference({
        requestedProvider: "gemini",
        aliases,
        providers
      });
      expect(ref.kind).toBe("provider");
      expect(ref.provider).toBe("gemini");
    });

    it("throws PROVIDER_REFERENCE_NOT_FOUND when neither matches", () => {
      let error: any;
      try {
        resolveProviderReference({
          requestedProvider: "nonexistent",
          aliases,
          providers
        });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(OpenDynamicWorkflowError);
      expect(error.code).toBe(ErrorCode.PROVIDER_REFERENCE_NOT_FOUND);
      expect(error.requestedProvider).toBe("nonexistent");
      expect(error.cause?.requestedProvider).toBe("nonexistent");
    });
  });

  describe("resolveProviderSelection", () => {
    it("resolves requested reference by precedence: call > cli > config > builtIn", () => {
      // 1. Call level presence
      const selCall = resolveProviderSelection({
        call: { provider: "aliasA" },
        providers,
        aliases,
        layers
      });
      expect(selCall.requestedProvider).toBe("aliasA");
      expect(selCall.requestedProviderSource).toBe("agent");

      // 2. CLI override presence
      const selCli = resolveProviderSelection({
        call: {},
        providers,
        aliases,
        layers
      });
      expect(selCli.requestedProvider).toBe("gemini");
      expect(selCli.requestedProviderSource).toBe("cli");

      // 3. Config default presence
      const layersNoCli = { ...layers, cli: {} };
      const selConfig = resolveProviderSelection({
        call: {},
        providers,
        aliases,
        layers: layersNoCli
      });
      expect(selConfig.requestedProvider).toBe("mock");
      expect(selConfig.requestedProviderSource).toBe("globalConfig");

      // 4. Built-in default presence
      const layersBuiltInOnly = { ...layersNoCli, config: {} };
      const selBuiltIn = resolveProviderSelection({
        call: {},
        providers,
        aliases,
        layers: layersBuiltInOnly
      });
      expect(selBuiltIn.requestedProvider).toBe("mock");
      expect(selBuiltIn.requestedProviderSource).toBe("builtIn");
    });

    it("resolves model by precedence and preserves explicit null as terminal value", () => {
      // call.model > alias.model > CLI model > provider config defaultModel > config defaultModel
      const selCall = resolveProviderSelection({
        call: { provider: "aliasA", model: "call-model" },
        providers,
        aliases,
        layers
      });
      expect(selCall.model).toBe("call-model");

      const selAlias = resolveProviderSelection({
        call: { provider: "aliasA" },
        providers,
        aliases,
        layers: { ...layers, cli: {} }
      });
      expect(selAlias.model).toBe("aliasA-model");

      const selNull = resolveProviderSelection({
        call: { provider: "aliasA", model: null },
        providers,
        aliases,
        layers
      });
      expect(selNull.model).toBeNull();
    });

    it("resolves thinking effort by precedence including legacy provider fallback", () => {
      // call.thinkingEffort > alias.thinkingEffort > CLI thinkingEffort > provider defaultThinkingEffort > legacy provider fallback
      const selCall = resolveProviderSelection({
        call: { provider: "gemini", thinkingEffort: "high" },
        providers,
        aliases,
        layers
      });
      expect(selCall.thinkingEffort).toBe("high");

      const selLegacy = resolveProviderSelection({
        call: { provider: "gemini" },
        providers,
        aliases,
        layers: { ...layers, cli: {} }
      });
      expect(selLegacy.thinkingEffort).toBe("high"); // From providerConfig.thinking
    });

    it("resolves timeout by precedence", () => {
      // call.timeoutMs > alias.timeoutMs > CLI timeoutMs > provider config timeoutMs > config timeoutMs > builtIn
      const selCall = resolveProviderSelection({
        call: { provider: "mock", timeoutMs: 123 },
        providers,
        aliases,
        layers
      });
      expect(selCall.timeoutMs).toBe(123);
    });

    it("delegates retry resolution to resolveLayeredRetryPolicy", () => {
      const selection = resolveProviderSelection({
        call: { provider: "mock", retry: { maxAttempts: 9 } },
        providers,
        aliases,
        layers
      });
      expect(selection.retry.policy.maxAttempts).toBe(9);
    });

    it("records setting overrides with correct displaced layers and equivalent-value suppression", () => {
      const selection = resolveProviderSelection({
        call: { provider: "mock", model: "override-model" },
        providers,
        aliases,
        layers: {
          ...layers,
          cli: { provider: "mock", model: "override-model" }, // same value as call
          config: { defaultProvider: "mock", defaultModel: "displaced-model" },
          builtIn: { defaultProvider: "mock", timeoutMs: 900000 }
        }
      });

      // cli.model override should be suppressed because it is equivalent to call.model.
      // config.defaultModel and providerConfig defaultModel should be displaced because they have different values.
      const modelOverrides = selection.overrides.filter(o => o.setting === "model");
      expect(modelOverrides.length).toBe(2);
      const values = modelOverrides.map(o => o.overridden.value);
      expect(values).toContain("mock-model");
      expect(values).toContain("displaced-model");
    });

    it("asserts returned selection and nested data are deeply immutable", () => {
      const selection = resolveProviderSelection({
        call: { provider: "mock" },
        providers,
        aliases,
        layers
      });

      expect(() => {
        (selection as any).provider = "new-provider";
      }).toThrow();

      expect(() => {
        (selection.sources as any).provider = {};
      }).toThrow();

      expect(() => {
        (selection.retry as any).enabled = true;
      }).toThrow();
    });

    it("TC-SCL-01: resolves model, effort, and timeout by removing winners one at a time to prove precedence chain and exact sourcePath", () => {
      const customLayers = {
        cli: { model: "cli-model", timeoutMs: 20000, thinkingEffort: "low" as const },
        config: { defaultModel: "config-model", timeoutMs: 25000 },
        builtIn: { defaultProvider: "mock", timeoutMs: 900000 }
      };

      // 1. All layers present: agent/call layer wins
      let sel = resolveProviderSelection({
        call: { provider: "aliasA", model: "call-model", timeoutMs: 1000, thinkingEffort: "high" },
        providers,
        aliases,
        layers: customLayers
      });
      expect(sel.model).toBe("call-model");
      expect(sel.sources.model?.source).toBe("agent");
      expect(sel.sources.model?.sourcePath).toBe("agent.model");

      expect(sel.thinkingEffort).toBe("high");
      expect(sel.sources.thinkingEffort?.source).toBe("agent");
      expect(sel.sources.thinkingEffort?.sourcePath).toBe("agent.thinkingEffort");

      expect(sel.timeoutMs).toBe(1000);
      expect(sel.sources.timeoutMs.source).toBe("agent");
      expect(sel.sources.timeoutMs.sourcePath).toBe("agent.timeoutMs");

      // 2. Remove agent/call layer settings: provider alias layer wins
      sel = resolveProviderSelection({
        call: { provider: "aliasA" },
        providers,
        aliases,
        layers: customLayers
      });
      expect(sel.model).toBe("aliasA-model");
      expect(sel.sources.model?.source).toBe("providerAlias");
      expect(sel.sources.model?.sourcePath).toBe("providerAliases.aliasA.model");

      // Note: aliasA does not define thinkingEffort, so CLI layer wins for thinkingEffort
      expect(sel.thinkingEffort).toBe("low");
      expect(sel.sources.thinkingEffort?.source).toBe("cli");
      expect(sel.sources.thinkingEffort?.sourcePath).toBe("cli.thinkingEffort");

      expect(sel.timeoutMs).toBe(5000); // aliasA defines timeoutMs: 5000
      expect(sel.sources.timeoutMs.source).toBe("providerAlias");
      expect(sel.sources.timeoutMs.sourcePath).toBe("providerAliases.aliasA.timeoutMs");

      // Let's test a childAlias that inherits from parentAlias
      sel = resolveProviderSelection({
        call: { provider: "childAlias" },
        providers,
        aliases,
        layers: customLayers
      });
      expect(sel.model).toBe("child-model"); // defined on childAlias
      expect(sel.sources.model?.source).toBe("providerAlias");
      expect(sel.sources.model?.sourcePath).toBe("providerAliases.childAlias.model");

      expect(sel.timeoutMs).toBe(10000); // defined on childAlias
      expect(sel.sources.timeoutMs.source).toBe("providerAlias");
      expect(sel.sources.timeoutMs.sourcePath).toBe("providerAliases.parentAlias.timeoutMs");

      // 3. Use direct provider (bypasses providerAlias) or remove providerAlias model/timeout: CLI layer wins
      sel = resolveProviderSelection({
        call: { provider: "gemini" },
        providers,
        aliases,
        layers: customLayers
      });
      expect(sel.model).toBe("cli-model");
      expect(sel.sources.model?.source).toBe("cli");
      expect(sel.sources.model?.sourcePath).toBe("cli.model");

      expect(sel.thinkingEffort).toBe("low");
      expect(sel.sources.thinkingEffort?.source).toBe("cli");
      expect(sel.sources.thinkingEffort?.sourcePath).toBe("cli.thinkingEffort");

      expect(sel.timeoutMs).toBe(20000);
      expect(sel.sources.timeoutMs.source).toBe("cli");
      expect(sel.sources.timeoutMs.sourcePath).toBe("cli.timeoutMs");

      // 4. Remove CLI layer: provider config layer wins
      const customLayersNoCli = { ...customLayers, cli: {} };
      sel = resolveProviderSelection({
        call: { provider: "gemini" },
        providers,
        aliases,
        layers: customLayersNoCli
      });
      expect(sel.model).toBe("gemini-3.5-flash");
      expect(sel.sources.model?.source).toBe("providerConfig");
      expect(sel.sources.model?.sourcePath).toBe("providers.gemini.defaultModel");

      // gemini provider has legacy thinking: "high"
      expect(sel.thinkingEffort).toBe("high");
      expect(sel.sources.thinkingEffort?.source).toBe("providerConfig");
      expect(sel.sources.thinkingEffort?.sourcePath).toBe("providers.gemini.thinking");

      expect(sel.timeoutMs).toBe(30000);
      expect(sel.sources.timeoutMs.source).toBe("providerConfig");
      expect(sel.sources.timeoutMs.sourcePath).toBe("providers.gemini.timeoutMs");

      // 5. Remove provider config layer settings: global config layer wins
      const providersEmptyConfig = {
        gemini: { command: "gemini" }
      };
      sel = resolveProviderSelection({
        call: { provider: "gemini" },
        providers: providersEmptyConfig,
        aliases,
        layers: customLayersNoCli
      });
      expect(sel.model).toBe("config-model");
      expect(sel.sources.model?.source).toBe("globalConfig");
      expect(sel.sources.model?.sourcePath).toBe("config.defaultModel");

      // thinkingEffort is not defined in globalConfig or builtIn, so it's undefined
      expect(sel.thinkingEffort).toBeUndefined();
      expect(sel.sources.thinkingEffort).toBeUndefined();

      expect(sel.timeoutMs).toBe(25000);
      expect(sel.sources.timeoutMs.source).toBe("globalConfig");
      expect(sel.sources.timeoutMs.sourcePath).toBe("config.timeoutMs");

      // 6. Remove global config layer settings: builtIn layer wins
      const customLayersBuiltInOnly = { ...customLayersNoCli, config: {} };
      sel = resolveProviderSelection({
        call: { provider: "gemini" },
        providers: providersEmptyConfig,
        aliases,
        layers: customLayersBuiltInOnly
      });
      // model is undefined as there is no built-in default model
      expect(sel.model).toBeUndefined();
      expect(sel.sources.model).toBeUndefined();

      expect(sel.timeoutMs).toBe(900000);
      expect(sel.sources.timeoutMs.source).toBe("builtIn");
      expect(sel.sources.timeoutMs.sourcePath).toBe("builtIn.timeoutMs");
    });
  });

  describe("toProviderSelectionArtifact", () => {
    it("projects only safe/allowlisted fields and returns deeply immutable data", () => {
      const selection = resolveProviderSelection({
        call: { provider: "childAlias" },
        providers,
        aliases,
        layers
      });

      const artifact = toProviderSelectionArtifact(selection);

      // Check schema version
      expect(artifact.schemaVersion).toBe("open-dynamic-workflow.provider-selection.v1");

      // Check selection fields
      expect(artifact.selection.requestedProvider).toBe("childAlias");
      expect(artifact.selection.requestedProviderSource).toBe("agent");
      expect(artifact.selection.providerAlias).toBe("childAlias");
      expect(artifact.selection.providerAliasChain).toEqual(["parentAlias", "childAlias"]);
      expect(artifact.selection.providerAliasDigest).toBe("sha256:childAlias-digest");
      expect(artifact.selection.resolvedProvider).toBe("mock");

      // Check resolvedExecution fields
      expect(artifact.resolvedExecution.model).toBe("child-model");
      expect(artifact.resolvedExecution.timeoutMs).toBe(10000);
      expect(artifact.resolvedExecution.retry.maxAttempts).toBe(5);

      // Check sources (setting names to sources)
      expect(artifact.sources.provider).toBe("providerAlias");
      expect(artifact.sources.model).toBe("providerAlias");
      expect(artifact.sources.timeoutMs).toBe("providerAlias");

      // Omissions:
      expect((artifact as any).overrides).toBeUndefined();
      expect((artifact as any).retryFieldSources).toBeUndefined();
      expect((artifact as any).sources.provider.sourcePath).toBeUndefined();

      // Immutability
      expect(() => {
        (artifact as any).selection.resolvedProvider = "mutated";
      }).toThrow();
    });
  });
});
