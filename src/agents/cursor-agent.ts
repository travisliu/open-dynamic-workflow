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
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { buildPromptTransport } from "./prompt-transport.js";

export interface CursorAgentProviderConfig extends ProviderConfig {
  promptMode?: "arg" | "stdin";
  promptFlag?: string;
  outputFormat?: "text" | "json" | "stream-json";
  outputFormatFlag?: string;
  trustFlag?: string | false;
  modeFlag?: string;
  defaultMode?: "ask" | "plan" | string;
  modelFlag?: string;
  dangerouslySkipPermissionsFlag?: string;
  workspaceFlag?: string | false;
}

const DEFAULT_CURSOR_AGENT_CONFIG: CursorAgentProviderConfig = {
  command: "agent",
  args: [],
  promptMode: "stdin",
  promptFlag: "-p",
  outputFormat: "json",
  outputFormatFlag: "--output-format",
  trustFlag: "--trust",
  modeFlag: "--mode",
  defaultMode: "ask",
  modelArg: { flag: "--model" },
  workspaceFlag: false,
  dangerouslySkipPermissionsFlag: "--force"
};

export class CursorAgentAdapter implements AgentAdapter {
  readonly name = "cursor";
  private readonly config: CursorAgentProviderConfig;

  constructor(config?: CursorAgentProviderConfig) {
    this.config = { ...DEFAULT_CURSOR_AGENT_CONFIG, ...(config ?? {}) };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const command = this.config.command ?? "agent";

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
        provider: "cursor",
        available: true,
        command,
        supportsModelSelection: this.config.modelArg !== false
      };
    } catch (err) {
      return {
        provider: "cursor",
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
    const command = this.config.command ?? "agent";
    const args = [...(this.config.args ?? [])];

    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });

    if (structuredPrompt.nativeRequested) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CLI_USAGE_ERROR,
        'Cursor Agent does not support structuredOutput.transport="native" yet.'
      );
    }

    const outputFormat = this.config.outputFormat;
    if (outputFormat !== undefined && outputFormat !== null) {
      args.push(this.config.outputFormatFlag ?? "--output-format", outputFormat);
    }

    if (this.config.trustFlag !== false && this.config.trustFlag !== undefined) {
      args.push(this.config.trustFlag);
    }

    appendModelArg(
      args,
      input.model ?? this.config.defaultModel ?? undefined,
      this.config.modelArg,
      this.config.modelFlag ?? "--model"
    );

    if (input.permissions?.mode === "dangerously-full-access") {
      args.push(this.config.dangerouslySkipPermissionsFlag ?? "--force");
    } else {
      args.push(this.config.modeFlag ?? "--mode", this.config.defaultMode ?? "ask");
    }

    if (this.config.workspaceFlag && input.cwd) {
      args.push(this.config.workspaceFlag, input.cwd);
    }

    const { stdin } = buildPromptTransport({
      provider: "cursor",
      prompt: structuredPrompt.prompt,
      promptMode: this.config.promptMode ?? "stdin",
      promptFlag: this.config.promptFlag ?? "-p",
      args,
      style: "flag-value"
    });

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
        const textFields = ["text", "response", "content", "message", "result"];
        let foundText: string | undefined = undefined;
        for (const field of textFields) {
          if (typeof parsed[field] === "string") {
            foundText = parsed[field];
            break;
          }
        }

        if (foundText !== undefined) {
          const res: ProviderParsedResult = {
            text: foundText,
            json: parsed,
            raw: parsed
          };
          const sj = tryParseEmbeddedJson(foundText);
          if (sj !== undefined) {
            res.structuredJson = sj;
          }
          return res;
        }

        if (!Array.isArray(parsed) || parsed.length > 0 || parsed.length === 0) {
          // If no text field exists but the parsed value is an object or array
          return {
            json: parsed,
            structuredJson: parsed,
            raw: parsed
          };
        }
      }
    } catch {
      // JSON parsing failed, fall back to plain text
    }

    return {
      text: input.stdout
    };
  }
}

function tryParseEmbeddedJson(text: string): unknown | undefined {
  const extracted = extractJson(text);
  return extracted.ok ? extracted.value : undefined;
}
