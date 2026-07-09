import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { OpenDynamicWorkflowConfig, ProfileName, WorkflowProfile, WorkflowProfileCatalog, ResolvedWorkflowProfile } from "./types.js";
import { isThinkingEffort, THINKING_EFFORT_VALUES } from "../types/index.js";

const RETRY_PUBLIC_BANNED_FIELDS = ["retryOn", "retryReasons", "retryOnErrors", "errorCategories"] as const;
const RESOLVED_RETRY_FIELDS = ["enabled", "policy", "source", "disabledBy"] as const;

function validateRetryPolicyFields(policy: unknown, pathPrefix: "retry" | "retry.policy"): void {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value '${pathPrefix}' must be an object.`
    );
  }

  const retryObj = policy as Record<string, unknown>;

  const maxAttempts = retryObj.maxAttempts;
  if (maxAttempts !== undefined) {
    if (typeof maxAttempts !== "number" || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Config value '${pathPrefix}.maxAttempts' must be a positive integer.`
      );
    }
  }

  const delayMs = retryObj.delayMs;
  if (delayMs !== undefined) {
    if (typeof delayMs !== "number" || !Number.isInteger(delayMs) || delayMs < 0) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Config value '${pathPrefix}.delayMs' must be a non-negative integer.`
      );
    }
  }

  const maxDelayMs = retryObj.maxDelayMs;
  if (maxDelayMs !== undefined) {
    if (typeof maxDelayMs !== "number" || !Number.isInteger(maxDelayMs) || maxDelayMs < 0) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Config value '${pathPrefix}.maxDelayMs' must be a non-negative integer.`
      );
    }
  }

  if (retryObj.backoff !== undefined) {
    if (retryObj.backoff !== "fixed" && retryObj.backoff !== "exponential") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Config value '${pathPrefix}.backoff' must be 'fixed' or 'exponential'.`
      );
    }
  }

  if (retryObj.jitter !== undefined && typeof retryObj.jitter !== "boolean") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value '${pathPrefix}.jitter' must be a boolean.`
    );
  }

  if (retryObj.disableDelay !== undefined && typeof retryObj.disableDelay !== "boolean") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value '${pathPrefix}.disableDelay' must be a boolean.`
    );
  }
}

export function validateRetryConfigInput(retry: unknown): void {
  if (retry === undefined) {
    return;
  }

  if (retry === false) {
    return;
  }

  if (typeof retry !== "object" || retry === null || Array.isArray(retry)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'retry' must be an object."
    );
  }

  const retryObj = retry as Record<string, unknown>;

  for (const field of RETRY_PUBLIC_BANNED_FIELDS) {
    if (field in retryObj) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `${field} is not supported in experimental retry v1. Retry eligibility is runtime-defined; configure maxAttempts and delay behavior only.`
      );
    }
  }

  for (const field of RESOLVED_RETRY_FIELDS) {
    if (field in retryObj) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'retry' must be an object."
      );
    }
  }

  validateRetryPolicyFields(retryObj, "retry");
}

function validateResolvedRetryConfig(retry: unknown): void {
  if (typeof retry !== "object" || retry === null || Array.isArray(retry)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'retry' must be an object."
    );
  }

  const retryObj = retry as Record<string, unknown>;

  if (retryObj.policy === undefined) {
    validateRetryConfigInput(retryObj);
    return;
  }

  validateRetryPolicyFields(retryObj.policy, "retry.policy");
}


export function validateConfig(config: OpenDynamicWorkflowConfig): void {
  if (typeof config !== "object" || config === null) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Configuration must be an object."
    );
  }

  // concurrency validation
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'concurrency' must be a positive integer."
    );
  }

  // timeoutMs validation
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'timeoutMs' must be a positive integer."
    );
  }

  if (config.maxAgentCalls !== undefined && (!Number.isInteger(config.maxAgentCalls) || config.maxAgentCalls < 1)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'maxAgentCalls' must be a positive integer."
    );
  }

  // defaultModel validation
  if (config.defaultModel !== undefined && config.defaultModel !== null && typeof config.defaultModel !== "string") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.MODEL_CONFIG_INVALID,
      "Global config value 'defaultModel' must be a string, null, or undefined."
    );
  }

  // retry validation
  if (config.retry !== undefined) {
    if (config.retry === false) {
      // Explicit disabled-retry marker from CLI overrides.
    } else if (typeof config.retry !== "object" || config.retry === null || Array.isArray(config.retry)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'retry' must be an object."
      );
    } else {
      if ("policy" in config.retry) {
        validateResolvedRetryConfig(config.retry);
      } else {
        validateRetryConfigInput(config.retry);
      }
    }
  }

  // providers validation
  if (typeof config.providers !== "object" || config.providers === null) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'providers' must be an object."
    );
  }

  for (const [name, provider] of Object.entries(config.providers)) {
    if (typeof provider !== "object" || provider === null) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' must be an object.`
      );
    }
    if (typeof provider.command !== "string" || provider.command.trim() === "") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' command must be a non-empty string.`
      );
    }
    if (provider.args !== undefined && !Array.isArray(provider.args)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' args must be an array of strings.`
      );
    }
    if (provider.args !== undefined) {
      for (const arg of provider.args) {
        if (typeof arg !== "string") {
          throw new OpenDynamicWorkflowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider '${name}' args must contain only strings.`
          );
        }
      }
    }
    if (provider.defaultModel !== undefined && provider.defaultModel !== null && typeof provider.defaultModel !== "string") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.MODEL_CONFIG_INVALID,
        `Provider '${name}' defaultModel must be a string, null, or undefined.`
      );
    }
    if (provider.modelArg !== undefined) {
      if (provider.modelArg !== false && (typeof provider.modelArg !== "object" || provider.modelArg === null)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.MODEL_CONFIG_INVALID,
          `Provider '${name}' modelArg must be false or an object.`
        );
      }
      if (provider.modelArg !== false) {
        if (typeof provider.modelArg.flag !== "string" || provider.modelArg.flag.trim() === "") {
          throw new OpenDynamicWorkflowError(
            ErrorCode.MODEL_CONFIG_INVALID,
            `Provider '${name}' modelArg flag must be a non-empty string.`
          );
        }
      }
    }

    if (provider.promptMode !== undefined && provider.promptMode !== "stdin" && provider.promptMode !== "arg") {
      throw new OpenDynamicWorkflowError(
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
        throw new OpenDynamicWorkflowError(
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
        throw new OpenDynamicWorkflowError(
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
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' dirFlag must be a non-empty string or false.`
      );
    }

    const toolArrays = ["safeTools", "fullAccessTools"];
    for (const field of toolArrays) {
      const value = (provider as any)[field];
      if (value !== undefined) {
        if (!Array.isArray(value)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider '${name}' ${field} must be an array of strings.`
          );
        }
        for (const item of value) {
          if (typeof item !== "string" || item.trim() === "") {
            throw new OpenDynamicWorkflowError(
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
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' executionMode must be 'json' or 'print'.`
      );
    }

    if (
      provider.approvalMode !== undefined &&
      !["approve", "no-approve", "omit"].includes(provider.approvalMode)
    ) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' approvalMode must be 'approve', 'no-approve', or 'omit'.`
      );
    }

    if (provider.permissionPolicy !== undefined) {
      if (name === "opencode") {
        if (!["read-only", "passthrough"].includes(provider.permissionPolicy)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider 'opencode' permissionPolicy must be 'read-only' or 'passthrough'.`
          );
        }
      } else if (name === "antigravity") {
        if (!["sandbox", "native"].includes(provider.permissionPolicy)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider 'antigravity' permissionPolicy must be 'sandbox' or 'native'.`
          );
        }
      } else if (name === "copilot") {
        if (!["restricted", "passthrough"].includes(provider.permissionPolicy)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider 'copilot' permissionPolicy must be 'restricted' or 'passthrough'.`
          );
        }
      } else if (!["read-only", "passthrough", "sandbox", "native", "restricted"].includes(provider.permissionPolicy)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Provider '${name}' permissionPolicy must be 'read-only', 'passthrough', 'sandbox', 'native', or 'restricted'.`
        );
      }
    }

    if (provider.defaultThinkingEffort !== undefined) {
      if (!isThinkingEffort(provider.defaultThinkingEffort)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Provider '${name}' defaultThinkingEffort must be one of: ${THINKING_EFFORT_VALUES.join(", ")}.`
        );
      }
    }
  }


  // defaultProvider validation
  if (typeof config.defaultProvider !== "string" || !(config.defaultProvider in config.providers)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value 'defaultProvider' ('${config.defaultProvider}') must be defined in providers.`
    );
  }

  // reporting validation
  if (typeof config.reporting !== "object" || config.reporting === null) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'reporting' must be an object."
    );
  }
  const validModes = ["pretty", "json", "jsonl"];
  if (!validModes.includes(config.reporting.mode)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value 'reporting.mode' must be one of: ${validModes.join(", ")}.`
    );
  }

  // security validation
  if (typeof config.security !== "object" || config.security === null) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security' must be an object."
    );
  }
  if (!Array.isArray(config.security.passEnv)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.passEnv' must be an array of strings."
    );
  }
  for (const env of config.security.passEnv) {
    if (typeof env !== "string") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'security.passEnv' must contain only strings."
      );
    }
  }
  if (!Array.isArray(config.security.redactEnv)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.redactEnv' must be an array of strings."
    );
  }
  for (const env of config.security.redactEnv) {
    if (typeof env !== "string") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'security.redactEnv' must contain only strings."
      );
    }
  }
  if (config.security.allowWorkflowImports !== false) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.allowWorkflowImports' must be false in MVP."
    );
  }

  // sharedAgents validation
  if (typeof config.sharedAgents !== "object" || config.sharedAgents === null) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'sharedAgents' must be an object."
    );
  }

  const validSharedAgentsKeys = [
    "dir",
    "include",
    "exclude",
    "allowDynamicIds",
    "maxDefinitions",
    "strictPromptTemplateVariables"
  ];
  for (const key of Object.keys(config.sharedAgents)) {
    if (!validSharedAgentsKeys.includes(key)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Config value 'sharedAgents.${key}' is not a supported key.`
      );
    }
  }
  // Discovery path fields are validated by src/config/path-discovery.ts so
  // loadConfig() can return structured diagnostics instead of schema hard-fails.
  if (config.sharedAgents.maxDefinitions !== undefined) {
    if (!Number.isInteger(config.sharedAgents.maxDefinitions) || config.sharedAgents.maxDefinitions < 1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'sharedAgents.maxDefinitions' must be a positive integer."
      );
    }
  }
  if (config.sharedAgents.allowDynamicIds !== undefined && config.sharedAgents.allowDynamicIds !== false) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'sharedAgents.allowDynamicIds' must be false in MVP."
    );
  }
  if (config.sharedAgents.strictPromptTemplateVariables !== undefined && typeof config.sharedAgents.strictPromptTemplateVariables !== "boolean") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'sharedAgents.strictPromptTemplateVariables' must be a boolean."
    );
  }

  // tools validation
  if (config.tools !== undefined) {
    if (typeof config.tools !== "object" || config.tools === null) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'tools' must be an object."
      );
    }

    const validToolsKeys = ["dir", "concurrency", "maxDefinitions", "include", "exclude"];
    for (const key of Object.keys(config.tools)) {
      if (!validToolsKeys.includes(key)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          `Config value 'tools.${key}' is not a supported key.`
        );
      }
    }

    if (config.tools.concurrency !== undefined) {
      if (!Number.isInteger(config.tools.concurrency) || config.tools.concurrency < 1) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          "Config value 'tools.concurrency' must be a positive integer."
        );
      }
    }
    if (config.tools.maxDefinitions !== undefined) {
      if (!Number.isInteger(config.tools.maxDefinitions) || config.tools.maxDefinitions < 1) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONFIG_VALIDATION_ERROR,
          "Config value 'tools.maxDefinitions' must be a positive integer."
        );
      }
    }
  }

  // workflow validation
  if (typeof config.workflow !== "object" || config.workflow === null) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'workflow' must be an object."
    );
  }

  const validWorkflowKeys = [
    "discovery",
    "include",
    "exclude",
    "maxDepth",
    "maxLoopRounds"
  ];
  for (const key of Object.keys(config.workflow)) {
    if (!validWorkflowKeys.includes(key)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Config value 'workflow.${key}' is not a supported key.`
      );
    }
  }
  // Discovery path fields are validated by src/config/path-discovery.ts so
  // loadConfig() can return structured diagnostics instead of schema hard-fails.
  if (config.workflow.maxDepth !== undefined) {
    if (!Number.isInteger(config.workflow.maxDepth) || config.workflow.maxDepth < 1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'workflow.maxDepth' must be a positive integer."
      );
    }
  }
  if (config.workflow.maxLoopRounds !== undefined) {
    if (!Number.isInteger(config.workflow.maxLoopRounds) || config.workflow.maxLoopRounds < 1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'workflow.maxLoopRounds' must be a positive integer."
      );
    }
  }

  if (config.profiles !== undefined) {
    validateProfileCatalog(config.profiles, "profiles");
  }
}

export function validateProfileName(name: unknown, path: string): asserts name is ProfileName {
  if (typeof name !== "string") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile name at '${path}' must be a string.`
    );
  }
  if (name.length === 0) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile name at '${path}' must be a non-empty string.`
    );
  }
  if (name.trim() !== name) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile name '${name}' at '${path}' must not have leading or trailing whitespace.`
    );
  }
  if (/[\x00-\x1F\x7F-\x9F]/.test(name)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile name '${name}' at '${path}' contains invalid control characters.`
    );
  }
  if (name === "." || name === "..") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile name '${name}' at '${path}' is reserved.`
    );
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile name '${name}' at '${path}' contains invalid characters '/' or '\\'.`
    );
  }
  if (name === "__proto__" || name === "prototype" || name === "constructor") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile name '${name}' at '${path}' is reserved.`
    );
  }
}

export function validateObjectOwnPropertiesOnly(
  obj: unknown,
  path: string,
  errorOnInvalidType?: string
): asserts obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      errorOnInvalidType ?? `Value at '${path}' must be an object.`
    );
  }

  // 1. Reject symbols
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Value at '${path}' must not contain symbol keys.`
    );
  }

  // 2. Reject inherited properties (both enumerable and non-enumerable / accessors)
  let inheritedKey: string | null = null;
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      inheritedKey = key;
      break;
    }
  }
  if (inheritedKey !== null) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Value at '${path}' contains inherited enumerable property '${inheritedKey}'.`
    );
  }

  let proto = Object.getPrototypeOf(obj);
  if (proto !== null && proto !== Object.prototype) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `${path}.__proto__ is an unsafe object key.`
    );
  }

  // 3. Inspect own property descriptors
  const ownKeys = Object.getOwnPropertyNames(obj);
  for (const key of ownKeys) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `${path}.${key} is an unsafe object key.`
      );
    }

    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `${path}.${key} descriptor is missing.`
      );
    }

    if (!desc.enumerable) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `${path}.${key} is a non-enumerable key, which is not allowed.`
      );
    }

    if (desc.get !== undefined || desc.set !== undefined) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `${path}.${key} is an accessor (getter/setter), which is not allowed.`
      );
    }
  }
}

function validateJsonSafeArray(val: unknown[], path: string, ancestors: Set<unknown>): void {
  if (ancestors.has(val)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Cyclic reference detected at ${path}`
    );
  }
  ancestors.add(val);
  try {
    const proto = Object.getPrototypeOf(val);
    if (proto !== Array.prototype) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Array at '${path}' has an invalid prototype.`
      );
    }

    if (Object.getOwnPropertySymbols(val).length > 0) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Array at '${path}' must not contain symbol keys.`
      );
    }

    for (const key in val) {
      if (!Object.prototype.hasOwnProperty.call(val, key)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.PROFILE_VALIDATION_ERROR,
          `Array at '${path}' contains inherited enumerable property '${key}'.`
        );
      }
    }

    const lenDesc = Object.getOwnPropertyDescriptor(val, "length");
    if (!lenDesc) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Array at '${path}' is missing the length descriptor.`
      );
    }
    if (lenDesc.get !== undefined || lenDesc.set !== undefined) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Array at '${path}' has length accessor.`
      );
    }

    const len = val.length;
    if (typeof len !== "number" || !Number.isInteger(len) || len < 0) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Array at '${path}' has invalid length.`
      );
    }

    for (let i = 0; i < len; i++) {
      const key = String(i);
      if (!Object.prototype.hasOwnProperty.call(val, key)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.PROFILE_VALIDATION_ERROR,
          `Array at '${path}' contains a hole at index ${i}.`
        );
      }

      const desc = Object.getOwnPropertyDescriptor(val, key);
      if (!desc) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.PROFILE_VALIDATION_ERROR,
          `Array at '${path}' index ${i} descriptor is missing.`
        );
      }

      if (!desc.enumerable) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.PROFILE_VALIDATION_ERROR,
          `Array at '${path}' index ${i} is non-enumerable.`
        );
      }

      if (desc.get !== undefined || desc.set !== undefined) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.PROFILE_VALIDATION_ERROR,
          `Array at '${path}' index ${i} is an accessor (getter/setter).`
        );
      }

      validateJsonSafeValue(desc.value, `${path}[${i}]`, ancestors);
    }

    const ownNames = Object.getOwnPropertyNames(val);
    if (ownNames.length !== len + 1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Array at '${path}' contains unexpected own properties.`
      );
    }
  } finally {
    ancestors.delete(val);
  }
}

function validateJsonSafeValue(val: unknown, path: string, ancestors: Set<unknown> = new Set()): void {
  if (val === undefined) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Value at '${path}' cannot be undefined.`
    );
  }
  if (typeof val === "function") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Value at '${path}' cannot be a function.`
    );
  }
  if (typeof val === "symbol") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Value at '${path}' cannot be a symbol.`
    );
  }
  if (typeof val === "bigint") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Value at '${path}' cannot be a bigint.`
    );
  }
  if (typeof val === "number") {
    if (!Number.isFinite(val)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Value at '${path}' must be a finite number.`
      );
    }
    return;
  }
  if (typeof val === "string" || typeof val === "boolean" || val === null) {
    return;
  }
  if (Array.isArray(val)) {
    validateJsonSafeArray(val, path, ancestors);
    return;
  }
  if (typeof val === "object") {
    validateJsonSafeObject(val, path, ancestors);
    return;
  }
  throw new OpenDynamicWorkflowError(
    ErrorCode.PROFILE_VALIDATION_ERROR,
    `Value at '${path}' is of an invalid type.`
  );
}

function validateJsonSafeObject(obj: unknown, path: string, ancestors: Set<unknown> = new Set()): void {
  if (ancestors.has(obj)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Cyclic reference detected at ${path}`
    );
  }
  ancestors.add(obj);

  try {
    validateObjectOwnPropertiesOnly(obj, path, `Value at '${path}' must be a JSON-safe object.`);

    const ownKeys = Object.getOwnPropertyNames(obj);
    for (const key of ownKeys) {
      const desc = Object.getOwnPropertyDescriptor(obj, key);
      if (desc) {
        validateJsonSafeValue(desc.value, `${path}.${key}`, ancestors);
      }
    }
  } finally {
    ancestors.delete(obj);
  }
}

function validateRetryPolicyObject(policyObj: unknown, path: string): void {
  if (typeof policyObj !== "object" || policyObj === null || Array.isArray(policyObj)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Config value '${path}' must be an object.`
    );
  }

  validateObjectOwnPropertiesOnly(policyObj, path, `Config value '${path}' must be an object.`);

  const ALLOWED_POLICY_KEYS = ["maxAttempts", "delayMs", "maxDelayMs", "backoff", "jitter", "disableDelay"];
  const policyKeys = Object.getOwnPropertyNames(policyObj);
  for (const key of policyKeys) {
    if (!ALLOWED_POLICY_KEYS.includes(key)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Config value '${path}' must be an object.`
      );
    }
  }
}

function validateWorkflowProfileRunOptions(run: unknown, path: string): void {
  validateObjectOwnPropertiesOnly(run, path, `Profile run options at '${path}' must be an object.`);

  const allowedRunKeys = [
    "provider",
    "model",
    "concurrency",
    "timeoutMs",
    "maxAgentCalls",
    "failFast",
    "report",
    "thinkingEffort",
    "retry"
  ];

  const ownKeys = Object.getOwnPropertyNames(run);
  for (const key of ownKeys) {
    if (!allowedRunKeys.includes(key)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `${path}.${key} is not allowed. Profiles may configure only provider, model, concurrency, timeoutMs, maxAgentCalls, failFast, report, thinkingEffort, and retry.`
      );
    }
  }

  const getSafeVal = (obj: any, key: string) => {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    return desc ? desc.value : undefined;
  };

  const provider = getSafeVal(run, "provider");
  if (provider !== undefined && (typeof provider !== "string" || provider.trim() === "")) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile run option '${path}.provider' must be a non-empty string.`
    );
  }

  const model = getSafeVal(run, "model");
  if (model !== undefined && (typeof model !== "string" || model.trim() === "")) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile run option '${path}.model' must be a non-empty string.`
    );
  }

  const concurrency = getSafeVal(run, "concurrency");
  if (concurrency !== undefined) {
    if (typeof concurrency !== "number" || !Number.isInteger(concurrency) || concurrency < 1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Profile run option '${path}.concurrency' must be a positive integer.`
      );
    }
  }

  const timeoutMs = getSafeVal(run, "timeoutMs");
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Profile run option '${path}.timeoutMs' must be a positive integer.`
      );
    }
  }

  const maxAgentCalls = getSafeVal(run, "maxAgentCalls");
  if (maxAgentCalls !== undefined) {
    if (typeof maxAgentCalls !== "number" || !Number.isInteger(maxAgentCalls) || maxAgentCalls < 1) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Profile run option '${path}.maxAgentCalls' must be a positive integer.`
      );
    }
  }

  const failFast = getSafeVal(run, "failFast");
  if (failFast !== undefined && typeof failFast !== "boolean") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile run option '${path}.failFast' must be a boolean.`
    );
  }

  const report = getSafeVal(run, "report");
  if (report !== undefined && !["pretty", "json", "jsonl"].includes(report as string)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile run option '${path}.report' must be one of: pretty, json, jsonl.`
    );
  }

  const thinkingEffort = getSafeVal(run, "thinkingEffort");
  if (thinkingEffort !== undefined && !isThinkingEffort(thinkingEffort)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile run option '${path}.thinkingEffort' must be one of: ${THINKING_EFFORT_VALUES.join(", ")}.`
    );
  }

  const retry = getSafeVal(run, "retry");
  if (retry !== undefined) {
    if (retry === false) {
      // Allowed
    } else if (typeof retry !== "object" || retry === null || Array.isArray(retry)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Config value '${path}.retry' must be an object.`
      );
    } else {
      const allowedRetryKeys = ["policy", "maxAttempts", "delayMs", "maxDelayMs", "backoff", "jitter", "disableDelay", "enabled", "source", "disabledBy"];
      validateObjectOwnPropertiesOnly(retry, `${path}.retry`, `Config value '${path}.retry' must be an object.`);

      const ownKeys = Object.getOwnPropertyNames(retry);
      for (const key of ownKeys) {
        if (!allowedRetryKeys.includes(key)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.PROFILE_VALIDATION_ERROR,
            `Config value '${path}.retry' must be an object.`
          );
        }
      }

      try {
        const hasPolicy = Object.prototype.hasOwnProperty.call(retry, "policy");
        if (hasPolicy) {
          const policyDesc = Object.getOwnPropertyDescriptor(retry, "policy");
          const policyObj = policyDesc ? policyDesc.value : undefined;
          if (policyObj !== undefined) {
            validateRetryPolicyObject(policyObj, `${path}.retry.policy`);
          }
        } else {
          validateRetryPolicyObject(retry, `${path}.retry`);
        }

        if ("policy" in (retry as any)) {
          validateResolvedRetryConfig(retry);
        } else {
          validateRetryConfigInput(retry);
        }
      } catch (err: any) {
        if (err instanceof OpenDynamicWorkflowError) {
          if (err.code === ErrorCode.PROFILE_VALIDATION_ERROR) {
            throw err;
          }
          const message = err.message.replace("Config value 'retry", `Config value '${path}.retry`);
          throw new OpenDynamicWorkflowError(ErrorCode.PROFILE_VALIDATION_ERROR, message);
        }
        throw err;
      }
    }
  }
}

export function validateWorkflowProfile(value: unknown, path: string): asserts value is WorkflowProfile {
  validateObjectOwnPropertiesOnly(value, path, `Profile at '${path}' must be an object.`);

  const allowedKeys = ["description", "extends", "args", "context", "run"];
  const ownKeys = Object.getOwnPropertyNames(value);
  for (const key of ownKeys) {
    if (!allowedKeys.includes(key)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `${path}.${key} is not allowed. Profiles may configure only description, extends, args, context, and run.`
      );
    }
  }

  const getSafeVal = (obj: any, key: string) => {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    return desc ? desc.value : undefined;
  };

  const description = getSafeVal(value, "description");
  if (description !== undefined && typeof description !== "string") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Profile '${path}.description' must be a string.`
    );
  }

  const ext = getSafeVal(value, "extends");
  if (ext !== undefined) {
    if (Array.isArray(ext)) {
      if (ext.length === 0) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.PROFILE_VALIDATION_ERROR,
          `Profile '${path}.extends' must be a non-empty array of valid profile names.`
        );
      }
      ext.forEach((item, idx) => {
        validateProfileName(item, `${path}.extends[${idx}]`);
      });
    } else {
      validateProfileName(ext, `${path}.extends`);
    }
  }

  const args = getSafeVal(value, "args");
  if (args !== undefined) {
    validateJsonSafeObject(args, `${path}.args`);
  }

  const context = getSafeVal(value, "context");
  if (context !== undefined) {
    validateJsonSafeObject(context, `${path}.context`);
    if (Object.prototype.hasOwnProperty.call(context, "$profile")) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `${path}.context.$profile is reserved.`
      );
    }
  }

  const run = getSafeVal(value, "run");
  if (run !== undefined) {
    validateWorkflowProfileRunOptions(run, `${path}.run`);
  }
}

export function validateProfileCatalog(value: unknown, path?: string): asserts value is WorkflowProfileCatalog {
  const p = path ?? "profiles";
  validateObjectOwnPropertiesOnly(value, p, `Profile catalog at '${p}' must be a non-null object.`);

  const ownKeys = Object.getOwnPropertyNames(value);
  for (const name of ownKeys) {
    validateProfileName(name, `${p}.${name}`);
    const desc = Object.getOwnPropertyDescriptor(value, name);
    if (desc) {
      validateWorkflowProfile(desc.value, `${p}.${name}`);
    }
  }
}

export function validateResolvedWorkflowProfile(value: unknown, path: string): asserts value is ResolvedWorkflowProfile {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (Object.prototype.hasOwnProperty.call(value, "extends") || "extends" in value) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `Resolved profile at '${path}' must not contain 'extends'.`
      );
    }
  }

  validateObjectOwnPropertiesOnly(value, path, `Resolved profile at '${path}' must be an object.`);

  const allowedKeys = ["description", "args", "context", "run"];
  const ownKeys = Object.getOwnPropertyNames(value);
  for (const key of ownKeys) {
    if (!allowedKeys.includes(key)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.PROFILE_VALIDATION_ERROR,
        `${path}.${key} is not allowed in resolved profile. Only description, args, context, and run are allowed.`
      );
    }
  }

  const getSafeVal = (obj: any, key: string) => {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    return desc ? desc.value : undefined;
  };

  const description = getSafeVal(value, "description");
  if (description !== undefined && typeof description !== "string") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `Resolved profile '${path}.description' must be a string.`
    );
  }

  const args = getSafeVal(value, "args");
  if (args === undefined) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `${path}.args is missing`
    );
  }
  validateJsonSafeObject(args, `${path}.args`);

  const context = getSafeVal(value, "context");
  if (context === undefined) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `${path}.context is missing`
    );
  }
  validateJsonSafeObject(context, `${path}.context`);
  if (Object.prototype.hasOwnProperty.call(context, "$profile")) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `${path}.context.$profile is reserved.`
    );
  }

  const run = getSafeVal(value, "run");
  if (run === undefined) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROFILE_VALIDATION_ERROR,
      `${path}.run is missing`
    );
  }
  validateWorkflowProfileRunOptions(run, `${path}.run`);
}
