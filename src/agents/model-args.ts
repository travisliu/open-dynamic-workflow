import { ExecflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { ProviderModelArgConfig } from "../types/config.js";

export function appendModelArg(
  args: string[],
  model: string | undefined,
  modelArg: ProviderModelArgConfig | false | undefined,
  defaultFlag: string
): void {
  if (model === undefined) {
    return;
  }

  if (modelArg === false) {
    throw new ExecflowError(
      ErrorCode.MODEL_NOT_SUPPORTED,
      `Model selection is not supported by this provider, but model '${model}' was requested.`
    );
  }

  const flag = modelArg && typeof modelArg === "object" && typeof modelArg.flag === "string"
    ? modelArg.flag
    : defaultFlag;

  args.push(flag, model);
}
