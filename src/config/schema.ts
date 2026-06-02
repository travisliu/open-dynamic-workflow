import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";
import type { ExecflowConfig } from "./types.js";

export function validateConfig(config: ExecflowConfig): void {
  if (typeof config !== "object" || config === null) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Configuration must be an object."
    );
  }

  // concurrency validation
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'concurrency' must be a positive integer."
    );
  }

  // timeoutMs validation
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'timeoutMs' must be a positive integer."
    );
  }

  // providers validation
  if (typeof config.providers !== "object" || config.providers === null) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'providers' must be an object."
    );
  }

  for (const [name, provider] of Object.entries(config.providers)) {
    if (typeof provider !== "object" || provider === null) {
      throw new ExecflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' must be an object.`
      );
    }
    if (typeof provider.command !== "string" || provider.command.trim() === "") {
      throw new ExecflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' command must be a non-empty string.`
      );
    }
    if (provider.args !== undefined && !Array.isArray(provider.args)) {
      throw new ExecflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        `Provider '${name}' args must be an array of strings.`
      );
    }
    if (provider.args !== undefined) {
      for (const arg of provider.args) {
        if (typeof arg !== "string") {
          throw new ExecflowError(
            ErrorCode.CONFIG_VALIDATION_ERROR,
            `Provider '${name}' args must contain only strings.`
          );
        }
      }
    }
  }

  // defaultProvider validation
  if (typeof config.defaultProvider !== "string" || !(config.defaultProvider in config.providers)) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value 'defaultProvider' ('${config.defaultProvider}') must be defined in providers.`
    );
  }

  // reporting validation
  if (typeof config.reporting !== "object" || config.reporting === null) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'reporting' must be an object."
    );
  }
  const validModes = ["pretty", "json", "jsonl"];
  if (!validModes.includes(config.reporting.mode)) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      `Config value 'reporting.mode' must be one of: ${validModes.join(", ")}.`
    );
  }

  // security validation
  if (typeof config.security !== "object" || config.security === null) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security' must be an object."
    );
  }
  if (!Array.isArray(config.security.passEnv)) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.passEnv' must be an array of strings."
    );
  }
  for (const env of config.security.passEnv) {
    if (typeof env !== "string") {
      throw new ExecflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'security.passEnv' must contain only strings."
      );
    }
  }
  if (!Array.isArray(config.security.redactEnv)) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.redactEnv' must be an array of strings."
    );
  }
  for (const env of config.security.redactEnv) {
    if (typeof env !== "string") {
      throw new ExecflowError(
        ErrorCode.CONFIG_VALIDATION_ERROR,
        "Config value 'security.redactEnv' must contain only strings."
      );
    }
  }
  if (config.security.allowShell !== false) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.allowShell' must be false in MVP."
    );
  }
  if (config.security.allowWorkflowImports !== false) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'security.allowWorkflowImports' must be false in MVP."
    );
  }
}
