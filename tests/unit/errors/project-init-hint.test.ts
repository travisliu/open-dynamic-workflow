import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  detectProjectInitHintContext,
  buildProjectInitHint,
  isHintEligibleDiagnostic,
  isHintEligibleError,
  attachHintToDiagnostic,
  attachHintToError,
} from "../../../src/errors/project-init-hint.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { serializeError } from "../../../src/errors/serialize.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

describe("project-init-hint", () => {
  const existsSyncSpy = vi.mocked(fs.existsSync);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("detectProjectInitHintContext", () => {
    it("detects missing default config correctly", () => {
      existsSyncSpy.mockReturnValue(false);
      const ctx = detectProjectInitHintContext({
        cwd: "/dummy/project",
      });
      expect(ctx.defaultConfigExists).toBe(false);
      expect(ctx.hasExplicitConfig).toBe(false);
      expect(ctx.explicitResolvesToDefault).toBe(true);
      expect(ctx.commandName).toBe("odw");
    });

    it("detects present default config correctly", () => {
      existsSyncSpy.mockReturnValue(true);
      const ctx = detectProjectInitHintContext({
        cwd: "/dummy/project",
      });
      expect(ctx.defaultConfigExists).toBe(true);
    });

    it("custom config suppresses the hint", () => {
      existsSyncSpy.mockReturnValue(false);
      const ctx = detectProjectInitHintContext({
        cwd: "/dummy/project",
        configPath: "custom.yaml",
      });
      expect(ctx.hasExplicitConfig).toBe(true);
      expect(ctx.explicitResolvesToDefault).toBe(false);
    });

    it("explicit config resolving to default path still allows the hint", () => {
      existsSyncSpy.mockReturnValue(false);
      const ctx = detectProjectInitHintContext({
        cwd: "/dummy/project",
        configPath: ".open-dynamic-workflow/config.yaml",
      });
      expect(ctx.hasExplicitConfig).toBe(true);
      expect(ctx.explicitResolvesToDefault).toBe(true);
    });

    it("uses invoked binary name when provided", () => {
      const ctx = detectProjectInitHintContext({
        cwd: "/dummy/project",
        invokedBinaryName: "open-dynamic-workflow",
      });
      expect(ctx.commandName).toBe("open-dynamic-workflow");
    });
  });

  describe("buildProjectInitHint", () => {
    it("returns undefined if default config exists", () => {
      const ctx = {
        defaultConfigExists: true,
        hasExplicitConfig: false,
        explicitResolvesToDefault: true,
        commandName: "odw",
      };
      expect(buildProjectInitHint(ctx)).toBeUndefined();
    });

    it("returns undefined if custom explicit config was provided", () => {
      const ctx = {
        defaultConfigExists: false,
        hasExplicitConfig: true,
        explicitResolvesToDefault: false,
        commandName: "odw",
      };
      expect(buildProjectInitHint(ctx)).toBeUndefined();
    });

    it("returns structured hint when default config is missing", () => {
      const ctx = {
        defaultConfigExists: false,
        hasExplicitConfig: false,
        explicitResolvesToDefault: true,
        commandName: "open-dynamic-workflow",
      };
      const hint = buildProjectInitHint(ctx);
      expect(hint).toEqual({
        code: "PROJECT_INIT_MISSING",
        message: "This project may not be initialized yet. Run `open-dynamic-workflow init` to create .open-dynamic-workflow/config.yaml and default project directories.",
        command: "open-dynamic-workflow init",
        docsContext: "Project initialization creates the default config, shared agent directory, tool directory, and starter workflow layout.",
      });
    });
  });

  describe("isHintEligibleDiagnostic", () => {
    it("returns true for eligible diagnostic codes", () => {
      expect(isHintEligibleDiagnostic({
        severity: "error",
        resourceType: "workflow",
        path: "workflows",
        code: "LIST_DIRECTORY_NOT_FOUND",
        message: "Dir missing",
      })).toBe(true);

      expect(isHintEligibleDiagnostic({
        severity: "error",
        resourceType: "agent",
        path: "agents",
        code: "AGENT_DEFINITION_MISSING",
        message: "Agent definition missing",
      })).toBe(true);
    });

    it("returns false for ineligible diagnostic codes", () => {
      expect(isHintEligibleDiagnostic({
        severity: "error",
        resourceType: "workflow",
        path: "workflows",
        code: "WORKFLOW_METADATA_INVALID",
        message: "invalid meta",
      })).toBe(false);
    });
  });

  describe("isHintEligibleError", () => {
    it("returns true for eligible error codes", () => {
      expect(isHintEligibleError({ code: "SHARED_AGENT_NOT_FOUND" })).toBe(true);
      expect(isHintEligibleError({ code: "WORKFLOW_DEFINITION_NOT_FOUND" })).toBe(true);
      expect(isHintEligibleError({ code: "WORKFLOW_DISCOVERY_FAILED" })).toBe(true);
    });

    it("handles WORKFLOW_TARGET_NOT_FOUND properly", () => {
      expect(isHintEligibleError({
        code: "WORKFLOW_TARGET_NOT_FOUND",
        message: "Workflow 'foo' not found by name or file path.",
      })).toBe(true);

      expect(isHintEligibleError({
        code: "WORKFLOW_TARGET_NOT_FOUND",
        message: "Workflow target is required.",
      })).toBe(false);
    });

    it("returns false for ineligible error codes", () => {
      expect(isHintEligibleError({ code: "CONFIG_VALIDATION_ERROR" })).toBe(false);
      expect(isHintEligibleError({ code: "PROVIDER_UNAVAILABLE" })).toBe(false);
      expect(isHintEligibleError({ code: "SECURITY_POLICY_VIOLATION" })).toBe(false);
    });
  });

  describe("attachHintToDiagnostic", () => {
    const context = {
      defaultConfigExists: false,
      hasExplicitConfig: false,
      explicitResolvesToDefault: true,
      commandName: "odw",
    };

    it("attaches hint to eligible diagnostics", () => {
      const diag = {
        severity: "error" as const,
        resourceType: "workflow" as const,
        path: "dir",
        code: "LIST_DIRECTORY_NOT_FOUND",
        message: "Dir missing",
      };
      const result = attachHintToDiagnostic(diag, context);
      expect(result.hint).toBeDefined();
      expect(result.hint?.code).toBe("PROJECT_INIT_MISSING");
    });

    it("does not attach to ineligible diagnostics", () => {
      const diag = {
        severity: "error" as const,
        resourceType: "workflow" as const,
        path: "dir",
        code: "WORKFLOW_METADATA_INVALID",
        message: "invalid",
      };
      const result = attachHintToDiagnostic(diag, context);
      expect(result.hint).toBeUndefined();
    });

    it("preserves pre-existing hints and avoids duplicates", () => {
      const existingHint = {
        code: "PROJECT_INIT_MISSING" as const,
        message: "existing",
        command: "existing cmd",
      };
      const diag = {
        severity: "error" as const,
        resourceType: "workflow" as const,
        path: "dir",
        code: "LIST_DIRECTORY_NOT_FOUND",
        message: "Dir missing",
        hint: existingHint,
      };
      const result = attachHintToDiagnostic(diag, context);
      expect(result.hint).toEqual(existingHint);
    });
  });

  describe("attachHintToError", () => {
    const context = {
      defaultConfigExists: false,
      hasExplicitConfig: false,
      explicitResolvesToDefault: true,
      commandName: "odw",
    };

    it("attaches hint to eligible errors", () => {
      const err = new OpenDynamicWorkflowError("SHARED_AGENT_NOT_FOUND" as any, "Agent not found");
      const result = attachHintToError(err, context) as any;
      expect(result.hint).toBeDefined();
      expect(result.hint?.code).toBe("PROJECT_INIT_MISSING");
    });

    it("preserves pre-existing hints", () => {
      const existingHint = {
        code: "PROJECT_INIT_MISSING" as const,
        message: "existing message",
        command: "existing command",
      };
      const err = new OpenDynamicWorkflowError("SHARED_AGENT_NOT_FOUND" as any, "Agent not found", {
        hint: existingHint,
      });
      const result = attachHintToError(err, context) as any;
      expect(result.hint).toEqual(existingHint);
    });
  });

  describe("serializeError preservation and deduplication", () => {
    it("serializes error with hint", () => {
      const hint = {
        code: "PROJECT_INIT_MISSING" as const,
        message: "init suggestion",
        command: "odw init",
      };
      const err = new OpenDynamicWorkflowError("SHARED_AGENT_NOT_FOUND" as any, "Agent not found", {
        hint,
      });
      const serialized = serializeError(err);
      expect(serialized.hint).toEqual(hint);
    });

    it("deduplicates hints in nested causes", () => {
      const hint = {
        code: "PROJECT_INIT_MISSING" as const,
        message: "init suggestion",
        command: "odw init",
      };
      const inner = new OpenDynamicWorkflowError("SHARED_AGENT_NOT_FOUND" as any, "inner error", {
        hint,
      });
      const outer = new OpenDynamicWorkflowError("WORKFLOW_DISCOVERY_FAILED" as any, "outer error", {
        cause: inner,
        hint,
      });

      const serialized = serializeError(outer);
      expect(serialized.hint).toEqual(hint);
      expect(serialized.cause).toBeDefined();
      expect((serialized.cause as any).hint).toBeUndefined();
    });
  });
});
