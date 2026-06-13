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

export interface AntigravityProviderConfig extends ProviderConfig {
  promptFlag?: string;
  modelFlag?: string;
  promptMode?: "stdin" | "arg";
  sandboxFlag?: string;
  dangerouslySkipPermissionsFlag?: string;
  useSandboxByDefault?: boolean;
  permissionPolicy?: "sandbox" | "native";
  printTimeoutFlag?: string;
}

const DEFAULT_ANTIGRAVITY_CONFIG: AntigravityProviderConfig = {
  command: "agy",
  args: [],
  defaultModel: null,
  promptMode: "arg",
  promptFlag: "-p",
  modelArg: { flag: "--model" },
  sandboxFlag: "--sandbox",
  dangerouslySkipPermissionsFlag: "--dangerously-skip-permissions",
  useSandboxByDefault: true,
  permissionPolicy: "sandbox"
};

export class AntigravityCliAdapter implements AgentAdapter {
  readonly name = "antigravity";
  private readonly config: AntigravityProviderConfig;

  constructor(config?: AntigravityProviderConfig) {
    this.config = { ...DEFAULT_ANTIGRAVITY_CONFIG, ...(config ?? {}) };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const command = this.config.command ?? "agy";
    try {
      await runProcess({
        command,
        args: ["--help"],
        cwd: process.cwd(),
        timeoutMs: 2000
      });
      return {
        provider: "antigravity",
        available: true,
        command,
        supportsModelSelection: this.config.modelArg !== false
      };
    } catch (err) {
      return {
        provider: "antigravity",
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
    const command = this.config.command ?? "agy";
    const args = [...(this.config.args ?? [])];

    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });

    if (structuredPrompt.nativeRequested) {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        'Antigravity does not support structuredOutput.transport="native" yet.'
      );
    }

    const promptMode = this.config.promptMode ?? "arg";
    let stdin: string | undefined = undefined;

    if (promptMode === "stdin") {
      stdin = structuredPrompt.prompt;
    } else {
      args.push(this.config.promptFlag ?? "-p", structuredPrompt.prompt);
    }

    appendModelArg(
      args,
      input.model ?? this.config.defaultModel ?? undefined,
      this.config.modelArg,
      this.config.modelFlag ?? "--model"
    );

    if (input.permissions?.mode === "dangerously-full-access") {
      args.push(this.config.dangerouslySkipPermissionsFlag ?? "--dangerously-skip-permissions");
    } else {
      if (this.config.useSandboxByDefault === true || this.config.permissionPolicy === "sandbox") {
        args.push(this.config.sandboxFlag ?? "--sandbox");
      } else if (this.config.permissionPolicy !== "native") {
        throw new OpenFlowError(
          ErrorCode.CLI_USAGE_ERROR,
          "Antigravity default execution requires sandbox or native policy."
        );
      }
    }

    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.env)) {
      if (!shouldRedactEnvName(key)) {
        filteredEnv[key] = value;
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
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const textFields = ["text", "response", "content"];
        let text: string | undefined = undefined;
        for (const field of textFields) {
          if (typeof parsed[field] === "string") {
            text = parsed[field];
            break;
          }
        }

        if (text !== undefined) {
          const res: ProviderParsedResult = {
            text,
            json: parsed,
            raw: parsed
          };
          const sj = tryParseEmbeddedJson(text);
          if (sj !== undefined) {
            res.structuredJson = sj;
          }
          return res;
        }

        return {
          json: parsed,
          structuredJson: parsed,
          raw: parsed
        };
      } else if (Array.isArray(parsed)) {
        return {
          json: parsed,
          structuredJson: parsed,
          raw: parsed
        };
      }
    } catch {
      // Malformed JSON, fall back to plain text
    }

    const result: ProviderParsedResult = {
      text: input.stdout
    };
    const structured = tryParseEmbeddedJson(input.stdout);
    if (structured !== undefined) {
      result.structuredJson = structured;
    }
    if (tryParseJson(trimmed) === undefined) {
      result.parseWarnings = ["Malformed JSON: Unexpected token"];
    }
    return result;
  }
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function tryParseEmbeddedJson(text: string): unknown | undefined {
  const extracted = extractJson(text);
  return extracted.ok ? extracted.value : undefined;
}
