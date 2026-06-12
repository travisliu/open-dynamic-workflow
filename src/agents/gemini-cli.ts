import type {
  AgentAdapter,
  ProviderHealth,
  AgentRunInput,
  ProviderCommand,
  ProviderParseInput,
  ProviderParsedResult,
  ProviderConfig
} from "./types.js";
import { runProcess } from "./process-runner.js";
import { buildProviderEnv, shouldRedactEnvName } from "../security/env.js";
import { appendModelArg } from "./model-args.js";
import { extractJson } from "../structured/extract-json.js";
import { resolveStructuredOutputPrompt } from "../structured/structured-output.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export interface GeminiProviderConfig extends ProviderConfig {
  promptFlag?: string;
  modelFlag?: string;
  promptMode?: "stdin" | "arg";
}

export class GeminiCliAdapter implements AgentAdapter {
  readonly name = "gemini";
  private readonly config: GeminiProviderConfig;

  constructor(config?: GeminiProviderConfig) {
    this.config = config ?? { command: "gemini" };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const command = this.config.command ?? "gemini";
    try {
      await runProcess({
        command,
        args: ["--help"],
        cwd: process.cwd(),
        env: buildProviderEnv({
          baseEnv: process.env,
          passEnv: [],
          explicitEnv: {}
        }),
        timeoutMs: 5000
      });
      return {
        provider: "gemini",
        available: true,
        command,
        supportsModelSelection: this.config.modelArg !== false
      };
    } catch (err) {
      return {
        provider: "gemini",
        available: false,
        command,
        message: `Command '${command}' is not available.`,
        error: {
          name: (err as Error).name,
          message: (err as Error).message
        },
        supportsModelSelection: this.config.modelArg !== false
      };
    }
  }

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
    const command = this.config.command ?? "gemini";
    const promptFlag = this.config.promptFlag ?? "-p";
    const defaultFlag = this.config.modelFlag ?? "-m";
    const promptMode = this.config.promptMode ?? "arg";
    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });

    if (structuredPrompt.nativeRequested) {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        'Gemini does not support structuredOutput.transport="native" yet.'
      );
    }

    const args: string[] = [];
    let stdin: string | undefined = undefined;

    if (promptMode === "stdin") {
      stdin = structuredPrompt.prompt;
    } else {
      args.push(promptFlag, structuredPrompt.prompt);
    }

    const baseArgs = this.config.args ?? ["--output-format", "json"];
    const resolvedBaseArgs =
      input.permissions?.mode === "dangerously-full-access"
        ? applyFullAccessApprovalMode(baseArgs)
        : baseArgs;
    args.push(...resolvedBaseArgs);

    const model = input.model ?? this.config.defaultModel ?? undefined;
    appendModelArg(args, model, this.config.modelArg, defaultFlag);

    // Filter environment variables according to security policy
    const filteredEnv: Record<string, string> = {};
    if (input.env) {
      for (const [key, value] of Object.entries(input.env)) {
        if (!shouldRedactEnvName(key)) {
          filteredEnv[key] = value;
        }
      }
    }

    const cmd: ProviderCommand = {
      command,
      args,
      cwd: input.cwd,
      env: filteredEnv
    };
    if (stdin !== undefined) {
      cmd.stdin = stdin;
    }
    return cmd;
  }
  async parseResult(input: ProviderParseInput): Promise<ProviderParsedResult> {
    const trimmed = input.stdout.trim();
    if (!trimmed) {
      return {
        text: "",
        parseWarnings: ["Empty stdout"]
      };
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.text === "string") {
          const structured = tryParseEmbeddedJson(parsed.text);
          return {
            text: parsed.text,
            json: parsed,
            structuredJson: structured,
            raw: parsed
          };
        }
        if (typeof parsed.response === "string") {
          const structured = tryParseEmbeddedJson(parsed.response);
          return {
            text: parsed.response,
            json: parsed,
            structuredJson: structured,
            raw: parsed
          };
        }
        return {
          json: parsed,
          structuredJson: parsed,
          raw: parsed
        };
      }
      return {
        text: trimmed,
        parseWarnings: ["Parsed JSON is not an object or array"]
      };
    } catch (err) {
      return {
        text: input.stdout,
        parseWarnings: [`Malformed JSON: ${(err as Error).message}`]
      };
    }
  }
}

/**
 * Normalizes Gemini base args for dangerously-full-access mode.
 * Replaces any existing `--approval-mode <value>` pair with `--approval-mode yolo`.
 * If no approval-mode flag exists, appends `--approval-mode yolo`.
 * Ensures the final args contain exactly one effective approval mode.
 */
function applyFullAccessApprovalMode(baseArgs: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  let replaced = false;
  while (i < baseArgs.length) {
    if (baseArgs[i] === "--approval-mode" && i + 1 < baseArgs.length) {
      // Replace this pair with yolo
      result.push("--approval-mode", "yolo");
      i += 2;
      replaced = true;
    } else {
      result.push(baseArgs[i]!);
      i += 1;
    }
  }
  if (!replaced) {
    result.push("--approval-mode", "yolo");
  }
  return result;
}

function tryParseEmbeddedJson(text: string): unknown | undefined {
  const extracted = extractJson(text);
  return extracted.ok ? extracted.value : undefined;
}
