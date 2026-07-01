import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";

export type PromptMode = "stdin" | "arg";

export type PromptTransportStyle = "flag-value" | "positional";

export const DEFAULT_MAX_ARG_PROMPT_BYTES = 64 * 1024;

export interface BuildPromptTransportInput {
  provider: string;
  prompt: string;
  promptMode: PromptMode;
  promptFlag?: string;
  args: string[];
  style: PromptTransportStyle;
  maxArgPromptBytes?: number;
  remediationMessage?: string;
}

export interface PromptTransportResult {
  stdin?: string;
}

export function buildPromptTransport(input: BuildPromptTransportInput): PromptTransportResult {
  if (input.promptMode === "stdin") {
    return { stdin: input.prompt };
  }

  const maxArgPromptBytes = input.maxArgPromptBytes ?? DEFAULT_MAX_ARG_PROMPT_BYTES;
  const promptBytes = Buffer.byteLength(input.prompt, "utf8");

  if (promptBytes > maxArgPromptBytes) {
    const remediationMessage = input.remediationMessage ?? 'Use promptMode="stdin" for this provider or reduce prompt size.';
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Provider '${input.provider}' prompt is too large for promptMode="arg". promptBytes=${promptBytes} maxArgPromptBytes=${maxArgPromptBytes}. ${remediationMessage}`
    );
  }

  if (input.style === "flag-value") {
    input.args.push(input.promptFlag ?? "-p", input.prompt);
  } else {
    input.args.push(input.prompt);
  }

  return {};
}
