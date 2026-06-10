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
import { shouldRedactEnvName } from "../security/env.js";
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
        timeoutMs: 2000
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

  capabilities() {
    return {
      prompt: {
        transports: ["stdin" as const, "argv" as const]
      },
      output: {
        formats: ["text" as const, "json" as const]
      },
      structuredOutput: {
        modes: ["prompt" as const, "validate-only" as const]
      },
      usage: {
        source: "none" as const
      },
      sessions: {
        modes: ["none" as const]
      },
      permissions: {
        modes: ["none" as const]
      }
    };
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
    args.push(...baseArgs);

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

function tryParseEmbeddedJson(text: string): unknown | undefined {
  const extracted = extractJson(text);
  return extracted.ok ? extracted.value : undefined;
}
