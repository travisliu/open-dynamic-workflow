import { describe, expect, it } from "vitest";
import { mergeConfig } from "../../../src/config/merge.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import type { OpenDynamicWorkflowConfig } from "../../../src/config/types.js";

describe("Merge Config", () => {
  it("CLI provider overrides default provider", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {}, { provider: "gemini" });
    expect(merged.defaultProvider).toBe("gemini");
  });

  it("CLI concurrency overrides config", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { concurrency: 2 }, { concurrency: 10 });
    expect(merged.concurrency).toBe(10);
  });

  it("CLI timeout overrides config", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { timeoutMs: 1000 }, { timeoutMs: 5000 });
    expect(merged.timeoutMs).toBe(5000);
  });

  it("CLI maxAgentCalls overrides config", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { maxAgentCalls: 10 }, { maxAgentCalls: 3 });
    expect(merged.maxAgentCalls).toBe(3);
  });

  it("CLI report overrides config", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { reporting: { mode: "json", verbose: false } }, { report: "jsonl" });
    expect(merged.reporting.mode).toBe("jsonl");
  });

  it("CLI verbose overrides config default according to precedence", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { reporting: { verbose: false } }, { verbose: true });
    expect(merged.reporting.verbose).toBe(true);
  });

  it("Config verbose remains enabled without CLI flag", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { reporting: { verbose: true } }, {});
    expect(merged.reporting.verbose).toBe(true);
  });

  it("CLI verbose false overrides config verbose true", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { reporting: { verbose: true } }, { verbose: false });
    expect(merged.reporting.verbose).toBe(false);
  });

  it("provider configs merge instead of replace all providers", () => {
    const fileConfig: Partial<OpenDynamicWorkflowConfig> = {
      providers: {
        codex: {
          command: "custom-codex",
          args: ["--custom"],
          defaultModel: "custom-model"
        }
      }
    };

    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, {});
    // Codex should be merged/updated
    expect(merged.providers.codex?.command).toBe("custom-codex");
    expect(merged.providers.codex?.defaultModel).toBe("custom-model");
    // Mock should still exist
    expect(merged.providers.mock).toBeDefined();
    expect(merged.providers.mock?.command).toBe("mock");
  });

  it("allowWorkflowImports: true in config is forced or rejected as false", () => {
    // Explicit attempt to enable allowWorkflowImports via fileConfig
    const fileConfig: any = {
      security: {
        allowWorkflowImports: true,
        passEnv: [],
        redactEnv: []
      }
    };

    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, {});
    expect(merged.security.allowWorkflowImports).toBe(false);
  });

  it("sharedAgents.dir overrides defaults", () => {
    const fileConfig: any = {
      sharedAgents: {
        dir: "custom/agents"
      }
    };
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, {});
    expect(merged.sharedAgents.dir).toEqual("custom/agents");
    // Other defaults should remain
    expect(merged.sharedAgents.maxDefinitions).toBe(100);
  });

  it("sharedAgents.allowDynamicIds is forced to false", () => {
    const fileConfig: any = {
      sharedAgents: {
        allowDynamicIds: true
      }
    };
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, {});
    expect(merged.sharedAgents.allowDynamicIds).toBe(false);
  });

  it("workflow.discovery.include replaces defaults", () => {
    const fileConfig: any = {
      workflow: {
        discovery: {
          include: ["custom/**/*.ts"]
        }
      }
    };
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, {});
    expect(merged.workflow.discovery.include).toEqual(["custom/**/*.ts"]);
    // maxDepth should remain default
    expect(merged.workflow.maxDepth).toBe(8);
  });

  it("workflow.maxDepth overrides defaults", () => {
    const fileConfig: any = {
      workflow: {
        maxDepth: 3
      }
    };
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, {});
    expect(merged.workflow.maxDepth).toBe(3);
    // discovery should remain default
    expect(merged.workflow.discovery.include).toEqual(["workflows/**/*.ts"]);
  });

  it("workflow.maxLoopRounds overrides defaults", () => {
    const fileConfig: any = {
      workflow: {
        maxLoopRounds: 10
      }
    };
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, {});
    expect(merged.workflow.maxLoopRounds).toBe(10);
    // maxDepth should remain default
    expect(merged.workflow.maxDepth).toBe(8);
    // discovery should remain default
    expect(merged.workflow.discovery.include).toEqual(["workflows/**/*.ts"]);
  });

  it("workflow.maxDepth preserves maxLoopRounds default", () => {
    const fileConfig: any = {
      workflow: {
        maxDepth: 3
      }
    };
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig, {});
    expect(merged.workflow.maxDepth).toBe(3);
    expect(merged.workflow.maxLoopRounds).toBe(20);
  });

  it("provider-config merge: a later defaultThinkingEffort overrides an earlier value", () => {
    const customDefaults = {
      ...DEFAULT_CONFIG,
      providers: {
        mock: {
          command: "mock",
          defaultModel: null,
          defaultThinkingEffort: "low" as const
        }
      }
    };
    const fileConfig: Partial<OpenDynamicWorkflowConfig> = {
      providers: {
        mock: {
          command: "mock",
          defaultModel: null,
          defaultThinkingEffort: "high" as const
        }
      }
    };

    const merged = mergeConfig(customDefaults, fileConfig, {});
    expect(merged.providers.mock?.defaultThinkingEffort).toBe("high");
  });

  it("provider-config merge: omission in a later layer preserves the earlier value and no layer invents a default", () => {
    const customDefaults = {
      ...DEFAULT_CONFIG,
      providers: {
        mock: {
          command: "mock",
          defaultModel: null,
          defaultThinkingEffort: "low" as const
        }
      }
    };
    const fileConfig: Partial<OpenDynamicWorkflowConfig> = {
      providers: {
        mock: {
          command: "mock-custom",
          defaultModel: null
        }
      }
    };

    const merged = mergeConfig(customDefaults, fileConfig, {});
    expect(merged.providers.mock?.defaultThinkingEffort).toBe("low");
    expect(merged.providers.codex?.defaultThinkingEffort).toBeUndefined();
  });
});
