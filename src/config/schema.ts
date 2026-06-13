import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { OpenFlowConfig } from "./types.js";

export function validateConfig(config: OpenFlowConfig): void {
  if (typeof config !== "object" || config === null) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Configuration must be an object."
    );
  }

  // concurrency validation
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'concurrency' must be a positive integer."
    );
  }

  // timeoutMs validation
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'timeoutMs' must be a positive integer."
    );
  }

  // defaultModel validation
  if (config.defaultModel !== undefined && config.defaultModel !== null && typeof config.defaultModel !== "string") {
    throw new OpenFlowError(
      ErrorCode.MODEL_CONFIG_INVALID,
      "Global config value 'defaultModel' must be a string, null, or undefined."
    );
  }

  // providers validation
  if (typeof config.providers !== "object" || config.providers === null) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'providers' must be an object."
    );
  }

  for (const [name, provider] of Object.entries(config.providers)) {
    if (typeof provider !== "object" || provider === null) {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' must be an object.`
      );
    }
    if (typeof provider.command !== "string" || provider.command.trim() === "") {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' command must be a non-empty string.`
      );
    }
    if (provider.args !== undefined && !Array.isArray(provider.args)) {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' args must be an array of strings.`
      );
    }
    if (provider.args !== undefined) {
      for (const arg of provider.args) {
        if (typeof arg !== "string") {
          throw new OpenFlowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider '${name}' args must contain only strings.`
          );
        }
      }
    }
    if (provider.defaultModel !== undefined && provider.defaultModel !== null && typeof provider.defaultModel !== "string") {
      throw new OpenFlowError(
        ErrorCode.MODEL_CONFIG_INVALID,
        `Provider '${name}' defaultModel must be a string, null, or undefined.`
      );
    }
    if (provider.modelArg !== undefined) {
      if (provider.modelArg !== false && (typeof provider.modelArg !== "object" || provider.modelArg === null)) {
        throw new OpenFlowError(
          ErrorCode.MODEL_CONFIG_INVALID,
          `Provider '${name}' modelArg must be false or an object.`
        );
      }
      if (provider.modelArg !== false) {
        if (typeof provider.modelArg.flag !== "string" || provider.modelArg.flag.trim() === "") {
          throw new OpenFlowError(
            ErrorCode.MODEL_CONFIG_INVALID,
            `Provider '${name}' modelArg flag must be a non-empty string.`
          );
        }
      }
    }

    if (provider.promptMode !== undefined && provider.promptMode !== "stdin" && provider.promptMode !== "arg") {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' promptMode must be 'stdin' or 'arg'.`
      );
    }

    const stringFields = [
      "promptFlag",
      "modelFlag",
      "sandboxFlag",
      "dangerouslySkipPermissionsFlag",
      "printTimeoutFlag",
      "agentFlag",
      "formatFlag",
      "format",
      "variantFlag",
      "defaultAgent",
      "defaultVariant",
      "piProvider",
      "providerFlag",
      "thinking",
      "systemPrompt",
      "appendSystemPrompt",
    ];

    for (const field of stringFields) {
      const value = (provider as any)[field];
      if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
        throw new OpenFlowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Provider '${name}' ${field} must be a non-empty string.`
        );
      }
    }

    const booleanFields = [
      "useSandboxByDefault",
      "deterministicEnv",
      "noSession",
      "noContextFiles",
      "noExtensions",
      "noSkills",
      "noPromptTemplates",
      "noThemes",
    ];

    for (const field of booleanFields) {
      const value = (provider as any)[field];
      if (value !== undefined && typeof value !== "boolean") {
        throw new OpenFlowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Provider '${name}' ${field} must be a boolean.`
        );
      }
    }

    if (
      provider.dirFlag !== undefined &&
      provider.dirFlag !== false &&
      (typeof provider.dirFlag !== "string" || provider.dirFlag.trim() === "")
    ) {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' dirFlag must be a non-empty string or false.`
      );
    }

    const toolArrays = ["safeTools", "fullAccessTools"];
    for (const field of toolArrays) {
      const value = (provider as any)[field];
      if (value !== undefined) {
        if (!Array.isArray(value)) {
          throw new OpenFlowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider '${name}' ${field} must be an array of strings.`
          );
        }
        for (const item of value) {
          if (typeof item !== "string" || item.trim() === "") {
            throw new OpenFlowError(
              ErrorCode.CONFIG_VALIDATION_ERROR,
              `Provider '${name}' ${field} must contain only non-empty strings.`
            );
          }
        }
      }
    }

    if (
      provider.executionMode !== undefined &&
      provider.executionMode !== "json" &&
      provider.executionMode !== "print"
    ) {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' executionMode must be 'json' or 'print'.`
      );
    }

    if (
      provider.approvalMode !== undefined &&
      !["approve", "no-approve", "omit"].includes(provider.approvalMode)
    ) {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' approvalMode must be 'approve', 'no-approve', or 'omit'.`
      );
    }

    if (provider.permissionPolicy !== undefined) {
      if (name === "opencode") {
        if (!["read-only", "passthrough"].includes(provider.permissionPolicy)) {
          throw new OpenFlowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider 'opencode' permissionPolicy must be 'read-only' or 'passthrough'.`
          );
        }
      } else if (name === "antigravity") {
        if (!["sandbox", "native"].includes(provider.permissionPolicy)) {
          throw new OpenFlowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider 'antigravity' permissionPolicy must be 'sandbox' or 'native'.`
          );
        }
      } else if (!["read-only", "passthrough", "sandbox", "native"].includes(provider.permissionPolicy)) {
        throw new OpenFlowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Provider '${name}' permissionPolicy must be 'read-only', 'passthrough', 'sandbox', or 'native'.`
        );
      }
    }
  }

  // defaultProvider validation
  if (typeof config.defaultProvider !== "string" || !(config.defaultProvider in config.providers)) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value 'defaultProvider' ('${config.defaultProvider}') must be defined in providers.`
    );
  }

  // reporting validation
  if (typeof config.reporting !== "object" || config.reporting === null) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'reporting' must be an object."
    );
  }
  const validModes = ["pretty", "json", "jsonl"];
  if (!validModes.includes(config.reporting.mode)) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value 'reporting.mode' must be one of: ${validModes.join(", ")}.`
    );
  }

  // security validation
  if (typeof config.security !== "object" || config.security === null) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security' must be an object."
    );
  }
  if (!Array.isArray(config.security.passEnv)) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.passEnv' must be an array of strings."
    );
  }
  for (const env of config.security.passEnv) {
    if (typeof env !== "string") {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'security.passEnv' must contain only strings."
      );
    }
  }
  if (!Array.isArray(config.security.redactEnv)) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.redactEnv' must be an array of strings."
    );
  }
  for (const env of config.security.redactEnv) {
    if (typeof env !== "string") {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'security.redactEnv' must contain only strings."
      );
    }
  }
  if (config.security.allowWorkflowImports !== false) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.allowWorkflowImports' must be false in MVP."
    );
  }

  // sharedAgents validation
  if (typeof config.sharedAgents !== "object" || config.sharedAgents === null) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'sharedAgents' must be an object."
    );
  }
  if (typeof config.sharedAgents.dir !== "string" || config.sharedAgents.dir.trim() === "") {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'sharedAgents.dir' must be a non-empty string."
    );
  }
  if (!Number.isInteger(config.sharedAgents.maxDefinitions) || config.sharedAgents.maxDefinitions < 1) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'sharedAgents.maxDefinitions' must be a positive integer."
    );
  }
  if (config.sharedAgents.allowDynamicIds !== false) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'sharedAgents.allowDynamicIds' must be false in MVP."
    );
  }
  if (typeof config.sharedAgents.strictPromptTemplateVariables !== "boolean") {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'sharedAgents.strictPromptTemplateVariables' must be a boolean."
    );
  }

  // tools validation
  if (config.tools !== undefined) {
    if (typeof config.tools !== "object" || config.tools === null) {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'tools' must be an object."
      );
    }

    const validToolsKeys = ["dir", "concurrency", "maxDefinitions"];
    for (const key of Object.keys(config.tools)) {
      if (!validToolsKeys.includes(key)) {
        throw new OpenFlowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Config value 'tools.${key}' is not a supported key.`
        );
      }
    }

    if (typeof config.tools.dir !== "string" || config.tools.dir.trim() === "") {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'tools.dir' must be a non-empty string."
      );
    }
    if (!Number.isInteger(config.tools.concurrency) || config.tools.concurrency < 1) {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'tools.concurrency' must be a positive integer."
      );
    }
    if (!Number.isInteger(config.tools.maxDefinitions) || config.tools.maxDefinitions < 1) {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'tools.maxDefinitions' must be a positive integer."
      );
    }
  }

  // workflow validation
  if (typeof config.workflow !== "object" || config.workflow === null) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'workflow' must be an object."
    );
  }
  if (typeof config.workflow.discovery !== "object" || config.workflow.discovery === null) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'workflow.discovery' must be an object."
    );
  }
  if (!Array.isArray(config.workflow.discovery.include)) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'workflow.discovery.include' must be an array of strings."
    );
  }
  for (const glob of config.workflow.discovery.include) {
    if (typeof glob !== "string" || glob.trim() === "") {
      throw new OpenFlowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'workflow.discovery.include' must contain only non-empty strings."
      );
    }
  }
  if (!Number.isInteger(config.workflow.maxDepth) || config.workflow.maxDepth < 1) {
    throw new OpenFlowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'workflow.maxDepth' must be a positive integer."
    );
  }
}
