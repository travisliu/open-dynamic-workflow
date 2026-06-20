import { InvalidDslCallError } from "../workflow/errors.js";
import type { NormalizedLoopInput, LoopFailureMode } from "./types.js";

const ALLOWED_TOP_LEVEL_KEYS = ["label", "initialState", "options", "run"];
const ALLOWED_OPTION_KEYS = ["maxRounds", "failureMode", "timeoutMs"];

/**
 * Validates and normalizes loop arguments.
 */
export function validateAndNormalizeLoopArgs<TState>(
  input: unknown,
  maxRoundsCeiling: number
): NormalizedLoopInput<TState> {
  // Reject missing input
  if (input === undefined || input === null) {
    throw new InvalidDslCallError("loop() input must be a plain object.");
  }

  // Reject arrays, functions, and other non-object values
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidDslCallError("loop() input must be a plain object.");
  }

  // Reject unsupported top-level keys
  const inputKeys = Object.keys(input);
  for (const key of inputKeys) {
    if (!ALLOWED_TOP_LEVEL_KEYS.includes(key)) {
      throw new InvalidDslCallError(`loop() input contains unsupported key '${key}'.`);
    }
  }

  // Require label, initialState, options, and run
  const { label, initialState, options, run } = input as any;

  if (label === undefined) {
    throw new InvalidDslCallError("loop() missing required field 'label'.");
  }
  if (initialState === undefined) {
    throw new InvalidDslCallError("loop() missing required field 'initialState'.");
  }
  if (options === undefined) {
    throw new InvalidDslCallError("loop() missing required field 'options'.");
  }
  if (run === undefined) {
    throw new InvalidDslCallError("loop() missing required field 'run'.");
  }

  // Require label to be a non-empty string
  if (typeof label !== "string" || label.trim() === "") {
    throw new InvalidDslCallError("loop() label must be a non-empty string.");
  }

  // Require run to be a function
  if (typeof run !== "function") {
    throw new InvalidDslCallError("loop() run must be a function.");
  }

  // Require options to be a plain object
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new InvalidDslCallError("loop() options must be a plain object.");
  }

  // Reject unsupported options keys
  const optionKeys = Object.keys(options);
  for (const key of optionKeys) {
    if (!ALLOWED_OPTION_KEYS.includes(key)) {
      throw new InvalidDslCallError(`loop() options contain unsupported key '${key}'.`);
    }
  }

  // Require options.maxRounds
  if (options.maxRounds === undefined) {
    throw new InvalidDslCallError("loop() options missing required field 'maxRounds'.");
  }

  // Require maxRounds to be a positive integer and no greater than the configured ceiling
  const maxRounds = options.maxRounds;
  if (typeof maxRounds !== "number" || maxRounds < 1 || !Number.isInteger(maxRounds)) {
    throw new InvalidDslCallError("loop() options maxRounds must be a positive integer.");
  }
  if (maxRounds > maxRoundsCeiling) {
    throw new InvalidDslCallError(
      `loop() options maxRounds (${maxRounds}) exceeds the global ceiling (${maxRoundsCeiling}).`
    );
  }

  // Allow options.failureMode only when it is "throw" or "settled", defaulting to "throw"
  let failureMode: LoopFailureMode = "throw";
  if (options.failureMode !== undefined) {
    if (options.failureMode !== "throw" && options.failureMode !== "settled") {
      throw new InvalidDslCallError("loop() options failureMode must be 'throw' or 'settled'.");
    }
    failureMode = options.failureMode;
  }

  // Allow options.timeoutMs only when it is a positive integer
  if (options.timeoutMs !== undefined) {
    if (typeof options.timeoutMs !== "number" || options.timeoutMs <= 0 || !Number.isInteger(options.timeoutMs)) {
      throw new InvalidDslCallError("loop() options timeoutMs must be a positive integer.");
    }
  }

  return {
    label,
    initialState,
    options: {
      failureMode,
      maxRounds,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    },
    run,
  };
}

/**
 * Validates the round run result.
 */
export function validateLoopRunResult(value: unknown, contextLabel: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidDslCallError(`Loop '${contextLabel}' round returned a non-object value.`);
  }

  const obj = value as Record<string, any>;
  
  if (obj.done === undefined) {
    throw new InvalidDslCallError(`Loop '${contextLabel}' round result is missing required property 'done'.`);
  }
  if (typeof obj.done !== "boolean") {
    throw new InvalidDslCallError(`Loop '${contextLabel}' round result property 'done' must be a boolean.`);
  }
  
  if (obj.nextState === undefined) {
    throw new InvalidDslCallError(`Loop '${contextLabel}' round result is missing required property 'nextState'.`);
  }

  if (obj.result !== undefined) {
    throw new InvalidDslCallError(`Loop '${contextLabel}' round returned deprecated property 'result'.`);
  }
  
  if (obj.break !== undefined || obj.__brand === "loop-break") {
    throw new InvalidDslCallError(`Loop '${contextLabel}' round returned deprecated break signal.`);
  }

  const allowed = new Set(["done", "nextState"]);
  const extraKeys = Object.keys(obj).filter(k => !allowed.has(k));
  if (extraKeys.length > 0) {
    throw new InvalidDslCallError(`Loop '${contextLabel}' round result contains unsupported property '${extraKeys[0]}'.`);
  }
}
