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

export interface GeminiProviderConfig extends ProviderConfig {
  promptFlag?: string;
  modelFlag?: string;
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

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
    const command = this.config.command ?? "gemini";
    const promptFlag = this.config.promptFlag ?? "-p";
    const defaultFlag = this.config.modelFlag ?? "-m";

    const args: string[] = [];
    args.push(promptFlag, input.prompt);

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

    return {
      command,
      args,
      cwd: input.cwd,
      env: filteredEnv
    };
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
          return {
            text: parsed.text,
            json: parsed,
            raw: parsed
          };
        }
        return {
          json: parsed,
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
