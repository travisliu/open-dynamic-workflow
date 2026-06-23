import { describe, expect, it } from "vitest";
import { validateConfig } from "../../../src/config/schema.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

describe("Config Schema Validation", () => {
  it("passes default config", () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it("fails if workflow.maxLoopRounds is not an integer", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        maxLoopRounds: 1.5 as any
      }
    };
    expect(() => validateConfig(config)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig(config)).toThrow("Config value 'workflow.maxLoopRounds' must be a positive integer.");
  });

  it("fails if workflow.maxLoopRounds is less than 1", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        maxLoopRounds: 0
      }
    };
    expect(() => validateConfig(config)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig(config)).toThrow("Config value 'workflow.maxLoopRounds' must be a positive integer.");
  });

  it("passes if workflow.maxLoopRounds is a positive integer", () => {
    const config = {
      ...DEFAULT_CONFIG,
      workflow: {
        ...DEFAULT_CONFIG.workflow,
        maxLoopRounds: 10
      }
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("fails if maxAgentCalls is not a positive integer", () => {
    const config = {
      ...DEFAULT_CONFIG,
      maxAgentCalls: 0
    };

    expect(() => validateConfig(config)).toThrow(OpenDynamicWorkflowError);
    expect(() => validateConfig(config)).toThrow("Config value 'maxAgentCalls' must be a positive integer.");
  });

  it("passes if maxAgentCalls is a positive integer", () => {
    const config = {
      ...DEFAULT_CONFIG,
      maxAgentCalls: 5
    };

    expect(() => validateConfig(config)).not.toThrow();
  });
});
