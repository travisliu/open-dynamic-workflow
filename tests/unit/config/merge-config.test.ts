import { describe, expect, it } from "vitest";
import { mergeConfig } from "../../../src/config/merge.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import type { OpenFlowConfig } from "../../../src/config/types.js";

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

  it("CLI report overrides config", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { reporting: { mode: "json", verbose: false } }, { report: "jsonl" });
    expect(merged.reporting.mode).toBe("jsonl");
  });

  it("provider configs merge instead of replace all providers", () => {
    const fileConfig: Partial<OpenFlowConfig> = {
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
});
