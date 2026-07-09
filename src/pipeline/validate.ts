import { InvalidDslCallError } from "../workflow/errors.js";
import { assertValidPipelineStageName } from "./id.js";
import type { PipelineStage, PipelineOptions, NormalizedPipelineOptions } from "./types.js";

export const DEFAULT_PIPELINE_OPTIONS = {
  strategy: "item-streaming",
  preserveOrder: true,
  failFast: false
} as const;

const ALLOWED_OPTION_KEYS = [
  "label",
  "strategy",
  "concurrency",
  "stageConcurrency",
  "preserveOrder",
  "failFast"
];

export function validateAndNormalizePipelineArgs(
  items: unknown,
  stages: unknown,
  options?: unknown
): {
  normalizedItems: unknown[];
  normalizedStages: PipelineStage[];
  normalizedOptions: NormalizedPipelineOptions;
} {
  // 1. Validate items
  if (!Array.isArray(items)) {
    throw new InvalidDslCallError("pipeline() items must be an array.");
  }

  // 2. Validate stages
  if (!Array.isArray(stages)) {
    throw new InvalidDslCallError("pipeline() stages must be an array.");
  }
  if (stages.length === 0) {
    throw new InvalidDslCallError("pipeline() stages cannot be empty.");
  }

  const normalizedStages: PipelineStage[] = [];
  const stageNames = new Set<string>();

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (!stage || typeof stage !== "object") {
      throw new InvalidDslCallError(`pipeline() stage at index ${i} must be an object.`);
    }

    const { name, run, concurrency, timeoutMs } = stage as any;

    if (name === undefined) {
      throw new InvalidDslCallError(`pipeline() stage at index ${i} is missing 'name'.`);
    }
    assertValidPipelineStageName(name);

    if (stageNames.has(name)) {
      throw new InvalidDslCallError(`pipeline() duplicate stage name detected: '${name}'.`);
    }
    stageNames.add(name);

    if (run === undefined) {
      throw new InvalidDslCallError(`pipeline() stage '${name}' is missing 'run' function.`);
    }
    if (typeof run !== "function") {
      throw new InvalidDslCallError(`pipeline() stage '${name}' 'run' must be a function.`);
    }

    if (concurrency !== undefined) {
      if (typeof concurrency !== "number" || concurrency <= 0 || !Number.isInteger(concurrency)) {
        throw new InvalidDslCallError(`pipeline() stage '${name}' concurrency must be a positive integer.`);
      }
    }

    if (timeoutMs !== undefined) {
      if (typeof timeoutMs !== "number" || timeoutMs <= 0 || isNaN(timeoutMs)) {
        throw new InvalidDslCallError(`pipeline() stage '${name}' timeoutMs must be a positive number.`);
      }
    }

    normalizedStages.push({
      name,
      run,
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
    });
  }

  // 3. Validate options
  const normalizedOptions: NormalizedPipelineOptions = {
    strategy: DEFAULT_PIPELINE_OPTIONS.strategy,
    preserveOrder: DEFAULT_PIPELINE_OPTIONS.preserveOrder,
    failFast: DEFAULT_PIPELINE_OPTIONS.failFast,
    stageConcurrency: {}
  };

  if (options !== undefined) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new InvalidDslCallError("pipeline() options must be an object.");
    }

    // Check unsupported keys
    const optionKeys = Object.keys(options);
    for (const key of optionKeys) {
      if (!ALLOWED_OPTION_KEYS.includes(key)) {
        throw new InvalidDslCallError(`pipeline() options contain unsupported key '${key}'.`);
      }
    }

    const opts = options as PipelineOptions;

    if (opts.label !== undefined) {
      if (typeof opts.label !== "string" || opts.label.trim() === "") {
        throw new InvalidDslCallError("pipeline() options label must be a non-empty string.");
      }
      normalizedOptions.label = opts.label;
    }

    if (opts.strategy !== undefined) {
      if (opts.strategy !== "item-streaming" && opts.strategy !== "stage-barrier") {
        throw new InvalidDslCallError(
          `pipeline() options strategy must be 'item-streaming' or 'stage-barrier'.`
        );
      }
      normalizedOptions.strategy = opts.strategy;
    }

    if (opts.concurrency !== undefined) {
      if (typeof opts.concurrency !== "number" || opts.concurrency <= 0 || !Number.isInteger(opts.concurrency)) {
        throw new InvalidDslCallError("pipeline() options concurrency must be a positive integer.");
      }
      normalizedOptions.concurrency = opts.concurrency;
    }

    if (opts.preserveOrder !== undefined) {
      if (typeof opts.preserveOrder !== "boolean") {
        throw new InvalidDslCallError("pipeline() options preserveOrder must be a boolean.");
      }
      normalizedOptions.preserveOrder = opts.preserveOrder;
    }

    if (opts.failFast !== undefined) {
      if (typeof opts.failFast !== "boolean") {
        throw new InvalidDslCallError("pipeline() options failFast must be a boolean.");
      }
      normalizedOptions.failFast = opts.failFast;
    }

    if (opts.stageConcurrency !== undefined) {
      if (!opts.stageConcurrency || typeof opts.stageConcurrency !== "object" || Array.isArray(opts.stageConcurrency)) {
        throw new InvalidDslCallError("pipeline() options stageConcurrency must be an object.");
      }
      const stageConcurrencyKeys = Object.keys(opts.stageConcurrency);
      for (const stageName of stageConcurrencyKeys) {
        if (!stageNames.has(stageName)) {
          throw new InvalidDslCallError(
            `pipeline() options stageConcurrency contains unknown stage name '${stageName}'.`
          );
        }
        const val = opts.stageConcurrency[stageName];
        if (typeof val !== "number" || val <= 0 || !Number.isInteger(val)) {
          throw new InvalidDslCallError(
            `pipeline() options stageConcurrency for stage '${stageName}' must be a positive integer.`
          );
        }
        normalizedOptions.stageConcurrency[stageName] = val;
      }
    }

  }

  return {
    normalizedItems: items,
    normalizedStages,
    normalizedOptions
  };
}
