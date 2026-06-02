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

export interface CodexProviderConfig extends ProviderConfig {
  promptMode?: "stdin" | "arg";
}

export class CodexExecAdapter implements AgentAdapter {
  readonly name = "codex";
  private readonly config: CodexProviderConfig;

  constructor(config?: CodexProviderConfig) {
    this.config = config ?? { command: "codex" };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const command = this.config.command ?? "codex";
    try {
      // Cheap process call to verify availability
      await runProcess({
        command,
        args: ["--help"],
        cwd: process.cwd(),
        timeoutMs: 2000
      });
      return {
        provider: "codex",
        available: true,
        command
      };
    } catch (err) {
      return {
        provider: "codex",
        available: false,
        command,
        message: `Command '${command}' is not available.`,
        error: {
          name: (err as Error).name,
          message: (err as Error).message
        }
      };
    }
  }

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
    const command = this.config.command ?? "codex";
    const baseArgs = this.config.args ?? ["exec", "--json", "--ephemeral"];
    const args = [...baseArgs];

    const model = input.model ?? this.config.defaultModel;
    if (model) {
      args.push("--model", model);
    }

    const promptMode = this.config.promptMode ?? "stdin";
    let stdin: string | undefined = undefined;

    if (promptMode === "stdin") {
      stdin = input.prompt;
    } else {
      args.push(input.prompt);
    }

    const cmd: ProviderCommand = {
      command,
      args,
      cwd: input.cwd,
      env: input.env
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
